package store

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Аккаунт в файловом хранилище: сессии устройств, смена пароля, удаление со всеми данными.

// SessionIDLen — сколько знаков хэша токена показываем как id сессии (его хватает, чтобы различать,
// но по нему нельзя войти: это не токен и даже не весь хэш).
const SessionIDLen = 12

// seenEvery — как часто обновлять «последний раз» у сессии.
const seenEvery = 5 * time.Minute

func (s *fileStore) Sessions(ctx context.Context) []model.Session {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	now := s.now()
	var out []model.Session
	for h, sess := range s.d.Sessions {
		if sess.UserID == uid && now.Before(sess.ExpiresAt) {
			out = append(out, model.Session{ID: h[:min(SessionIDLen, len(h))], Label: sess.Label, CreatedAt: sess.CreatedAt, LastSeen: sess.LastSeen})
		}
	}
	slices.SortFunc(out, func(a, b model.Session) int {
		return cmp.Or(b.LastSeen.Compare(a.LastSeen), strings.Compare(a.ID, b.ID))
	})
	return out
}

func (s *fileStore) DeleteSessionByID(ctx context.Context, id string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for h, sess := range s.d.Sessions {
		if sess.UserID == uid && len(id) == SessionIDLen && strings.HasPrefix(h, id) {
			delete(s.d.Sessions, h)
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *fileStore) DeleteOtherSessions(ctx context.Context, keepHash string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for h, sess := range s.d.Sessions {
		if sess.UserID == uid && h != keepHash {
			delete(s.d.Sessions, h)
		}
	}
	return s.save()
}

func (s *fileStore) SetPassword(ctx context.Context, passHash string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == uid {
			s.d.Users[i].PassHash = passHash
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *fileStore) DeleteUser(ctx context.Context) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := &s.d
	if !slices.ContainsFunc(d.Users, func(u storedUser) bool { return u.ID == uid }) {
		return ErrNotFound
	}
	mine := func(id int64) bool { return id == uid }
	// Свои события — вместе с их приглашёнными; в чужих событиях он больше не приглашён.
	for _, e := range d.Events {
		if mine(e.UserID) {
			delete(d.EventAttendees, e.ID)
		}
	}
	for id, list := range d.EventAttendees {
		d.EventAttendees[id] = slices.DeleteFunc(list, func(a storedAttendee) bool { return mine(a.UserID) })
	}
	d.Events = slices.DeleteFunc(d.Events, func(e model.Event) bool { return mine(e.UserID) })
	// Задачи, где он владелец, — удаляются; из чужих он выходит.
	d.Tasks = slices.DeleteFunc(d.Tasks, func(t model.Task) bool { return mine(t.OwnerID) })
	for i := range d.Tasks {
		d.Tasks[i].Members = slices.DeleteFunc(d.Tasks[i].Members, func(u model.User) bool { return mine(u.ID) })
	}
	d.Messages = slices.DeleteFunc(d.Messages, func(m model.Message) bool { return mine(m.UserID) })
	d.Notifications = slices.DeleteFunc(d.Notifications, func(n model.Notification) bool { return mine(n.UserID) })
	d.Integrations = slices.DeleteFunc(d.Integrations, func(it model.Integration) bool { return mine(it.UserID) })
	d.PushSubscriptions = slices.DeleteFunc(d.PushSubscriptions, func(p model.PushSubscription) bool { return mine(p.UserID) })
	d.Snoozes = slices.DeleteFunc(d.Snoozes, func(z model.Snooze) bool { return mine(z.UserID) })
	d.Memories = slices.DeleteFunc(d.Memories, func(m model.Memory) bool { return mine(m.UserID) })
	d.People = slices.DeleteFunc(d.People, func(p model.Person) bool { return mine(p.UserID) })
	d.Suggestions = slices.DeleteFunc(d.Suggestions, func(sg model.Suggestion) bool { return mine(sg.UserID) })
	delete(d.NotifySettings, uid)
	delete(d.Profiles, uid)
	prefix := fmt.Sprintf("%d|", uid)
	for k := range d.SentReminders {
		if strings.HasPrefix(k, prefix) {
			delete(d.SentReminders, k)
		}
	}
	for h, sess := range d.Sessions {
		if mine(sess.UserID) {
			delete(d.Sessions, h)
		}
	}
	d.Users = slices.DeleteFunc(d.Users, func(u storedUser) bool { return mine(u.ID) })
	return s.save()
}
