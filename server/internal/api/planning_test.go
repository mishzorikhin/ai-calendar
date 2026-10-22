package api

import (
	"fmt"
	"strings"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func placedStr(list []placed) string {
	var out []string
	for _, p := range list {
		s := fmt.Sprintf("%s %s %s–%s", p.ID, p.Date[5:], hm(p.Start), hm(p.End))
		if p.Late {
			s += " поздно"
		}
		out = append(out, s)
	}
	return strings.Join(out, "; ")
}

func TestPlanTasks(t *testing.T) {
	days := []planDay{
		// Понедельник: окна 9–11 и 14–18, фокус — утро до 12.
		{Date: "2030-01-07", Free: []span{{540, 660}, {840, 1080}}, Focus: span{420, 720}},
		{Date: "2030-01-08", Free: []span{{540, 1080}}, Focus: span{420, 720}},
	}
	tasks := []model.Task{
		{ID: "long", Title: "Отчёт", Kind: model.TaskKindTask, Estimate: 180},
		{ID: "due", Title: "Налоги", Kind: model.TaskKindTask, Due: "2030-01-07", Estimate: 90},
		{ID: "goal", Title: "Цель", Kind: model.TaskKindGoal},
		{ID: "done", Title: "Готово", Kind: model.TaskKindTask, Done: true},
		{ID: "plain", Title: "Звонок", Kind: model.TaskKindTask},
	}
	got, left := planTasks(tasks, days, 10)
	// Со сроком — первой и в фокус-время; три часа утром не помещаются — после обеда;
	// час без оценки — в остаток утра после перерыва.
	want := "due 01-07 09:00–10:30; long 01-07 14:00–17:00; plain 01-08 09:00–10:00"
	if placedStr(got) != want || len(left) != 0 {
		t.Fatalf("план:\n%s\nждали:\n%s\nне вошло: %+v", placedStr(got), want, left)
	}
	// До срока места нет — ставим позже с пометкой; совсем некуда — в «не вошло».
	tight := []planDay{{Date: "2030-01-07", Free: []span{{540, 570}}}, {Date: "2030-01-08", Free: []span{{540, 660}}}}
	got, left = planTasks([]model.Task{
		{ID: "a", Kind: model.TaskKindTask, Due: "2030-01-07"},
		{ID: "b", Kind: model.TaskKindTask, Estimate: 480},
	}, tight, 0)
	if placedStr(got) != "a 01-08 09:00–10:00 поздно" || len(left) != 1 || left[0].ID != "b" {
		t.Fatalf("тесно: %s / %+v", placedStr(got), left)
	}
}

func TestShiftPlan(t *testing.T) {
	events := []model.Event{{ID: "a", Title: "А", Date: "2030-01-07", Start: 600, End: 660}, {ID: "b", Title: "Б", Date: "2030-01-07", Start: 1320, End: 1380}}
	got, err := shiftPlan(events, 30)
	if err != nil || placedStr(got) != "a 01-07 10:30–11:30; b 01-07 22:30–23:30" {
		t.Fatalf("сдвиг: %s %v", placedStr(got), err)
	}
	if _, err := shiftPlan(events, 90); err == nil || !strings.Contains(err.Error(), "«Б»") {
		t.Fatalf("за полночь: %v", err)
	}
	if _, err := shiftPlan(events, -660); err == nil {
		t.Fatal("раньше полуночи")
	}
}

func TestChatPlanAndBatchTools(t *testing.T) {
	st, _ := store.Open("")
	// Понедельник далеко в будущем: прошедшее время не мешает.
	const day, next = "2030-01-07", "2030-01-08"
	rounds := [][]string{
		{toolCall("plan_tasks", `{"from":"`+day+`"}`)},
		{textFrame("Предлагаю план.")},
		{""}, // create_event с task_id — id задачи известен после её создания
		{textFrame("Поставил.")},
		{toolCall("shift_events", `{"date":"`+day+`","minutes":60}`)},
		{textFrame("Сдвинуть пять событий?")},
		{toolCall("shift_events", `{"date":"`+day+`","minutes":60}`)},
		{textFrame("Сдвинул.")},
		{toolCall("clear_day", `{"date":"`+day+`"}`)},
		{textFrame("Перенести?")},
		{toolCall("clear_day", `{"date":"`+day+`"}`)},
		{textFrame("Готово.")},
	}
	llmc, bodies := fakeChatLLMBodies(t, rounds)
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	task := decode[model.Task](t, doAs(t, h, tok, "POST", "/api/tasks", `{"title":"Отчёт","estimate":90}`))
	if task.Estimate != 90 {
		t.Fatalf("оценка: %+v", task)
	}
	if rec := doAs(t, h, tok, "POST", "/api/tasks", `{"title":"x","estimate":5}`); rec.Code != 400 {
		t.Fatalf("оценка 5 минут: %d", rec.Code)
	}
	rounds[2][0] = toolCall("create_event", `{"date":"`+day+`","title":"Отчёт","start":"09:00","end":"10:30","badge":"work","task_id":"`+task.ID+`"}`)
	events := func(date string) []model.Event {
		return decode[[]model.Event](t, doAs(t, h, tok, "GET", "/api/events?date="+date, ""))
	}

	// plan_tasks только предлагает: событий нет, модель получила план с task_id.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"разложи задачи на понедельник"}`)
	if !strings.Contains((*bodies)[1], task.ID) || !strings.Contains((*bodies)[1], "09:00") {
		t.Fatalf("план не дошёл до модели: %s", (*bodies)[1])
	}
	if n := len(events(day)); n != 0 {
		t.Fatalf("план что-то создал: %d", n)
	}
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"да, ставь"}`)
	if evs := events(day); len(evs) != 1 || evs[0].TaskID != task.ID {
		t.Fatalf("событие под задачу: %+v", evs)
	}

	// Событие следующего дня сдвиг и освобождение этого дня не трогают.
	doAs(t, h, tok, "POST", "/api/events", fmt.Sprintf(`{"date":%q,"title":"Ужин","start":1200,"end":1260}`, next))
	// Ещё четыре события — сдвиг пяти требует согласия.
	for i := range 4 {
		doAs(t, h, tok, "POST", "/api/events", fmt.Sprintf(`{"date":%q,"title":"Встреча %d","start":%d,"end":%d}`, day, i, 660+i*60, 720+i*60))
	}
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"сдвинь всё на час"}`)
	if !strings.Contains((*bodies)[5], "needs_confirmation") || events(day)[0].Start != 540 {
		t.Fatal("сдвиг без подтверждения")
	}
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"да, сдвигай"}`)
	if evs := events(day); evs[0].Start != 600 || evs[4].Start != 900 {
		t.Fatalf("после согласия: %+v", evs)
	}
	if evs := events(next); len(evs) != 1 || evs[0].Start != 1200 {
		t.Fatalf("сдвиг задел следующий день: %+v", evs)
	}

	// Освободить день — всегда через согласие; события уезжают на вторник.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"освободи понедельник"}`)
	if !strings.Contains((*bodies)[9], "needs_confirmation") || len(events(day)) != 5 {
		t.Fatal("освобождение без подтверждения")
	}
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"да"}`)
	if n := len(events(day)); n != 0 {
		t.Fatalf("день не освобождён: %d", n)
	}
	moved := events(next)
	if len(moved) != 6 || moved[0].Start != 540 || moved[0].Title != "Отчёт" || moved[0].TaskID != task.ID || moved[5].Title != "Ужин" || moved[5].Start != 1200 {
		t.Fatalf("на вторнике: %+v", moved)
	}
}
