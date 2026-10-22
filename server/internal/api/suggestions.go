// Предложения ассистента: сервер сам замечает, что в расписании можно улучшить, и предлагает
// одной карточкой «Да / Нет». Правила детерминированные (без вызова модели): дёшево и предсказуемо.
// Проверка идёт вместе с напоминаниями и при открытии приложения, не чаще suggestEvery.
package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

const (
	// suggestEvery — как часто пересчитывать предложения одного пользователя.
	suggestEvery = 30 * time.Minute
	// staleAfter — задача без срока, открытая дольше, считается давней.
	staleAfter = 7 * 24 * time.Hour
	// overloadRatio и overloadMin — неделя перегружена: встреч в 1.5 раза больше обычного и не меньше 3 часов в среднем.
	overloadRatio = 1.5
	overloadMin   = 3 * 60
)

// lunchWords — событие или «святой» блок, похожий на обед: тогда обед не предлагаем.
var lunchWords = regexp.MustCompile(`(?i)обед|ланч|lunch|перекус`)

// suggestInput — всё, что нужно правилам. Now — в поясе пользователя; Events — с понедельника
// за четыре недели до текущей и до конца следующей недели (для «перегрузки» и «завтра»).
type suggestInput struct {
	Now      time.Time
	Profile  model.Profile
	Notify   model.NotifySettings
	Events   []model.Event
	Tasks    []model.Task
	Memories []model.Memory
	People   []model.Person
	// Seen — ключи уже сделанных предложений; Today — сколько сделано с начала суток.
	Seen  map[string]bool
	Today int
}

// planSuggestions — новые предложения по порядку важности, не больше дневного лимита.
// Ничего не предлагает в тихие часы, сразу после подъёма и перед сном; выключенные виды пропускает.
func planSuggestions(in suggestInput) []model.Suggestion {
	p := in.Profile
	nowM := in.Now.Hour()*60 + in.Now.Minute()
	from, to := p.DayBounds()
	if p.Proactive <= in.Today || nowM < from+30 || nowM >= to-60 || in.Notify.Quiet(nowM) {
		return nil
	}
	today := in.Now.Format(time.DateOnly)
	byDay := map[string][]model.Event{}
	for _, e := range in.Events {
		byDay[e.Date] = append(byDay[e.Date], e)
	}
	var out []model.Suggestion
	add := func(sg model.Suggestion, ok bool) {
		if !ok || in.Seen[sg.Key] || slices.Contains(p.Muted, string(sg.Kind)) || len(out) >= p.Proactive-in.Today {
			return
		}
		out = append(out, sg)
	}
	for _, sg := range dateSuggestions(in, today) {
		add(sg, true)
	}
	add(lunchSuggestion(in, today, nowM, byDay[today]))
	add(staleTaskSuggestion(in, today, byDay))
	add(planTasksSuggestion(in, today, nowM, byDay[today]))
	add(overloadSuggestion(in, in.Events))
	return out
}

// at — момент «дата + минуты» в поясе now; endOf — конец дня date (полночь следующего).
func at(date string, minutes int, now time.Time) time.Time {
	t, _ := localTime(date, minutes, now.Location())
	return t
}

func endOf(date string, now time.Time) time.Time { return at(date, 24*60, now) }

// nextDate — ближайшая дата ГГГГ-ММ-ДД (разовая) или --ММ-ДД (ежегодная) не раньше today; "" — прошла.
func nextDate(raw, today string) string {
	if strings.HasPrefix(raw, "--") && len(raw) == 7 {
		year := today[:4]
		d := year + raw[1:]
		if _, err := time.Parse(time.DateOnly, d); err != nil {
			return "" // 29 февраля в невисокосный год
		}
		if d < today {
			next := fmt.Sprintf("%04d", atoiYear(year)+1) + raw[1:]
			if _, err := time.Parse(time.DateOnly, next); err != nil {
				return ""
			}
			return next
		}
		return d
	}
	if _, err := time.Parse(time.DateOnly, raw); err != nil || raw < today {
		return ""
	}
	return raw
}

func atoiYear(y string) int {
	n := 0
	for _, c := range y {
		n = n*10 + int(c-'0')
	}
	return n
}

// daysBetween — сколько суток от a до b (обе — ГГГГ-ММ-ДД).
func daysBetween(a, b string) int {
	da, _ := time.Parse(time.DateOnly, a)
	db, _ := time.Parse(time.DateOnly, b)
	return int(db.Sub(da).Hours() / 24)
}

