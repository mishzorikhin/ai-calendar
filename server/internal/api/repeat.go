// Повторяющиеся события приложения: «каждый вторник йога», «планёрка по будням».
//
// В хранилище — одна запись (Date — первый день серии, Repeat — правило, RepeatUntil и
// ExDates — конец и убранные дни). День, месяц, ассистент, напоминания и лента .ics получают
// вхождения через eventsBetween: у каждого тот же id, а Date — день вхождения. Правка по id
// меняет всю серию; «только этот день» убирает день из серии (ExDates).
//
// Повторы — только у своих событий: во внешние календари серия не уходит (у них свои повторы).
package api

import (
	"context"
	"slices"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// eventsBetween — события пользователя с from по to (ГГГГ-ММ-ДД) с развёрнутыми повторами
// и многодневными событиями (по вхождению на каждый день).
func (s *server) eventsBetween(ctx context.Context, from, to string) []model.Event {
	stored := s.store.EventsBetween(ctx, from, to)
	out := make([]model.Event, 0, len(stored))
	for _, e := range stored {
		if e.Repeat == model.RepeatNone && e.EndDate == "" {
			out = append(out, e)
		}
	}
	for _, e := range s.store.RepeatingEvents(ctx, from, to) {
		out = append(out, expandRepeat(e, from, to)...)
	}
	for _, e := range s.store.MultiDayEvents(ctx, from, to) {
		out = append(out, expandSpan(e, from, to)...)
	}
	return out
}

// expandSpan — дни многодневного события в окне [from, to]. Первый день — с начала до полуночи,
// последний — с полуночи до конца, средние (и все дни события «весь день») — на весь день.
// У каждого вхождения Span хранит исходные день и время: по ним шторка события правит запись.
func expandSpan(e model.Event, from, to string) []model.Event {
	first, err1 := time.Parse(time.DateOnly, e.Date)
	last, err2 := time.Parse(time.DateOnly, e.EndDate)
	lo, err3 := time.Parse(time.DateOnly, from)
	hi, err4 := time.Parse(time.DateOnly, to)
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		return nil
	}
	if lo.Before(first) {
		lo = first
	}
	if hi.After(last) {
		hi = last
	}
	var out []model.Event
	for d := lo; !d.After(hi); d = d.AddDate(0, 0, 1) {
		occ := e
		occ.Date = d.Format(time.DateOnly)
		occ.Span = &model.EventSpan{Date: e.Date, Start: e.Start, End: e.End}
		occ.Highlight = e.Highlight && d.Equal(first)
		switch {
		case e.AllDay:
		case d.Equal(first):
			occ.End = dayMinutes
		case d.Equal(last):
			occ.Start = 0
		default:
			occ.Start, occ.End, occ.AllDay = 0, dayMinutes, true
		}
		out = append(out, occ)
	}
	return out
}

// maxOccurrences — предел вхождений одной серии за запрос (окно ленты .ics — чуть больше года).
const maxOccurrences = 800

// expandRepeat — вхождения серии в днях [from, to]. Чистая функция.
func expandRepeat(e model.Event, from, to string) []model.Event {
	start, err := time.Parse(time.DateOnly, e.Date)
	if err != nil {
		return nil
	}
	lo, err1 := time.Parse(time.DateOnly, from)
	hi, err2 := time.Parse(time.DateOnly, to)
	if err1 != nil || err2 != nil {
		return nil
	}
	if e.RepeatUntil != "" {
		if until, err := time.Parse(time.DateOnly, e.RepeatUntil); err == nil && until.Before(hi) {
			hi = until
		}
	}
	if lo.Before(start) {
		lo = start
	}
	var out []model.Event
	add := func(d time.Time) {
		day := d.Format(time.DateOnly)
		if slices.Contains(e.ExDates, day) {
			return
		}
		occ := e
		occ.Date = day
		// «Новое» — только у первого вхождения, а не у всей серии.
		occ.Highlight = e.Highlight && day == e.Date
		out = append(out, occ)
	}
	for d := range occurrences(e.Repeat, start, lo, hi) {
		if len(out) >= maxOccurrences {
			break
		}
		add(d)
	}
	return out
}

