// Совместные задачи: участники (шаринг и @упоминания) и уведомления.
// Правила как у Todoist/GitHub: владелец и участники видят и правят задачу;
// @username в названии или заметке добавляет человека участником и шлёт ему
// уведомление; владелец удаляет задачу у всех, участник выходит из неё.
package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// mentionRe — @логин в тексте задачи: латиница, начинается с буквы (как при регистрации).
var mentionRe = regexp.MustCompile(`@([a-zA-Z][a-zA-Z0-9_.-]{1,23})`)

// mentionUsernames — уникальные логины из title+subtitle (без повторов).
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

// shareTaskWith добавляет участников и шлёт им уведомления.
func (s *server) shareTaskWith(ctx context.Context, taskID string, users []model.User) (model.Task, error) {
	var task model.Task
	var err error
	for _, u := range users {
		me, _ := store.UserFrom(ctx)
		if u.ID == me.ID {
			continue // себя не добавляем
		}
		task, err = s.store.AddTaskMember(ctx, taskID, u.ID)
		if err != nil {
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