var ruMonthsGenitive = [...]string{"января", "февраля", "марта", "апреля", "мая", "июня",
	"июля", "августа", "сентября", "октября", "ноября", "декабря"}

// soonLabel — «завтра», «послезавтра» или «в субботу, 24 октября».
func soonLabel(today, date string) string {
	switch daysBetween(today, date) {
	case 1:
		return "завтра"
	case 2:
		return "послезавтра"
	}
	d, _ := time.Parse(time.DateOnly, date)
	return fmt.Sprintf("%s, %d %s", weekdayAccusative(d.Weekday()), d.Day(), ruMonthsGenitive[d.Month()-1])
}

func weekdayAccusative(w time.Weekday) string {
	return [...]string{"в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"}[w]
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

// dateSuggestions — через 1–7 дней день рождения из карточки или важная дата из памяти:
// предложить задачу заранее (подарок, подготовка).
func dateSuggestions(in suggestInput, today string) []model.Suggestion {
	var out []model.Suggestion
	soon := func(raw string) (string, bool) {
		d := nextDate(raw, today)
		n := daysBetween(today, d)
		return d, d != "" && n >= 1 && n <= 7
	}
	due := func(d string) string { return max(addDays(d, -1), today) }
	for _, person := range in.People {
		d, ok := soon(person.Birthday)
		if !ok {
			continue
		}
		out = append(out, model.Suggestion{
			Kind: model.SuggestDate, Key: fmt.Sprintf("date:p%d:%s", person.ID, d),
			Title:     "Скоро день рождения: " + person.Name,
			Body:      fmt.Sprintf("%s — %s. Добавить задачу про подарок?", upperFirst(soonLabel(today, d)), person.Name),
			Action:    model.SuggestionAction{Type: model.ActionTask, Title: clip("Подарок: "+person.Name, maxTitle), Due: due(d)},
			ExpiresAt: endOf(d, in.Now),
		})
	}
	if !in.Profile.Memory {
		return out
	}
	for _, m := range in.Memories {
		if m.Kind != model.MemoryDate || m.Date == "" || m.Rejected || !m.Confirmed {
			continue
		}
		d, ok := soon(m.Date)
		if !ok {
			continue
		}
		out = append(out, model.Suggestion{
			Kind: model.SuggestDate, Key: fmt.Sprintf("date:m%d:%s", m.ID, d),
			Title:     "Скоро важная дата",
			Body:      fmt.Sprintf("%s: %s. Поставить задачу подготовиться?", upperFirst(soonLabel(today, d)), m.Text),
			Action:    model.SuggestionAction{Type: model.ActionTask, Title: clip("Подготовиться: "+m.Text, maxTitle), Due: due(d)},
			ExpiresAt: endOf(d, in.Now),
		})
	}
	return out
}

func upperFirst(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	return strings.ToUpper(string(r)) + s[n:]
}

// lunchSuggestion — до полудня в плотный день (от трёх встреч) с 12 до 15 почти не осталось
// свободного: занять последнее окно под обед, пока его не отдали.
func lunchSuggestion(in suggestInput, today string, nowM int, events []model.Event) (model.Suggestion, bool) {
	if nowM >= 12*60 {
		return model.Suggestion{}, false
	}
	timed := 0
	for _, e := range events {
		if e.AllDay {
			continue
		}
		timed++
		if lunchWords.MatchString(e.Title) {
			return model.Suggestion{}, false
		}
	}
	weekday := in.Now.Weekday()
	for _, b := range in.Profile.Protected {
		if b.On(weekday) && lunchWords.MatchString(b.Title) {
			return model.Suggestion{}, false
		}
	}
	if timed < 3 {
		return model.Suggestion{}, false
	}
	free := freeSlots(slotQuery{From: 12 * 60, To: 15 * 60, Weekday: weekday, Now: nowM, Duration: 30}, busySpans(in.Profile, weekday, events))
	total := 0
	for _, f := range free {
		total += f.End - f.Start
	}
	if len(free) == 0 || total >= 90 {
		return model.Suggestion{}, false
	}
	slot := free[0]
	end := min(slot.Start+60, slot.End)
	return model.Suggestion{
		Kind: model.SuggestLunch, Key: "lunch:" + today,
		Title:     "Обед не потеряется?",
		Body:      fmt.Sprintf("День плотный — на обед осталось окно %s–%s. Занять его?", hm(slot.Start), hm(slot.End)),
		Action:    model.SuggestionAction{Type: model.ActionEvent, Title: "Обед", Date: today, Start: slot.Start, End: end, Badge: model.BadgeFood},
		ExpiresAt: at(today, slot.Start, in.Now),
	}, true
}

// focusWindow — где искать время для сосредоточенной работы: в фокус-время профиля,
// иначе — в рабочие часы (в выходной — весь активный день).
func focusWindow(p model.Profile, weekday time.Weekday) (from, to int) {
	from, to = p.DayBounds()
	switch p.Focus {
	case model.FocusMorning:
		return from, min(to, 12*60)
	case model.FocusAfternoon:
		return max(from, 12*60), min(to, 17*60)
	case model.FocusEvening:
		return max(from, 17*60), to
	}
	if f, t, ok := dayBounds(p, weekday, true); ok {
		return f, t
	}
	return from, to
}

// staleTaskSuggestion — самая давняя из просроченных или открытых больше недели задач:
// поставить на неё час завтра в фокус-время.
func staleTaskSuggestion(in suggestInput, today string, byDay map[string][]model.Event) (model.Suggestion, bool) {
	var pick *model.Task
	var since string // срок или день создания — по нему выбираем самую давнюю
	for i, t := range in.Tasks {
		if t.Done || t.Kind != model.TaskKindTask || t.Role == model.TaskRoleMember || in.Seen["stale_task:"+t.ID] {
			continue
		}
		var at string
		switch {
		case t.Due != "" && t.Due < today:
			at = t.Due
		case t.Due == "" && !t.CreatedAt.IsZero() && in.Now.Sub(t.CreatedAt) > staleAfter:
			at = t.CreatedAt.In(in.Now.Location()).Format(time.DateOnly)
		default:
			continue
		}
		if pick == nil || at < since {
			pick, since = &in.Tasks[i], at
		}
	}
	if pick == nil {
		return model.Suggestion{}, false
	}
	tomorrow := addDays(today, 1)
	weekday := in.Now.AddDate(0, 0, 1).Weekday()
	from, to := focusWindow(in.Profile, weekday)
	free := freeSlots(slotQuery{From: from, To: to, Weekday: weekday, Now: -1, Duration: 60}, busySpans(in.Profile, weekday, byDay[tomorrow]))
	if len(free) == 0 {
		return model.Suggestion{}, false
	}
	slot := free[0]
	title := fmt.Sprintf("«%s» висит больше недели", clip(pick.Title, 40))
	if pick.Due != "" {
		title = fmt.Sprintf("«%s» просрочена", clip(pick.Title, 40))
	}
	return model.Suggestion{
		Kind: model.SuggestStaleTask, Key: "stale_task:" + pick.ID,
		Title: title,
		Body:  fmt.Sprintf("Поставить на неё час завтра в %s?", hm(slot.Start)),
		Action: model.SuggestionAction{Type: model.ActionEvent, Title: pick.Title, Date: tomorrow,
			Start: slot.Start, End: slot.Start + 60, Badge: model.BadgeWork},
		ExpiresAt: endOf(today, in.Now),
	}, true
}

// planTasksSuggestion — утром рабочего дня есть хотя бы две задачи без времени (срок сегодня,
// прошёл или не задан) и свободный час в рабочее время: предложить разложить их с ассистентом.
func planTasksSuggestion(in suggestInput, today string, nowM int, events []model.Event) (model.Suggestion, bool) {
	weekday := in.Now.Weekday()
	from, to, ok := dayBounds(in.Profile, weekday, true)
	if !ok || nowM >= 12*60 {
		return model.Suggestion{}, false
	}
	open := 0
	for _, t := range in.Tasks {
		if !t.Done && t.Kind == model.TaskKindTask && (t.Due == "" || t.Due <= today) {
			open++
		}
	}
	if open < 2 {
		return model.Suggestion{}, false
	}
	free := freeSlots(slotQuery{From: from, To: to, Weekday: weekday, Now: nowM, Duration: 60}, busySpans(in.Profile, weekday, events))
	if len(free) == 0 {
		return model.Suggestion{}, false
	}
	minutes := 0
	for _, f := range free {
		minutes += f.End - f.Start
	}
	return model.Suggestion{
		Kind: model.SuggestPlanTasks, Key: "plan_tasks:" + today,
		Title: "Разложить задачи на сегодня?",
		Body: fmt.Sprintf("%s без времени, а свободно %s в рабочие часы — могу расставить их по окнам.",
			upperFirst(plural(open, "задача", "задачи", "задач")), hoursLabel(minutes)),
		Action:    model.SuggestionAction{Type: model.ActionChat, Prompt: "Разложи мои открытые задачи по свободным окнам сегодня"},
		ExpiresAt: at(today, to, in.Now),
	}, true
}

// hoursLabel — «45 мин», «2 ч», «2,5 ч».
func hoursLabel(minutes int) string {
	if minutes < 60 {
		return fmt.Sprintf("%d мин", minutes)
	}
	if minutes%60 == 0 {
		return fmt.Sprintf("%d ч", minutes/60)
	}
	return strings.Replace(fmt.Sprintf("%.1f ч", float64(minutes)/60), ".", ",", 1)
}

// weekStart — понедельник недели, в которую входит date.
func weekStart(date string) string {
	d, _ := time.Parse(time.DateOnly, date)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7)).Format(time.DateOnly)
}

