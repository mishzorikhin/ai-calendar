package store

import (
	"context"
	"slices"
	"strings"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// storedAttendee — приглашённый в файле: имя и логин берутся из пользователя при чтении.
type storedAttendee struct {
	UserID int64      `json:"userId"`
	Status model.RSVP `json:"status"`
}

// attendeesOf — приглашённые события с актуальными именами (без удалённых пользователей).
func (s *fileStore) attendeesOf(eventID string) []model.Attendee {
	var out []model.Attendee
	for _, a := range s.d.EventAttendees[eventID] {
		if u, ok := s.userCard(a.UserID); ok {
			out = append(out, model.Attendee{UserID: u.ID, Username: u.Username, Name: u.Name, Status: a.Status})
		}
	}
	return out
}

func invited(list []storedAttendee, uid int64) (model.RSVP, bool) {
	i := slices.IndexFunc(list, func(a storedAttendee) bool { return a.UserID == uid })
	if i < 0 {
		return "", false
	}
	return list[i].Status, true
}

func (s *fileStore) SetAttendees(ctx context.Context, eventID string, users []model.User) ([]model.Attendee, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !slices.ContainsFunc(s.d.Events, func(e model.Event) bool { return e.ID == eventID && e.UserID == uid }) {
		return nil, ErrNotFound
	}
	prev := s.d.EventAttendees[eventID]
	next := make([]storedAttendee, 0, len(users))
	for _, u := range users {
		status, ok := invited(prev, u.ID)
		if !ok {
			status = model.RSVPPending
		}
		next = append(next, storedAttendee{UserID: u.ID, Status: status})
	}
	if s.d.EventAttendees == nil {
		s.d.EventAttendees = map[string][]storedAttendee{}
	}
	if len(next) == 0 {
		delete(s.d.EventAttendees, eventID)
	} else {
		s.d.EventAttendees[eventID] = next
	}
	return s.attendeesOf(eventID), s.save()
}

func (s *fileStore) Attendees(ctx context.Context, ids []string) map[string][]model.Attendee {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string][]model.Attendee{}
	for _, id := range ids {
		list := s.d.EventAttendees[id]
		if len(list) == 0 {
			continue
		}
		_, isGuest := invited(list, uid)
		isOwner := slices.ContainsFunc(s.d.Events, func(e model.Event) bool { return e.ID == id && e.UserID == uid })
		if isOwner || isGuest {
			out[id] = s.attendeesOf(id)
		}
	}
	return out
}

// overlaps — запись события может дать вхождения в [from, to]: сама дата, серия или многодневное.
func overlaps(e model.Event, from, to string) bool {
	switch {
	case e.Repeat != model.RepeatNone:
		return e.Date <= to && (e.RepeatUntil == "" || e.RepeatUntil >= from)
	case e.EndDate != "":
		return e.Date <= to && e.EndDate >= from
	default:
		return e.Date >= from && e.Date <= to
	}
}

// asInvite — чужое событие глазами приглашённого: с приглашением и без чужих напоминаний.
func (s *fileStore) asInvite(e model.Event, status model.RSVP) model.Event {
	owner, _ := s.userCard(e.UserID)
	e.Invite = &model.Invite{From: owner, Status: status}
	e.TaskID = "" // задача владельца приглашённому не видна
	return e
}

func (s *fileStore) InvitedEvents(ctx context.Context, from, to string) []model.Event {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		status, ok := invited(s.d.EventAttendees[e.ID], uid)
		if ok && overlaps(e, from, to) {
			out = append(out, s.asInvite(e, status))
		}
	}
	return out
}

func (s *fileStore) InvitedEvent(ctx context.Context, id string) (model.Event, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Event{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	i := slices.IndexFunc(s.d.Events, func(e model.Event) bool { return e.ID == id })
	if i < 0 {
		return model.Event{}, ErrNotFound
	}
	status, ok := invited(s.d.EventAttendees[id], uid)
	if !ok {
		return model.Event{}, ErrNotFound
	}
	return s.asInvite(s.d.Events[i], status), nil
}

func (s *fileStore) SetRSVP(ctx context.Context, eventID string, status model.RSVP) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.d.EventAttendees[eventID]
	i := slices.IndexFunc(list, func(a storedAttendee) bool { return a.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	list[i].Status = status
	return s.save()
}

// containsFold — подстрока без учёта регистра (и «ё» = «е»).
func containsFold(s, sub string) bool {
	fold := func(v string) string { return strings.ReplaceAll(strings.ToLower(v), "ё", "е") }
	return strings.Contains(fold(s), fold(sub))
}

func (s *fileStore) SearchEvents(ctx context.Context, query string, limit int) []model.Event {
	uid, err := s.uid(ctx)
	if err != nil || strings.TrimSpace(query) == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for i := len(s.d.Events) - 1; i >= 0 && len(out) < limit; i-- {
		e := s.d.Events[i]
		if e.UserID == uid && (containsFold(e.Title, query) || containsFold(e.Subtitle, query) || containsFold(e.Notes, query)) {
			out = append(out, e)
		}
	}
	return out
}
