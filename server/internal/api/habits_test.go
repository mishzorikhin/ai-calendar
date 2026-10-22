package api

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

func TestHabitStreak(t *testing.T) {
	// 2026-10-22 — четверг.
	cases := []struct {
		name    string
		cadence model.Cadence
		checks  []string
		want    int
	}{
		{"сегодня и два дня до", model.CadenceDaily, []string{"2026-10-20", "2026-10-21", "2026-10-22"}, 3},
		{"сегодня ещё не отмечено", model.CadenceDaily, []string{"2026-10-20", "2026-10-21"}, 2},
		{"пропуск обрывает", model.CadenceDaily, []string{"2026-10-19", "2026-10-21", "2026-10-22"}, 2},
		{"позавчера — уже ноль", model.CadenceDaily, []string{"2026-10-20"}, 0},
		{"будни через выходные", model.CadenceWeekdays, []string{"2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"}, 4},
		{"недели", model.CadenceWeekly, []string{"2026-10-05", "2026-10-15", "2026-10-21"}, 3},
		{"эта неделя ещё не отмечена", model.CadenceWeekly, []string{"2026-10-08", "2026-10-13"}, 2},
		{"пусто", model.CadenceDaily, nil, 0},
	}
	for _, c := range cases {
		if got := habitStreak(c.cadence, c.checks, "2026-10-22"); got != c.want {
			t.Errorf("%s: %d, ждали %d", c.name, got, c.want)
		}
	}
	// В выходной серия по будням считается с пятницы.
	if got := habitStreak(model.CadenceWeekdays, []string{"2026-10-22", "2026-10-23"}, "2026-10-25"); got != 2 {
		t.Errorf("в воскресенье: %d", got)
	}
}

func TestWithCheck(t *testing.T) {
	got := withCheck([]string{"2026-10-20", "2026-10-22"}, "2026-10-21", true)
	if fmt.Sprint(got) != "[2026-10-20 2026-10-21 2026-10-22]" {
		t.Fatalf("отметка: %v", got)
	}
	if got = withCheck(got, "2026-10-21", true); len(got) != 3 {
		t.Fatalf("повтор: %v", got)
	}
	if got = withCheck(got, "2026-10-20", false); fmt.Sprint(got) != "[2026-10-21 2026-10-22]" {
		t.Fatalf("снять: %v", got)
	}
	many := make([]string, model.MaxHabitChecks)
	for i := range many {
		many[i] = addDays("2020-01-01", i)
	}
	if got = withCheck(many, "2030-01-01", true); len(got) != model.MaxHabitChecks || got[0] != "2020-01-02" {
		t.Fatalf("предел: %d %s", len(got), got[0])
	}
}

func TestWeekInsights(t *testing.T) {
	loc := time.FixedZone("MSK", 3*3600)
	p := model.DefaultProfile() // будни 9–18
	events := []model.Event{
		// Эта неделя (с 19 октября): пн — 3 ч встреч, ср — 1 ч, сб — 2 ч (выходной: фокус не считается).
		{Date: "2026-10-19", Start: 600, End: 720, Badge: model.BadgeWork},
		{Date: "2026-10-19", Start: 780, End: 840, Badge: model.BadgeWork},
		{Date: "2026-10-21", Start: 540, End: 600, Badge: model.BadgeSport},
		{Date: "2026-10-24", Start: 600, End: 720, Badge: model.BadgeFood},
		{Date: "2026-10-22", AllDay: true, Start: 0, End: 1440, Badge: model.BadgeRoutine},
		// Прошлые недели: всего 8 ч → в среднем 2 ч.
		{Date: "2026-10-12", Start: 540, End: 780, Badge: model.BadgeWork},
		{Date: "2026-09-21", Start: 540, End: 780, Badge: model.BadgeWork},
		// Раньше окна — не считается.
		{Date: "2026-09-01", Start: 0, End: 600, Badge: model.BadgeWork},
	}
	tasks := []model.Task{
		{ID: "a", Done: true, DoneAt: time.Date(2026, 10, 20, 21, 30, 0, 0, time.UTC)}, // 21 октября по Москве
		{ID: "b", Done: true, DoneAt: time.Date(2026, 10, 18, 22, 0, 0, 0, time.UTC)},  // 19-е по Москве — тоже эта неделя
		{ID: "c", Done: true, DoneAt: time.Date(2026, 10, 18, 20, 0, 0, 0, time.UTC)},  // 18-е — прошлая
		{ID: "d"},
	}
	r := weekInsights("2026-10-19", events, tasks, p, loc)
	if r.Minutes != 360 || r.Average != 120 || r.Done != 2 || r.Busiest != "2026-10-19" {
		t.Fatalf("итоги: %+v", r)
	}
	if r.ByBadge[model.BadgeWork] != 180 || r.ByBadge[model.BadgeFood] != 120 || r.ByBadge[model.BadgeRoutine] != 0 {
		t.Fatalf("по типам: %+v", r.ByBadge)
	}
	if len(r.Days) != 7 || r.Days[0].Minutes != 180 || r.Days[0].Events != 2 || r.Days[3].Events != 0 {
		t.Fatalf("дни: %+v", r.Days)
	}
	// Фокус: пн — 9–10 (60, мало) и 14–18 (240); вт, чт, пт — по 540; ср — 10–18 (480). Итого 2340.
	if r.Focus != 240+540*3+480 {
		t.Fatalf("фокус: %d", r.Focus)
	}
}

