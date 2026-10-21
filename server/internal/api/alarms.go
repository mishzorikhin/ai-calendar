// Свои напоминания без события: «напомни позвонить маме в 18:00», «через 20 минут».
// Хранятся как отложенные уведомления (store.Snooze), поэтому их рассылает тот же цикл,
// что и «Отложить» из уведомления, и тихие часы их не глушат: время назначено явно.
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

// maxAlarmAhead — насколько вперёд можно поставить напоминание.
const maxAlarmAhead = 366 * 24 * time.Hour

// alarmView — напоминание в списке.
type alarmView struct {
	ID   int64          `json:"id"`
	At   time.Time      `json:"at"`
	Text string         `json:"text"`
	Kind model.PushKind `json:"kind"`
}

func viewOfSnooze(z model.Snooze) alarmView {
	return alarmView{ID: z.ID, At: z.At, Text: z.Message.Title, Kind: z.Message.Kind}
}

func (s *server) listAlarms(w http.ResponseWriter, r *http.Request) error {
	snoozes := s.store.Snoozes(r.Context())
	out := make([]alarmView, 0, len(snoozes))
	for _, z := range snoozes {
		out = append(out, viewOfSnooze(z))
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

type alarmInput struct {
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

// createAlarm — общая часть хендлера и инструмента ассистента.
func (s *server) createAlarm(ctx context.Context, text string, at time.Time) (model.Snooze, error) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > maxTitle {
		return model.Snooze{}, badRequest("Текст напоминания обязателен и не длиннее %d символов", maxTitle)
	}
	now := s.cal.now()
	// Минута на дорогу запроса: «через 0 минут» тоже допустимо.
	if at.Before(now.Add(-time.Minute)) {
		return model.Snooze{}, badRequest("Это время уже прошло")
	}
	if at.After(now.Add(maxAlarmAhead)) {
		return model.Snooze{}, badRequest("Напоминание можно поставить не дальше чем на год вперёд")
	}
	tag := make([]byte, 6)
	_, _ = rand.Read(tag)
	z, err := s.store.AddSnooze(ctx, at, model.PushMessage{
		Kind:  model.PushReminder,
		Title: text,
		Body:  "Напоминание",
		URL:   "/",
		Tag:   "reminder:" + hex.EncodeToString(tag),
	})
	if errors.Is(err, store.ErrLimit) {
		return model.Snooze{}, &apiError{Status: http.StatusConflict, Message: "Слишком много напоминаний — удалите ненужные"}
	}
	return z, err
}

func (s *server) createAlarmHandler(w http.ResponseWriter, r *http.Request) error {
	var in alarmInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.At.IsZero() {
		return badRequest("Нужно время напоминания (at)")
	}
	z, err := s.createAlarm(r.Context(), in.Text, in.At)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, viewOfSnooze(z))
	return nil
}

func (s *server) deleteAlarm(w http.ResponseWriter, r *http.Request) error {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return notFound("Напоминание")
	}
	if err := s.store.DeleteSnooze(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Напоминание")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// alarmOpts — как доставлять своё напоминание и отложенные: срочно, хранить час.
var alarmOpts = pushOpts{ttl: time.Hour, urgency: webpush.UrgencyHigh}
