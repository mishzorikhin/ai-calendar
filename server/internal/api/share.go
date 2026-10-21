// Совместные задачи: участники (шаринг и @упоминания) и уведомления.
// Правила как у Todoist/GitHub: владелец и участники видят и правят задачу;
// @username в названии или заметке добавляет человека участником и шлёт ему
// уведомление; владелец удаляет задачу у всех, участник выходит из неё.
//
// Делит задачу только *новое* упоминание — которого не было в тексте до правки.
// Иначе каждое сохранение возвращало бы того, кто вышел или кого убрал владелец,
// и слало бы повторные уведомления.
package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

// mentionsIn — упоминания @логин в тексте. Каждое — варианты логина: как написано
// и без точки/дефиса/подчёркивания в конце («с @bob.» — это @bob, если @bob. нет).
// Перед @ — начало текста или не буква/цифра/_/-/@: в «иван@bob» и
// «misha@bob.ru» упоминания нет, а в «хлеб.@carol» и «@bob.@carol» — есть.
func mentionsIn(text string) [][]string {
	var out [][]string
	seen := map[string]bool{}
	for i := 0; i < len(text); i++ {
		if text[i] != '@' {
			continue
		}
		if i > 0 {
			if r, _ := utf8.DecodeLastRuneInString(text[:i]); unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("_-@", r) {
				continue
			}
		}
		j := i + 1
		for j < len(text) && isLoginByte(text[j]) {
			j++
		}
		name := strings.ToLower(text[i+1 : j])
		i = j - 1
		variants := []string{name}
		if trimmed := strings.TrimRight(name, "._-"); trimmed != name {
			variants = append(variants, trimmed)
		}
		var valid []string
		for _, v := range variants {
			if usernameRe.MatchString(v) {
				valid = append(valid, v)
			}
		}
		if len(valid) > 0 && !seen[valid[0]] {
			seen[valid[0]] = true
			out = append(out, valid)
		}
	}
	return out
}

func isLoginByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '-'
}

// mentionedUsers — пользователи, упомянутые в названии и заметке задачи (без повторов).
func (s *server) mentionedUsers(ctx context.Context, t model.Task) []model.User {
	var out []model.User
	seen := map[int64]bool{}
	for _, variants := range mentionsIn(t.Title + " " + t.Subtitle) {
		for _, name := range variants {
			u, err := s.store.UserByUsername(ctx, name)
			if err != nil {
				continue // неизвестное @имя — просто текст
			}
			if !seen[u.ID] {
				seen[u.ID] = true
				out = append(out, u)
			}
			break
		}
	}
	return out
}

// newMentions — кто упомянут в after, но не был упомянут в before (сравнение по
// пользователям, а не по строкам). Если упоминание стёрли и написали заново — это
// новое приглашение: человек вернётся, даже если выходил.
func (s *server) newMentions(ctx context.Context, before, after model.Task) []model.User {
	old := map[int64]bool{}
	for _, u := range s.mentionedUsers(ctx, before) {
		old[u.ID] = true
	}
	var out []model.User
	for _, u := range s.mentionedUsers(ctx, after) {
		if !old[u.ID] {
			out = append(out, u)
		}
	}
	return out
}

// resolveUsernames — логины → пользователи. unknown — не найденные (их имена без @).
func (s *server) resolveUsernames(ctx context.Context, names []string) (users []model.User, unknown []string) {
	seen := map[string]bool{}
	for _, raw := range names {
		name := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(raw), "@"))
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		u, err := s.store.UserByUsername(ctx, name)
		if err != nil {
			unknown = append(unknown, name)
			continue
		}
		users = append(users, u)
	}
	return users, unknown
}

// notifyShare — «X поделился с вами задачей».
func (s *server) notifyShare(ctx context.Context, to model.User, task model.Task) {
	actor, _ := store.UserFrom(ctx)
	actor = otherUser(actor)
	_ = s.store.AddNotification(ctx, model.Notification{
		UserID: to.ID,
		From:   &actor,
		TaskID: task.ID,
		Text:   fmt.Sprintf("Общая задача «%s»", task.Title),
	})
	who := actor.Name
	if who == "" {
		who = "@" + actor.Username
	}
	s.pushToUser(to, model.PushMessage{
		Kind:   model.PushShare,
		Title:  task.Title,
		Body:   "Общая задача от " + who,
		URL:    "/#home",
		Tag:    "share:" + task.ID,
		TaskID: task.ID,
	}, pushOpts{ttl: 7 * 24 * time.Hour, urgency: webpush.UrgencyNormal})
}

// shareTaskWith добавляет участников к задаче task (свежей, после создания или правки)
// и шлёт уведомления только тем, кого действительно добавили. Себя, владельца и уже
// участвующих пропускает молча: участник может упомянуть владельца в заметке.
func (s *server) shareTaskWith(ctx context.Context, task model.Task, users []model.User) (model.Task, error) {
	me, _ := store.UserFrom(ctx)
	for _, u := range users {
		already := slices.ContainsFunc(task.Members, func(m model.User) bool { return m.ID == u.ID })
		if u.ID == me.ID || u.ID == task.OwnerID || already {
			continue
		}
		added, err := s.store.AddTaskMember(ctx, task.ID, u.ID)
		if err != nil {
			var me *store.MemberError
			if errors.As(err, &me) {
				return task, badRequest("%s", me.Msg)
			}
			return task, err
		}
		task = added
		s.notifyShare(ctx, u, task)
	}
	return task, nil
}

// membersInput — {username} для POST /api/tasks/{id}/members.
type memberInput struct {
	Username string `json:"username"`
}

// shareErrors маппит ошибки стора в HTTP-ответы раздела шаринга.
func shareErr(err error) error {
	var me *store.MemberError
	switch {
	case errors.Is(err, store.ErrNotFound):
		return notFound("Задача")
	case errors.Is(err, store.ErrForbidden):
		return &apiError{Status: http.StatusForbidden, Message: "Это может сделать только владелец"}
	case errors.As(err, &me):
		return badRequest("%s", me.Msg)
	}
	return err
}

func (s *server) addTaskMember(w http.ResponseWriter, r *http.Request) error {
	var in memberInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if strings.TrimSpace(in.Username) == "" {
		return badRequest("Нужен username")
	}
	users, unknown := s.resolveUsernames(r.Context(), []string{in.Username})
	if len(unknown) > 0 {
		return notFound("Пользователь @" + unknown[0])
	}
	t, err := s.store.Task(r.Context(), r.PathValue("id"))
	if err != nil {
		return shareErr(err)
	}
	// Явный запрос — явная ошибка: молча пропускаем владельца только в @упоминаниях.
	if len(users) == 1 && users[0].ID == t.OwnerID {
		return badRequest("Владелец и так видит задачу")
	}
	if t, err = s.shareTaskWith(r.Context(), t, users); err != nil {
		return shareErr(err)
	}
	writeJSON(w, http.StatusOK, t)
	return nil
}

func (s *server) removeTaskMember(w http.ResponseWriter, r *http.Request) error {
	u, err := s.store.UserByUsername(r.Context(), r.PathValue("username"))
	if err != nil {
		return notFound("Пользователь @" + r.PathValue("username"))
	}
	t, err := s.store.RemoveTaskMember(r.Context(), r.PathValue("id"), u.ID)
	if err != nil {
		return shareErr(err)
	}
	writeJSON(w, http.StatusOK, t)
	return nil
}

func (s *server) listNotifications(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, nonNil(s.store.Notifications(r.Context())))
	return nil
}

func (s *server) readNotifications(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.MarkNotificationsRead(r.Context()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
