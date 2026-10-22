// Привычки и отметки задач: серия дней подряд, отметка «сделано сегодня», время закрытия задачи.
package api

import (
	"slices"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// habitStreak — сколько периодов подряд привычка выполнена, считая назад от today. Сегодняшний
// (или текущей недели) период ещё может быть не отмечен — тогда серия считается с прошлого.
// daily — дни, weekdays — будни (выходные не прерывают), weekly — недели с понедельника.
// Та же функция — domain/habit.ts.
func habitStreak(cadence model.Cadence, checks []string, today string) int {
	done := map[string]bool{}
	for _, d := range checks {
		done[d] = true
	}
	if cadence == model.CadenceWeekly {
		weeks := map[string]bool{}
		for _, d := range checks {
			weeks[weekStart(d)] = true
		}
		week := weekStart(today)
		if !weeks[week] {
			week = addDays(week, -7)
		}
		n := 0
		for ; weeks[week]; week = addDays(week, -7) {
			n++
		}
		return n
	}
	skip := func(d string) bool {
		if cadence != model.CadenceWeekdays {
			return false
		}
		t, _ := time.Parse(time.DateOnly, d)
		return t.Weekday() == time.Saturday || t.Weekday() == time.Sunday
	}
	day := today
	for skip(day) {
		day = addDays(day, -1)
	}
	if !done[day] {
		day = addDays(day, -1)
		for skip(day) {
			day = addDays(day, -1)
		}
	}
	n := 0
	for done[day] {
		n++
		day = addDays(day, -1)
		for skip(day) {
			day = addDays(day, -1)
		}
	}
	return n
}

// withCheck — отметки после «сделано» (on) или «снять» за день date: по порядку, без повторов,
// не больше MaxHabitChecks последних.
func withCheck(checks []string, date string, on bool) []string {
	out := slices.DeleteFunc(slices.Clone(checks), func(d string) bool { return d == date })
	if on {
		out = append(out, date)
		slices.Sort(out)
	}
	if len(out) > model.MaxHabitChecks {
		out = out[len(out)-model.MaxHabitChecks:]
	}
	if out == nil {
		out = []string{}
	}
	return out
}

// stampDone — у патча, который закрывает или открывает задачу, ставит или снимает DoneAt.
func stampDone(before model.Task, patch *model.TaskPatch, now time.Time) {
	if patch.Done == nil || *patch.Done == before.Done {
		return
	}
	at := time.Time{}
	if *patch.Done {
		at = now
	}
	patch.DoneAt = &at
}
