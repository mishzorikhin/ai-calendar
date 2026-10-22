package api

import (
	"slices"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// span — отрезок дня в минутах от полуночи [Start, End).
type span struct{ Start, End int }

// slotQuery — где искать окна: границы, день недели, «сейчас» (−1 — не сегодня) и нужная длина.
type slotQuery struct {
	From, To int
	Weekday  time.Weekday
	// Now — текущее время для сегодняшнего дня: окна начинаются не раньше ближайших 15 минут.
	Now      int
	Duration int
}

// dayBounds — где искать окна в этот день: весь активный день по профилю или только рабочие часы.
// ok=false — просили рабочие часы, а день у пользователя выходной.
func dayBounds(p model.Profile, weekday time.Weekday, workOnly bool) (from, to int, ok bool) {
	from, to = p.DayBounds()
	if !workOnly {
		return from, to, true
	}
	if !p.WorkDay(weekday) {
		return 0, 0, false
	}
	return max(from, p.WorkStart), min(to, p.WorkEnd), true
}

// busySpans — занятые отрезки дня: события со временем (с перерывом buffer до и после, с дорогой
// перед началом) и «святые» блоки профиля в этот день недели. Отсортированы по началу.
func busySpans(p model.Profile, weekday time.Weekday, events []model.Event) []span {
	var busy []span
	for _, e := range events {
		if e.AllDay {
			continue // дни рождения и праздники время не занимают
		}
		busy = append(busy, span{e.Start - p.BufferMinutes - e.Travel, e.End + p.BufferMinutes})
	}
	for _, b := range p.Protected {
		if b.On(weekday) {
			busy = append(busy, span{b.Start, b.End})
		}
	}
	slices.SortFunc(busy, func(a, b span) int { return a.Start - b.Start })
	return busy
}

// freeSlots — свободные окна не короче q.Duration между занятыми отрезками. Начало окна
// округляется вверх до 5 минут, чтобы ассистент не предлагал «встречу в 10:07».
func freeSlots(q slotQuery, busy []span) []span {
	cursor := q.From
	if q.Now >= 0 {
		cursor = max(cursor, (q.Now+14)/15*15)
	}
	var free []span
	add := func(end int) {
		start := (cursor + 4) / 5 * 5
		if end-start >= q.Duration {
			free = append(free, span{start, end})
		}
	}
	for _, b := range busy {
		if b.End <= cursor {
			continue
		}
		if b.Start >= q.To {
			break
		}
		add(b.Start)
		cursor = max(cursor, b.End)
	}
	if cursor < q.To {
		add(q.To)
	}
	return free
}
