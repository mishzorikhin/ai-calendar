// Поиск по своим событиям и задачам: GET /api/search?q=.
package api

import (
	"cmp"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

const (
	searchMinRunes = 2
	searchMaxRunes = 100
	searchEvents   = 30
	searchTasks    = 20
)

type searchResult struct {
	Events []model.Event `json:"events"`
	Tasks  []model.Task  `json:"tasks"`
}

// nearestDate — день, к которому вести из поиска: у серии — ближайшее вхождение с today
// (или последнее прошедшее), у остальных — первый день.
func nearestDate(e model.Event, today time.Time) string {
	if e.Repeat == model.RepeatNone {
		return e.Date
	}
	from := today.Format(time.DateOnly)
	if next := expandRepeat(e, from, today.AddDate(1, 1, 0).Format(time.DateOnly)); len(next) > 0 {
		return next[0].Date
	}
	if past := expandRepeat(e, e.Date, from); len(past) > 0 {
		return past[len(past)-1].Date
	}
	return e.Date
}

func (s *server) search(w http.ResponseWriter, r *http.Request) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if n := utf8.RuneCountInString(q); n < searchMinRunes || n > searchMaxRunes {
		return badRequest("Запрос — от %d до %d символов", searchMinRunes, searchMaxRunes)
	}
	ctx := r.Context()
	user, _ := store.UserFrom(ctx)
	today := time.Now().In(s.cal.location(user))
	todayISO := today.Format(time.DateOnly)
	// Своё событие хранится одной записью; серию ведём к ближайшему вхождению.
	events := s.store.SearchEvents(ctx, q, searchEvents)
	for i := range events {
		events[i].Date = nearestDate(events[i], today)
	}
	// Сначала предстоящие (ближайшие первыми), затем прошедшие (свежие первыми).
	slices.SortStableFunc(events, func(a, b model.Event) int {
		af, bf := a.Date >= todayISO, b.Date >= todayISO
		switch {
		case af && bf:
			return cmp.Or(strings.Compare(a.Date, b.Date), a.Start-b.Start)
		case af:
			return -1
		case bf:
			return 1
		default:
			return cmp.Or(strings.Compare(b.Date, a.Date), a.Start-b.Start)
		}
	})
	var tasks []model.Task
	for _, t := range s.store.Tasks(ctx) {
		if len(tasks) >= searchTasks {
			break
		}
		if containsFold(t.Title, q) || containsFold(t.Subtitle, q) || containsFold(string(t.Category), q) {
			tasks = append(tasks, t)
		}
	}
	writeJSON(w, http.StatusOK, searchResult{Events: nonNil(events), Tasks: nonNil(tasks)})
	return nil
}

// containsFold — подстрока без учёта регистра; «ё» и «е» не различаем.
func containsFold(s, sub string) bool {
	fold := func(v string) string { return strings.ReplaceAll(strings.ToLower(v), "ё", "е") }
	return strings.Contains(fold(s), fold(sub))
}
