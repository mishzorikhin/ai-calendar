// Подтверждение действий ассистента кнопкой. Удаление события или задачи, перенос дня
// и сдвиг больше трёх событий модель не выполняет сама: вызов инструмента лишь предлагает
// действие, сервер запоминает этот вызов, а пользователь видит под ответом карточку
// с кнопками. Выполняет действие только нажатие «Да» — ни слова в чате, ни повторный вызов
// модели (в том числе по команде из текста чужого события) ничего не удалят.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// confirmTTL — сколько ждёт предложенное действие, пока пользователь нажмёт кнопку.
const confirmTTL = 10 * time.Minute

// confirmCard — карточка подтверждения в чате.
type confirmCard struct {
	// Key — что именно подтверждается («event:id», пакет событий): при нажатии инструмент
	// пересчитывает ключ и выполняет действие, только если ничего не изменилось.
	Key string `json:"-"`
	// Title — вопрос («Удалить «Встреча с Глебом»?»), Detail — подробности, Button — текст кнопки.
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
	Button string `json:"button"`
	// Date — день, к которому относится действие (пусто у задач).
	Date string `json:"date,omitempty"`
	// Done — ответ в чат после выполнения («Удалил «…».»).
	Done string `json:"-"`
}

// pendingAction — предложенный моделью вызов, который ждёт кнопки.
type pendingAction struct {
	ID string `json:"id"`
	confirmCard
	user int64
	call llm.ToolCall
	at   time.Time
}

// confirmations — ждущие действия всех пользователей. Живут в памяти процесса: после
// перезапуска сервера карточка устаревает и действие нужно попросить ещё раз.
type confirmations struct {
	mu      sync.Mutex
	pending map[string]pendingAction
}

func newConfirmations() *confirmations {
	return &confirmations{pending: map[string]pendingAction{}}
}

// dropExpired снимает просроченные действия; вызывается под mu.
func (c *confirmations) dropExpired(now time.Time) {
	for id, p := range c.pending {
		if now.Sub(p.at) > confirmTTL {
			delete(c.pending, id)
		}
	}
}

// add запоминает действие и возвращает его с id. Прежнее предложение того же действия
// заменяется: подтвердить можно только последнюю карточку.
func (c *confirmations) add(user int64, call llm.ToolCall, card confirmCard) (pendingAction, error) {
	id, err := newToken()
	if err != nil {
		return pendingAction{}, err
	}
	now := time.Now()
	p := pendingAction{ID: id, confirmCard: card, user: user, call: call, at: now}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dropExpired(now)
	for old, q := range c.pending {
		if q.user == user && q.Key == card.Key {
			delete(c.pending, old)
		}
	}
	c.pending[id] = p
	return p, nil
}

// list — ждущие действия пользователя, старые первыми.
func (c *confirmations) list(user int64) []pendingAction {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dropExpired(time.Now())
	out := []pendingAction{}
	for _, p := range c.pending {
		if p.user == user {
			out = append(out, p)
		}
	}
	slices.SortFunc(out, func(a, b pendingAction) int { return a.at.Compare(b.at) })
	return out
}

// take снимает действие пользователя: выполнить его можно только один раз.
func (c *confirmations) take(user int64, id string) (pendingAction, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dropExpired(time.Now())
	p, ok := c.pending[id]
	if !ok || p.user != user {
		return pendingAction{}, false
	}
	delete(c.pending, id)
	return p, true
}

// clear снимает все предложения пользователя: он написал новую реплику — карточки устарели.
func (c *confirmations) clear(user int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, p := range c.pending {
		if p.user == user {
			delete(c.pending, id)
		}
	}
}

