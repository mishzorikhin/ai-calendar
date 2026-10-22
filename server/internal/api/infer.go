// Выводы из поведения: раз в сутки по событиям и задачам пользователя ассистент делает догадки —
// обычная длительность дел, привычные дни и время, задачи, которые всё время переносят. Догадки
// ложатся в память неподтверждёнными (source: inferred) и в промпт не идут, пока человек не нажмёт
// «Верно». Отклонённая догадка остаётся в памяти с rejected и по тому же ключу не предлагается.
package api

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

const (
	// inferWindow — за сколько дней смотрим на события.
	inferWindow = 60
	// inferMinEvents — сколько событий одного типа нужно, чтобы делать вывод.
	inferMinEvents = 5
	// inferPostponed — после стольких переносов срока задача считается «вечно откладываемой».
	inferPostponed = 3
	// inferEvery — как часто пересчитывать догадки одного пользователя.
	inferEvery = 24 * time.Hour
)

// badgeNames — тип события в именительном падеже для текста догадки.
var badgeNames = map[model.Badge]string{
	model.BadgeWork: "работа", model.BadgeSport: "спорт", model.BadgeFood: "еда",
	model.BadgeRead: "чтение", model.BadgeRoutine: "дела", model.BadgeSleep: "сон",
}

// dayPart — часть суток события.
type dayPart string

var partNames = map[dayPart]string{"morning": "утром", "afternoon": "днём", "night": "вечером"}

// partOfDay — часть суток по началу события (как на клиенте: до 12 — утро, до 18 — день).
func partOfDay(start int) dayPart {
	switch {
	case start < 12*60:
		return "morning"
	case start < 18*60:
		return "afternoon"
	}
	return "night"
}

func median(xs []int) int {
	s := slices.Sorted(slices.Values(xs))
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

// durationKey — ключ догадки о длительности; по нему же клиент берёт длительность по умолчанию.
func durationKey(b model.Badge, minutes int) string {
	return fmt.Sprintf("duration:%s:%d", b, minutes)
}

// inferHabits — догадки по своим событиям за inferWindow дней до today и по задачам. Чистая функция.
func inferHabits(events []model.Event, tasks []model.Task, today string) []model.Memory {
	from := addDays(today, -inferWindow)
	byBadge := map[model.Badge][]model.Event{}
	for _, e := range events {
		if e.AllDay || e.Source != "" || e.Invite != nil || e.Span != nil || e.Date < from || e.Date >= today {
			continue
		}
		byBadge[e.Badge] = append(byBadge[e.Badge], e)
	}
	var out []model.Memory
	badges := slices.Sorted(func(yield func(model.Badge) bool) {
		for b := range byBadge {
			if !yield(b) {
				return
			}
		}
	})
	for _, b := range badges {
		list := byBadge[b]
		if len(list) < inferMinEvents {
			continue
		}
		durations := make([]int, len(list))
		for i, e := range list {
			durations[i] = e.End - e.Start
		}
		// Длительность — медиана, округлённая до 5 минут; про «час» не говорим — это и так по умолчанию.
		if d := (median(durations) + 2) / 5 * 5; d != 60 && d >= 15 {
			out = append(out, model.Memory{Kind: model.MemoryPreference, Key: durationKey(b, d),
				Text: fmt.Sprintf("Обычно %s длится %s", badgeNames[b], durationText(d))})
		}
		if m, ok := typicalTime(b, list); ok {
			out = append(out, m)
		}
	}
	for _, t := range tasks {
		if t.Done || t.Postponed < inferPostponed || t.Role == model.TaskRoleMember {
			continue
		}
		out = append(out, model.Memory{Kind: model.MemoryOther, Key: "postponed:" + t.ID,
			Text: fmt.Sprintf("Задачу «%s» переносили уже %s — возможно, её стоит разбить на шаги или отпустить",
				t.Title, plural(t.Postponed, "раз", "раза", "раз"))})
	}
	for i := range out {
		out[i].Source, out[i].Confirmed = model.SourceInferred, false
	}
	return out
}

func durationText(m int) string {
	if m < 60 {
		return fmt.Sprintf("%d минут", m)
	}
	return strings.TrimSuffix(hoursLabel(m), " ч") + " ч"
}

// typicalTime — дни недели и часть суток, когда обычно бывают события этого типа: дни, где их
// было хотя бы три, в одной части суток и на них приходится не меньше 60% всех событий типа.
func typicalTime(b model.Badge, list []model.Event) (model.Memory, bool) {
	type slot struct {
		day  int
		part dayPart
	}
	count := map[slot]int{}
	for _, e := range list {
		d, _ := time.Parse(time.DateOnly, e.Date)
		count[slot{int(d.Weekday()), partOfDay(e.Start)}]++
	}
	byPart := map[dayPart][]int{}
	covered := map[dayPart]int{}
	for s, n := range count {
		if n >= 3 {
			byPart[s.part] = append(byPart[s.part], s.day)
			covered[s.part] += n
		}
	}
	for _, part := range []dayPart{"morning", "afternoon", "night"} {
		days := byPart[part]
		if len(days) == 0 || covered[part]*10 < len(list)*6 || len(days) > 5 {
			continue
		}
		slices.Sort(days)
		key := make([]string, len(days))
		for i, d := range days {
			key[i] = strconv.Itoa(d)
		}
		return model.Memory{Kind: model.MemoryHabit,
			Key:  fmt.Sprintf("time:%s:%s:%s", b, strings.Join(key, ","), part),
			Text: fmt.Sprintf("%s — обычно %s %s", upperFirst(badgeNames[b]), daysLabel(days), partNames[part])}, true
	}
	return model.Memory{}, false
}

// inferrer — когда кому последний раз считали догадки (в памяти процесса; повторы отсекает ключ).
type inferrer struct {
	mu   sync.Mutex
	last map[int64]time.Time
}

func (in *inferrer) due(userID int64, now time.Time) bool {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.last == nil {
		in.last = map[int64]time.Time{}
	}
	if now.Sub(in.last[userID]) < inferEvery {
		return false
	}
	in.last[userID] = now
	return true
}

// inferAll — догадки для всех пользователей, кому пора (раз в сутки), с включённой памятью.
func (s *server) inferAll(ctx context.Context, now time.Time) {
	for _, id := range s.store.UserIDs(ctx) {
		if ctx.Err() != nil || !s.inferrer.due(id, now) {
			continue
		}
		u, err := s.store.UserByID(ctx, id)
		if err != nil {
			continue
		}
		s.inferFor(store.WithUser(ctx, u), u, now)
	}
}

// inferFor сохраняет новые догадки пользователя: по ключу каждая — один раз (и после отказа тоже).
func (s *server) inferFor(ctx context.Context, u model.User, now time.Time) int {
	if !s.profileFor(ctx).Memory {
		return 0
	}
	today := now.In(s.cal.location(u)).Format(time.DateOnly)
	known := map[string]bool{}
	for _, m := range s.store.Memories(ctx) {
		if m.Key != "" {
			known[m.Key] = true
		}
	}
	added := 0
	for _, m := range inferHabits(s.eventsBetween(ctx, addDays(today, -inferWindow), today), s.store.Tasks(ctx), today) {
		if known[m.Key] {
			continue
		}
		if _, err := s.store.AddMemory(ctx, m); err != nil {
			break // предел памяти — остальное в следующий раз
		}
		added++
	}
	return added
}