// overloadSuggestion — в начале недели (пн–ср) встреч на ней в полтора раза больше,
// чем в среднем за четыре прошлых: предложить разобрать, что перенести.
func overloadSuggestion(in suggestInput, events []model.Event) (model.Suggestion, bool) {
	if wd := in.Now.Weekday(); wd < time.Monday || wd > time.Wednesday {
		return model.Suggestion{}, false
	}
	monday := weekStart(in.Now.Format(time.DateOnly))
	first, end := addDays(monday, -28), addDays(monday, 7)
	var this, past int
	for _, e := range events {
		if e.AllDay || e.Date < first || e.Date >= end {
			continue
		}
		if e.Date >= monday {
			this += e.End - e.Start
		} else {
			past += e.End - e.Start
		}
	}
	avg := past / 4
	if avg < overloadMin || float64(this) < overloadRatio*float64(avg) {
		return model.Suggestion{}, false
	}
	return model.Suggestion{
		Kind: model.SuggestOverload, Key: "overload:" + monday,
		Title: "Неделя плотнее обычного",
		Body:  fmt.Sprintf("Встреч на %s, а обычно около %s. Посмотрим, что можно перенести?", hoursLabel(this), hoursLabel(avg)),
		Action: model.SuggestionAction{Type: model.ActionChat,
			Prompt: "Неделя перегружена встречами. Что можно перенести или отменить?"},
		ExpiresAt: endOf(addDays(monday, 6), in.Now),
	}, true
}

