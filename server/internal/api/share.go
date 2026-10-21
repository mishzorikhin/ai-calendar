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
	"regexp"
	"slices"
	"strings"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// mentionRe — @логин в тексте задачи: латиница, начинается с буквы (как при регистрации).
// Перед @ — начало строки или не часть слова: в «misha@bob.ru» упоминания нет.
var mentionRe = regexp.MustCompile(`(?:^|[^a-zA-Z0-9_.@-])@([a-zA-Z][a-zA-Z0-9_.-]{1,23})`)

// mentionUsernames — уникальные логины из title+subtitle (без повторов, в нижнем регистре).
func mentionUsernames(t model.Task) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(t.Title+" "+t.Subtitle, -1) {
		name := strings.ToLower(m[1])
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}

// newMentions — пользователи, упомянутые в after, но не в before. Знак препинания
// в конце («с @bob.») к логину не относится, если такого логина нет.
func (s *server) newMentions(ctx context.Context, before, after model.Task) []model.User {
	old := map[string]bool{}
	for _, name := range mentionUsernames(before) {
		old[name] = true
		old[strings.TrimRight(name, "._-")] = true
	}
	var out []model.User
	for _, name := range mentionUsernames(after) {
		if old[name] {
			continue
		}
		u, err := s.store.UserByUsername(ctx, name)
		if err != nil {
			trimmed := strings.TrimRight(name, "._-")
			if trimmed == name || old[trimmed] {
				continue
			}
			if u, err = s.store.UserByUsername(ctx, trimmed); err != nil {
				continue // неизвестное @имя — просто текст
			}
		}
		out = append(out, u)
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
}

// shareTaskWith добавляет участников и шлёт уведомления только тем, кого добавили.
// Себя, владельца и уже участвующих пропускает молча: участник может упомянуть
// владельца в заметке, и это не ошибка.
func (s *server) shareTaskWith(ctx context.Context, taskID string, users []model.User) (model.Task, error) {
	task, err := s.store.Task(ctx, taskID)
	if err != nil {
		return task, err
	}
	me, _ := store.UserFrom(ctx)
	for _, u := range users {
		already := slices.ContainsFunc(task.Members, func(m model.User) bool { return m.ID == u.ID })
		if u.ID == me.ID || u.ID == task.OwnerID || already {
			continue
		}
		if task, err = s.store.AddTaskMember(ctx, taskID, u.ID); err != nil {
			var me *store.MemberError
			if errors.As(err, &me) {
				return task, badRequest("%s", me.Msg)
			}
			return task, err
		}
		s.notifyShare(ctx, u, task)
	}
	return s.store.Task(ctx, taskID)
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
	t, err := s.shareTaskWith(r.Context(), r.PathValue("id"), users)
	if err != nil {
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
