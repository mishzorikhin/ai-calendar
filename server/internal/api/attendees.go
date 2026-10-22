// Участники встреч: владелец события приглашает пользователей сервера, у них событие появляется
// только для чтения с кнопками «Приду» / «Не приду». Отклонённое приглашение из дней пропадает.
package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

// invitedBetween — чужие события с приглашением в [from, to] по вхождениям: без отклонённых,
// только для чтения, без чужих напоминаний (у приглашённого — свои настройки по умолчанию).
func (s *server) invitedBetween(ctx context.Context, from, to string) []model.Event {
	var out []model.Event
	for _, e := range s.store.InvitedEvents(ctx, from, to) {
		if e.Invite == nil || e.Invite.Status == model.RSVPDeclined {
			continue
		}
		e.ReadOnly, e.Reminders, e.Highlight, e.Source = true, nil, false, ""
		e.Travel = 0 // дорогу каждый задаёт себе сам
		switch {
		case e.Repeat != model.RepeatNone:
			out = append(out, expandRepeat(e, from, to)...)
		case e.EndDate != "":
			out = append(out, expandSpan(e, from, to)...)
		default:
			out = append(out, e)
		}
	}
	return out
}

// withAttendees дописывает к своим событиям список приглашённых.
func (s *server) withAttendees(ctx context.Context, events []model.Event) []model.Event {
	var ids []string
	for _, e := range events {
		if e.Invite == nil && !slices.Contains(ids, e.ID) {
			ids = append(ids, e.ID)
		}
	}
	if len(ids) == 0 {
		return events
	}
	byID := s.store.Attendees(ctx, ids)
	for i := range events {
		if events[i].Invite == nil {
			events[i].Attendees = byID[events[i].ID]
		}
	}
	return events
}

// resolveAttendees — пользователи по логинам для приглашения: без себя и повторов, не больше MaxAttendees.
func (s *server) resolveAttendees(ctx context.Context, names []string) ([]model.User, error) {
	me, _ := store.UserFrom(ctx)
	users, unknown := s.resolveUsernames(ctx, names)
	if len(unknown) > 0 {
		return nil, badRequest("Нет пользователей: @%s", strings.Join(unknown, ", @"))
	}
	users = slices.DeleteFunc(users, func(u model.User) bool { return u.ID == me.ID })
	if len(users) > model.MaxAttendees {
		return nil, badRequest("Не больше %d участников встречи", model.MaxAttendees)
	}
	return users, nil
}

// setAttendees заменяет приглашённых и сообщает новым о приглашении.
func (s *server) setAttendees(ctx context.Context, ev model.Event, users []model.User) ([]model.Attendee, error) {
	before := s.store.Attendees(ctx, []string{ev.ID})[ev.ID]
	list, err := s.store.SetAttendees(ctx, ev.ID, users)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		if !slices.ContainsFunc(before, func(a model.Attendee) bool { return a.UserID == u.ID }) {
			s.notifyAttendee(ctx, u, ev, "Приглашение: «%s»", "Приглашение от ")
		}
	}
	return list, nil
}

// whenLabel — «22.10 в 10:00», «22.10, весь день».
func whenLabel(e model.Event) string {
	day := e.Date
	if d, err := time.Parse(time.DateOnly, e.Date); err == nil {
		day = d.Format("02.01")
	}
	if e.AllDay {
		return day + ", весь день"
	}
	return day + " в " + clock(e.Start)
}

func actorName(u model.User) string {
	if u.Name != "" {
		return u.Name
	}
	return "@" + u.Username
}

// notifyAttendee — уведомление в аккаунте и push приглашённому (текст: формат с названием, тело: префикс + кто).
func (s *server) notifyAttendee(ctx context.Context, to model.User, ev model.Event, textFmt, bodyPrefix string) {
	actor, _ := store.UserFrom(ctx)
	card := otherUser(actor)
	text := fmt.Sprintf(textFmt, ev.Title) + " · " + whenLabel(ev)
	_ = s.store.AddNotification(ctx, model.Notification{UserID: to.ID, From: &card, EventID: ev.ID, Date: ev.Date, Text: text})
	s.pushToUser(to, model.PushMessage{
		Kind:  model.PushShare,
		Title: ev.Title,
		Body:  bodyPrefix + actorName(actor) + " · " + whenLabel(ev),
		URL:   "/#day/" + ev.Date,
		Tag:   "invite:" + ev.ID,
	}, pushOpts{ttl: 3 * 24 * time.Hour, urgency: webpush.UrgencyNormal})
}

// notifyAttendeesChange — владелец перенёс или отменил встречу: сообщаем тем, кто не отказался.
func (s *server) notifyAttendeesChange(ctx context.Context, attendees []model.Attendee, ev model.Event, textFmt, bodyPrefix string) {
	for _, a := range attendees {
		if a.Status == model.RSVPDeclined {
			continue
		}
		if u, err := s.store.UserByID(ctx, a.UserID); err == nil {
			s.notifyAttendee(ctx, u, ev, textFmt, bodyPrefix)
		}
	}
}

// answerInvite сохраняет ответ приглашённого и, если он изменился, сообщает владельцу встречи.
func (s *server) answerInvite(ctx context.Context, ev model.Event, status model.RSVP) error {
	if err := s.store.SetRSVP(ctx, ev.ID, status); err != nil {
		return err
	}
	if status == ev.Invite.Status || status == model.RSVPPending {
		return nil
	}
	if owner, err := s.store.UserByID(ctx, ev.UserID); err == nil {
		textFmt, body := "Придёт: «%s»", "Придёт "
		if status == model.RSVPDeclined {
			textFmt, body = "Не придёт: «%s»", "Не придёт "
		}
		s.notifyAttendee(ctx, owner, ev, textFmt, body)
	}
	return nil
}

type rsvpInput struct {
	Status model.RSVP `json:"status"`
}

// rsvp — ответ приглашённого: accepted, declined или снова pending. Владельцу — уведомление.
func (s *server) rsvp(w http.ResponseWriter, r *http.Request) error {
	var in rsvpInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if !in.Status.Valid() {
		return badRequest("status: accepted, declined или pending")
	}
	ctx := r.Context()
	ev, err := s.store.InvitedEvent(ctx, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		return notFound("Приглашение")
	}
	if err != nil {
		return err
	}
	if err := s.answerInvite(ctx, ev, in.Status); err != nil {
		return err
	}
	ev.Invite.Status = in.Status
	writeJSON(w, http.StatusOK, ev.Invite)
	return nil
}

func (s *server) toolRespondInvitation(ctx context.Context, args map[string]any) (string, toolMeta) {
	status := model.RSVP(strArg(args, "answer"))
	if status != model.RSVPAccepted && status != model.RSVPDeclined {
		return `{"error":"answer: accepted или declined"}`, toolMeta{}
	}
	ev, err := s.store.InvitedEvent(ctx, strArg(args, "event_id"))
	if err != nil {
		return `{"error":"приглашение не найдено — id из get_day_schedule (invited_by)"}`, toolMeta{}
	}
	if err := s.answerInvite(ctx, ev, status); err != nil {
		return `{"error":"не удалось ответить"}`, toolMeta{}
	}
	return `{"ok":true}`, toolMeta{detail: ev.Title, date: ev.Date}
}