func TestHabitAndInsightsAPI(t *testing.T) {
	h, tok := newAuthedServer(t)
	habit := decode[model.Task](t, doAs(t, h, tok, "POST", "/api/tasks", `{"title":"Зарядка","kind":"habit"}`))
	if habit.Cadence != model.CadenceDaily {
		t.Fatalf("частота по умолчанию: %+v", habit)
	}
	if rec := doAs(t, h, tok, "POST", "/api/tasks", `{"title":"x","cadence":"daily"}`); rec.Code != 400 {
		t.Fatalf("частота у задачи: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "POST", "/api/tasks", `{"title":"x","kind":"habit","cadence":"hourly"}`); rec.Code != 400 {
		t.Fatalf("неизвестная частота: %d", rec.Code)
	}
	for _, d := range []string{"2026-10-21", "2026-10-22", "2026-10-21"} {
		habit = decode[model.Task](t, doAs(t, h, tok, "PATCH", "/api/tasks/"+habit.ID, `{"check":"`+d+`"}`))
	}
	if fmt.Sprint(habit.Checks) != "[2026-10-21 2026-10-22]" {
		t.Fatalf("отметки: %v", habit.Checks)
	}
	habit = decode[model.Task](t, doAs(t, h, tok, "PATCH", "/api/tasks/"+habit.ID, `{"uncheck":"2026-10-21"}`))
	if fmt.Sprint(habit.Checks) != "[2026-10-22]" {
		t.Fatalf("снять: %v", habit.Checks)
	}
	if rec := doAs(t, h, tok, "PATCH", "/api/tasks/"+habit.ID, `{"check":"вчера"}`); rec.Code != 400 {
		t.Fatalf("плохая дата: %d", rec.Code)
	}

	// Закрытие задачи ставит doneAt, открытие — снимает.
	task := decode[model.Task](t, doAs(t, h, tok, "POST", "/api/tasks", `{"title":"Отчёт"}`))
	task = decode[model.Task](t, doAs(t, h, tok, "PATCH", "/api/tasks/"+task.ID, `{"done":true}`))
	if task.DoneAt.IsZero() || time.Since(task.DoneAt) > time.Minute {
		t.Fatalf("doneAt: %+v", task)
	}
	task = decode[model.Task](t, doAs(t, h, tok, "PATCH", "/api/tasks/"+task.ID, `{"done":false}`))
	if !task.DoneAt.IsZero() {
		t.Fatalf("doneAt после открытия: %+v", task)
	}

	doAs(t, h, tok, "POST", "/api/events", `{"date":"2030-01-08","title":"Созвон","start":600,"end":690,"badge":"work"}`)
	rec := doAs(t, h, tok, "GET", "/api/insights/week?start=2030-01-09", "")
	r := decode[weekReport](t, rec)
	if rec.Code != 200 || r.Start != "2030-01-07" || r.Minutes != 90 || r.ByBadge[model.BadgeWork] != 90 || len(r.Days) != 7 {
		t.Fatalf("обзор: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, tok, "GET", "/api/insights/week?start=завтра", ""); rec.Code != 400 || !strings.Contains(rec.Body.String(), "start") {
		t.Fatalf("плохая дата: %d", rec.Code)
	}
}