// suggester — когда пользователю последний раз считали предложения (в памяти процесса:
// после перезапуска посчитаем раньше, а повторы всё равно отсекает ключ в хранилище).
type suggester struct {
	mu   sync.Mutex
	last map[int64]time.Time
}

func (sg *suggester) due(userID int64, now time.Time) bool {
	sg.mu.Lock()
	defer sg.mu.Unlock()
	if sg.last == nil {
		sg.last = map[int64]time.Time{}
	}
	if now.Sub(sg.last[userID]) < suggestEvery {
		return false
	}
	sg.last[userID] = now
	return true
}

// suggest считает и сохраняет новые предложения пользователя; push=true — ещё и присылает их.
func (s *server) suggest(ctx context.Context, u model.User, now time.Time, push bool) {
	if !s.suggester.due(u.ID, now) {
		return
	}
	p := s.profileFor(ctx)
	if p.Proactive == 0 {
		return
	}
	ns, err := s.store.NotifySettings(ctx)
	if err != nil {
		return
	}
	loc := s.cal.location(u)
	local := now.In(loc)
	today := local.Format(time.DateOnly)
	monday := weekStart(today)
	in := suggestInput{
		Now: local, Profile: p, Notify: ns,
		Events: s.eventsBetween(ctx, addDays(monday, -28), addDays(monday, 13)),
		Tasks:  s.store.Tasks(ctx), People: s.store.People(ctx), Seen: map[string]bool{},
	}
	if p.Memory {
		in.Memories = s.store.Memories(ctx)
	}
	midnight, _ := localTime(today, 0, loc)
	for _, old := range s.store.Suggestions(ctx, now.Add(-60*24*time.Hour)) {
		in.Seen[old.Key] = true
		if !old.CreatedAt.Before(midnight) {
			in.Today++
		}
	}
	for _, sg := range planSuggestions(in) {
		sg.CreatedAt = now
		saved, ok, err := s.store.AddSuggestion(ctx, sg)
		if err != nil || !ok || !push {
			continue
		}
		_, _ = s.pushTo(ctx, suggestionPush(saved), pushOpts{ttl: max(saved.ExpiresAt.Sub(now), time.Minute), urgency: webpush.UrgencyNormal})
	}
}