// occurrences — дни серии с правилом r, начатой start, в окне [lo, hi] (lo ≥ start).
func occurrences(r model.Repeat, start, lo, hi time.Time) func(yield func(time.Time) bool) {
	return func(yield func(time.Time) bool) {
		if hi.Before(lo) {
			return
		}
		switch r {
		case model.RepeatDaily, model.RepeatWeekdays:
			for d := lo; !d.After(hi); d = d.AddDate(0, 0, 1) {
				if r == model.RepeatWeekdays && (d.Weekday() == time.Saturday || d.Weekday() == time.Sunday) {
					continue
				}
				if !yield(d) {
					return
				}
			}
		case model.RepeatWeekly:
			// Первый день окна с тем же днём недели, что у начала серии.
			shift := (int(start.Weekday()) - int(lo.Weekday()) + 7) % 7
			for d := lo.AddDate(0, 0, shift); !d.After(hi); d = d.AddDate(0, 0, 7) {
				if !yield(d) {
					return
				}
			}
		case model.RepeatMonthly, model.RepeatYearly:
			// Тот же день месяца (года); в месяцах без такого дня (31-е, 29 февраля) — пропуск, как в Google.
			step := 1
			if r == model.RepeatYearly {
				step = 12
			}
			for i := 0; ; i += step {
				d := time.Date(start.Year(), start.Month()+time.Month(i), start.Day(), 0, 0, 0, 0, time.UTC)
				if d.After(hi) {
					return
				}
				if d.Day() != start.Day() || d.Before(lo) {
					continue
				}
				if !yield(d) {
					return
				}
			}
		}
	}
}

// validateRepeat проверяет правило повтора для события, которое начинается date.
func validateRepeat(r model.Repeat, until, date string) error {
	if !r.Valid() {
		return badRequest("Неизвестный повтор: %q", r)
	}
	if until == "" {
		return nil
	}
	if r == model.RepeatNone {
		return badRequest("Дата окончания нужна только повторяющемуся событию")
	}
	if _, err := parseDate(until); err != nil {
		return err
	}
	if until < date {
		return badRequest("Повтор не может закончиться раньше первого дня")
	}
	return nil
}

// dayShift — на сколько дней вхождение occurrence перенесли на date.
func dayShift(occurrence, date string) (int, bool) {
	o, err1 := time.Parse(time.DateOnly, occurrence)
	d, err2 := time.Parse(time.DateOnly, date)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return int(d.Sub(o).Hours() / 24), true
}

// addDays сдвигает дату ГГГГ-ММ-ДД; пустая остаётся пустой.
func addDays(date string, days int) string {
	d, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	return d.AddDate(0, 0, days).Format(time.DateOnly)
}

// seriesPatch переводит правку одного вхождения серии в правку всей серии:
//   - перенос вхождения на date сдвигает на столько же дней начало серии, её конец и убранные дни;
//   - снятый повтор оставляет событие в дне вхождения (или в date), а не в первом дне серии.
//
// Без occurrence (ассистент, старые клиенты) date — новое начало серии, как раньше.
func seriesPatch(cur model.Event, occurrence string, patch *model.EventPatch) error {
	if cur.Repeat == model.RepeatNone || occurrence == "" {
		return nil
	}
	if patch.Repeat != nil && *patch.Repeat == model.RepeatNone {
		if patch.Date == nil {
			patch.Date = &occurrence
		}
		return nil
	}
	if patch.Date == nil {
		return nil
	}
	days, ok := dayShift(occurrence, *patch.Date)
	if !ok {
		return badRequest("Не удалось перенести серию")
	}
	start := addDays(cur.Date, days)
	patch.Date = &start
	if days == 0 {
		return nil
	}
	if cur.RepeatUntil != "" && patch.RepeatUntil == nil {
		until := addDays(cur.RepeatUntil, days)
		patch.RepeatUntil = &until
	}
	if len(cur.ExDates) > 0 {
		shifted := make([]string, len(cur.ExDates))
		for i, d := range cur.ExDates {
			shifted[i] = addDays(d, days)
		}
		patch.ExDates = &shifted
	}
	return nil
}