// needsConfirm решает, выполнять ли действие card.Key. В обычном ходе — нет: модель получает
// описание (what), а интерфейс — карточку. При нажатии кнопки ключ сверяется заново: если за это
// время события поменялись, действие не выполняется.
func needsConfirm(turn chatTurn, card confirmCard, what map[string]any) (string, toolMeta, bool) {
	if turn.confirmed == card.Key {
		return "", toolMeta{}, false
	}
	if turn.confirmed != "" {
		return `{"error":"с тех пор расписание изменилось — попросите ещё раз"}`, toolMeta{date: card.Date}, true
	}
	what["needs_confirmation"] = true
	what["instruction"] = "Ничего не сделано: под твоим ответом пользователь увидит карточку с кнопкой. " +
		"Коротко скажи, что именно произойдёт, и не проси ответить «да» — он нажмёт кнопку."
	return toolJSON(what), toolMeta{detail: "ждёт подтверждения", date: card.Date, confirm: &card}, true
}

func (s *server) listChatConfirms(w http.ResponseWriter, r *http.Request) error {
	u, _ := store.UserFrom(r.Context())
	writeJSON(w, http.StatusOK, s.confirms.list(u.ID))
	return nil
}

// confirmResult — ответ на нажатие: реплика ассистента в истории и день для перехода.
type confirmResult struct {
	Message model.Message `json:"message"`
	OK      bool          `json:"ok"`
	Date    string        `json:"date,omitempty"`
}

// decideChatConfirm — пользователь нажал «Да» или «Нет» на карточке. Итог пишется в историю
// чата репликой ассистента: модель в следующем ходе видит, что сделано.
func (s *server) decideChatConfirm(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Accept bool `json:"accept"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	u, _ := store.UserFrom(ctx)
	p, ok := s.confirms.take(u.ID, r.PathValue("id"))
	if !ok {
		return &apiError{Status: http.StatusGone, Message: "Предложение устарело — попросите ассистента ещё раз"}
	}
	res := confirmResult{Date: p.Date}
	text := "Хорошо, оставляю как есть."
	if in.Accept {
		// Действие доводим до конца, даже если клиент ушёл.
		actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), chatBudget)
		defer cancel()
		turn := chatTurn{now: time.Now().In(s.cal.location(u)), confirmed: p.Key}
		result, meta := s.runTool(actx, turn, p.call)
		res.OK, text = confirmOutcome(result, p.Done)
		if meta.date != "" {
			res.Date = meta.date
		}
	}
	msg, err := s.store.AddMessage(ctx, model.RoleAI, text)
	if err != nil {
		slog.Warn("чат: не сохранён итог подтверждения", "err", err)
		msg = model.Message{Role: model.RoleAI, Text: text}
	}
	res.Message = msg
	writeJSON(w, http.StatusOK, res)
	return nil
}

// confirmOutcome — текст итога по ответу инструмента: done при успехе, иначе его ошибка.
func confirmOutcome(result, done string) (bool, string) {
	var out struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal([]byte(result), &out)
	if out.OK {
		return true, done
	}
	if out.Error == "" {
		out.Error = "что-то пошло не так"
	}
	return false, "Не получилось: " + strings.TrimSuffix(out.Error, ".") + "."
}

// dayTitle — «Сегодня», «Завтра» или «24 октября, пятница».
func dayTitle(now time.Time, date string) string {
	switch daysBetween(now.Format(time.DateOnly), date) {
	case 0:
		return "Сегодня"
	case 1:
		return "Завтра"
	case 2:
		return "Послезавтра"
	}
	d, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	return fmt.Sprintf("%d %s, %s", d.Day(), ruMonthsGenitive[d.Month()-1], ruWeekdays[d.Weekday()])
}

// eventWhen — когда событие: «Завтра · 14:00–15:00».
func eventWhen(ev model.Event, now time.Time) string {
	when := dayTitle(now, ev.Date)
	if ev.AllDay {
		return when + " · весь день"
	}
	when += " · " + hm(ev.Start) + "–" + hm(ev.End)
	if ev.Repeat != "" {
		when += " · вся серия повторов"
	}
	return when
}