// suggestionPush — уведомление о предложении: кнопки «Да» и «Нет» (у «обсудить в чате» — только «Нет»).
func suggestionPush(sg model.Suggestion) model.PushMessage {
	return model.PushMessage{
		Kind: model.PushSuggest, Title: sg.Title, Body: sg.Body, URL: "/#home",
		Tag: fmt.Sprintf("suggest:%d", sg.ID), SuggestionID: sg.ID, SuggestionAction: sg.Action.Type,
	}
}

func (s *server) listSuggestions(w http.ResponseWriter, r *http.Request) error {
	u, _ := store.UserFrom(r.Context())
	now := s.cal.now()
	s.suggest(r.Context(), u, now, false)
	out := []model.Suggestion{}
	for _, sg := range s.store.Suggestions(r.Context(), now.Add(-14*24*time.Hour)) {
		if sg.Active(now) {
			out = append(out, sg)
		}
	}
	// Хранилище отдаёт новые первыми; показываем в порядке создания — он же порядок важности.
	slices.Reverse(out)
	writeJSON(w, http.StatusOK, out)
	return nil
}

// acceptResult — ответ на «Да»: что создано (событие или задача), у чата — запрос для него.
type acceptResult struct {
	Suggestion model.Suggestion `json:"suggestion"`
	Event      *model.Event     `json:"event,omitempty"`
	Task       *model.Task      `json:"task,omitempty"`
}

func (s *server) acceptSuggestion(w http.ResponseWriter, r *http.Request) error {
	id, err := suggestionID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	sg, err := s.findSuggestion(ctx, id)
	if err != nil {
		return err
	}
	// Сначала отмечаем ответ (атомарно, только у ждущего), потом выполняем: двойное «Да» — из
	// уведомления и с карточки — не создаст два события. Сбой создания тогда съедает предложение,
	// и это меньшее зло, чем дубль.
	res := acceptResult{}
	if res.Suggestion, err = s.store.AnswerSuggestion(ctx, id, model.SuggestionAccepted); err != nil {
		return suggestionErr(err)
	}
	switch sg.Action.Type {
	case model.ActionEvent:
		ev, err := s.createEventSynced(ctx, model.Event{
			Date: sg.Action.Date, Title: sg.Action.Title, Start: sg.Action.Start, End: sg.Action.End,
			Badge: sg.Action.Badge, Highlight: true,
		})
		if err != nil {
			return err
		}
		res.Event = &ev
	case model.ActionTask:
		t, err := s.store.CreateTask(ctx, model.Task{Title: sg.Action.Title, Kind: model.TaskKindTask, Due: sg.Action.Due})
		if err != nil {
			return err
		}
		res.Task = &t
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

func (s *server) dismissSuggestion(w http.ResponseWriter, r *http.Request) error {
	id, err := suggestionID(r)
	if err != nil {
		return err
	}
	var in struct {
		// Mute — «не предлагать такое»: вид добавляется в profile.muted.
		Mute bool `json:"mute"`
	}
	if r.ContentLength != 0 {
		if err := readJSON(w, r, &in); err != nil {
			return err
		}
	}
	ctx := r.Context()
	sg, err := s.store.AnswerSuggestion(ctx, id, model.SuggestionDismissed)
	if err != nil {
		return suggestionErr(err)
	}
	if in.Mute {
		p := s.profileFor(ctx)
		muted := append(slices.Clone(p.Muted), string(sg.Kind))
		if _, err := s.patchProfile(ctx, profileInput{Muted: &muted}); err != nil {
			return err
		}
	}
	writeJSON(w, http.StatusOK, sg)
	return nil
}

// findSuggestion — ждущее ответа предложение пользователя; устаревшее — 410.
func (s *server) findSuggestion(ctx context.Context, id int64) (model.Suggestion, error) {
	now := s.cal.now()
	for _, sg := range s.store.Suggestions(ctx, now.Add(-60*24*time.Hour)) {
		if sg.ID != id {
			continue
		}
		if sg.Status != model.SuggestionPending {
			return sg, suggestionErr(store.ErrConflict)
		}
		if !sg.Active(now) {
			return sg, &apiError{Status: http.StatusGone, Message: "Предложение уже неактуально"}
		}
		return sg, nil
	}
	return model.Suggestion{}, suggestionErr(store.ErrNotFound)
}

func suggestionID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, notFound("Предложение")
	}
	return id, nil
}

func suggestionErr(err error) error {
	switch err {
	case store.ErrConflict:
		return &apiError{Status: http.StatusConflict, Message: "На это предложение уже ответили"}
	case store.ErrNotFound:
		return notFound("Предложение")
	}
	return err
}
