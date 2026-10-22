// Обзор недели: часы встреч по типам и дням, время для сосредоточенной работы, закрытые задачи,
// сравнение с обычной неделей. Расчёт — чистая weekInsights.
package api

import (
	"net/http"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// focusBlock — свободный отрезок в рабочие часы, который считается временем для сосредоточенной работы.
const focusBlock = 90

// insightDay — день в обзоре недели.
type insightDay struct {
	Date    string `json:"date"`
	Minutes int    `json:"minutes"`
	Events  int    `json:"events"`
}

// weekReport — обзор недели (поля совпадают с WeekInsights в src/domain/types.ts).
type weekReport struct {
	Start string       `json:"start"`
	Days  []insightDay `json:"days"`
	// ByBadge — минуты встреч по типам событий.
	ByBadge map[model.Badge]int `json:"byBadge"`
	Minutes int                 `json:"minutes"`
	// Average — сколько минут встреч в среднем за четыре прошлые недели.
	Average int `json:"average"`
	// Focus — минуты свободных отрезков от 90 минут в рабочие часы.
	Focus int `json:"focus"`
	// Done — задачи, закрытые на этой неделе.
	Done    int    `json:"done"`
	Busiest string `json:"busiest,omitempty"`
}

// weekInsights — обзор недели с понедельника start. events — с start−28 дней до конца недели
// (развёрнутые по дням), loc — пояс пользователя для времени закрытия задач.
func weekInsights(start string, events []model.Event, tasks []model.Task, p model.Profile, loc *time.Location) weekReport {
	end := addDays(start, 7)
	r := weekReport{Start: start, ByBadge: map[model.Badge]int{}, Days: make([]insightDay, 7)}
	byDay := map[string][]model.Event{}
	past := 0
	for _, e := range events {
		if e.AllDay || e.Invite != nil && e.Invite.Status == model.RSVPDeclined {
			continue
		}
		mins := e.End - e.Start
		switch {
		case e.Date >= start && e.Date < end:
			byDay[e.Date] = append(byDay[e.Date], e)
			r.ByBadge[e.Badge] += mins
			r.Minutes += mins
		case e.Date >= addDays(start, -28) && e.Date < start:
			past += mins
		}
	}
	r.Average = past / 4
	most := 0
	for i := range 7 {
		date := addDays(start, i)
		day := insightDay{Date: date, Events: len(byDay[date])}
		for _, e := range byDay[date] {
			day.Minutes += e.End - e.Start
		}
		if day.Minutes > most {
			most, r.Busiest = day.Minutes, date
		}
		r.Days[i] = day
		d, _ := time.Parse(time.DateOnly, date)
		if from, to, ok := dayBounds(p, d.Weekday(), true); ok {
			for _, f := range freeSlots(slotQuery{From: from, To: to, Weekday: d.Weekday(), Now: -1, Duration: focusBlock},
				busySpans(p, d.Weekday(), byDay[date])) {
				r.Focus += f.End - f.Start
			}
		}
	}
	for _, t := range tasks {
		// Совместную задачу мог закрыть другой участник — считаем только свои.
		if t.DoneAt.IsZero() || t.Role == model.TaskRoleMember {
			continue
		}
		if day := t.DoneAt.In(loc).Format(time.DateOnly); day >= start && day < end {
			r.Done++
		}
	}
	return r
}

func (s *server) weekInsightsHandler(w http.ResponseWriter, r *http.Request) error {
	u, _ := store.UserFrom(r.Context())
	loc := s.cal.location(u)
	start := r.URL.Query().Get("start")
	if start == "" {
		start = s.cal.now().In(loc).Format(time.DateOnly)
	}
	if _, err := time.Parse(time.DateOnly, start); err != nil {
		return badRequest("start — дата ГГГГ-ММ-ДД")
	}
	start = weekStart(start)
	events := s.eventsBetween(r.Context(), addDays(start, -28), addDays(start, 6))
	writeJSON(w, http.StatusOK, weekInsights(start, events, s.store.Tasks(r.Context()), s.profileFor(r.Context()), loc))
	return nil
}
