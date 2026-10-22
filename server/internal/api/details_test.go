package api

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func TestEventDetailsValidation(t *testing.T) {
	h, tok := newAuthedServer(t)
	ok := doAs(t, h, tok, "POST", "/api/events",
		`{"date":"2026-10-21","title":"Созвон","start":600,"end":660,"notes":" Повестка ","url":"https://meet.google.com/abc","travel":30}`)
	ev := decode[model.Event](t, ok)
	if ok.Code != 201 || ev.Notes != "Повестка" || ev.URL != "https://meet.google.com/abc" || ev.Travel != 30 {
		t.Fatalf("создание: %d %+v", ok.Code, ev)
	}
	for _, bad := range []string{
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"url":"javascript:alert(1)"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"url":"ftp://x"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"travel":300}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"notes":"` + strings.Repeat("я", 2001) + `"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"endDate":"2026-10-21"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"endDate":"2026-10-20"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"endDate":"2027-01-21"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":660,"endDate":"2026-10-22","repeat":"weekly"}`,
		`{"date":"2026-10-21","title":"x","start":600,"end":0,"endDate":"2026-10-22"}`,
	} {
		if rec := doAs(t, h, tok, "POST", "/api/events", bad); rec.Code != 400 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	// Правка: убрать ссылку, повтор у многодневного нельзя.
	upd := decode[model.Event](t, doAs(t, h, tok, "PATCH", "/api/events/"+ev.ID, `{"url":"","endDate":"2026-10-23","end":720}`))
	if upd.URL != "" || upd.EndDate != "2026-10-23" {
		t.Fatalf("правка: %+v", upd)
	}
	if rec := doAs(t, h, tok, "PATCH", "/api/events/"+ev.ID, `{"repeat":"daily"}`); rec.Code != 400 {
		t.Fatalf("повтор у многодневного: %d", rec.Code)
	}
}

func TestMultiDayExpansion(t *testing.T) {
	h, tok := newAuthedServer(t)
	conf := decode[model.Event](t, doAs(t, h, tok, "POST", "/api/events",
		`{"date":"2026-10-21","title":"Конференция","start":600,"end":1080,"endDate":"2026-10-23"}`))
	trip := decode[model.Event](t, doAs(t, h, tok, "POST", "/api/events",
		`{"date":"2026-10-30","title":"Отпуск","allDay":true,"endDate":"2026-11-02"}`))
	day := func(d string) []model.Event {
		return decode[[]model.Event](t, doAs(t, h, tok, "GET", "/api/events?date="+d, ""))
	}
	cases := []struct {
		date             string
		start, end       int
		allDay, hasEvent bool
	}{
		{"2026-10-20", 0, 0, false, false},
		{"2026-10-21", 600, 1440, false, true},
		{"2026-10-22", 0, 1440, true, true},
		{"2026-10-23", 0, 1080, false, true},
		{"2026-10-24", 0, 0, false, false},
	}
	for _, c := range cases {
		list := day(c.date)
		if !c.hasEvent {
			if len(list) != 0 {
				t.Errorf("%s: лишнее %+v", c.date, list)
			}
			continue
		}
		if len(list) != 1 || list[0].ID != conf.ID || list[0].Start != c.start || list[0].End != c.end || list[0].AllDay != c.allDay {
			t.Errorf("%s: %+v", c.date, list)
			continue
		}
		if sp := list[0].Span; sp == nil || sp.Date != "2026-10-21" || sp.Start != 600 || sp.End != 1080 {
			t.Errorf("%s: span %+v", c.date, sp)
		}
	}
	// Отпуск на весь день — через границу месяца, в обоих месяцах есть значки.
	if l := day("2026-11-01"); len(l) != 1 || l[0].ID != trip.ID || !l[0].AllDay {
		t.Fatalf("отпуск: %+v", l)
	}
	nov := decode[map[string][]model.Badge](t, doAs(t, h, tok, "GET", "/api/month?year=2026&month=11", ""))
	if len(nov["1"]) != 1 || len(nov["2"]) != 1 || len(nov["3"]) != 0 {
		t.Fatalf("значки ноября: %v", nov)
	}
}

func TestTravelAndMultiDayReminders(t *testing.T) {
	loc := time.UTC
	events := []model.Event{
		{ID: "e1", Date: "2026-10-21", Title: "Встреча", Subtitle: "Кафе", Start: 600, End: 660, Travel: 30, Reminders: []int{}},
		// Второй день многодневного: о нём не напоминаем (его «начало» в полночь не настоящее).
		{ID: "e2", Date: "2026-10-22", Title: "Конференция", Start: 0, End: 600, Span: &model.EventSpan{Date: "2026-10-21", Start: 900, End: 600}},
	}
	ns := model.DefaultNotifySettings
	from := time.Date(2026, 10, 21, 9, 25, 0, 0, loc)
	got := planReminders(loc, ns, events, nil, from, from.Add(10*time.Minute))
	if len(got) != 1 || got[0].msg.Title != "Пора выезжать: Встреча" || !strings.Contains(got[0].msg.Body, "Дорога 30 минут, начало в 10:00 · Кафе") {
		t.Fatalf("выезд: %+v", got)
	}
	night := time.Date(2026, 10, 21, 23, 55, 0, 0, loc)
	if got := planReminders(loc, ns, events, nil, night, night.Add(10*time.Minute)); len(got) != 0 {
		t.Fatalf("второй день многодневного не напоминает: %+v", got)
	}
}

func TestFeedMultiDayOneEvent(t *testing.T) {
	st, _ := store.Open("")
	s := newServer(Options{Store: st})
	u, _ := st.CreateUser(context.Background(), "alice", "Alice", "h")
	ctx := store.WithUser(context.Background(), u)
	now := s.cal.now()
	day := now.AddDate(0, 0, 2).Format(time.DateOnly)
	last := now.AddDate(0, 0, 4).Format(time.DateOnly)
	_, _ = st.CreateEvent(ctx, model.Event{Date: day, EndDate: last, Title: "Поездка", Start: 600, End: 720, Badge: model.BadgeRoutine, Notes: "Билеты в почте", URL: "https://example.com/t"})
	_ = st.SetFeedToken(ctx, "secret-token-123456")
	rec := do(t, s.handler(Options{}), "GET", "/api/feed/secret-token-123456.ics", "")
	body := rec.Body.String()
	if strings.Count(body, "BEGIN:VEVENT") != 1 || !strings.Contains(body, "DESCRIPTION:Билеты в почте") || !strings.Contains(body, "URL:https://example.com/t") {
		t.Fatalf("лента: %s", body)
	}
}

func TestChatMultiDayTool(t *testing.T) {
	st, _ := store.Open("")
	llmc, _ := fakeChatLLMBodies(t, [][]string{
		{toolCall("create_event", `{"date":"2026-11-10","end_date":"2026-11-12","title":"Конференция","start":"10:00","end":"18:00","url":"https://conf.example","travel_minutes":40}`)},
		{textFrame("Готово.")},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"конференция 10–12 ноября"}`)
	list := decode[[]model.Event](t, doAs(t, h, tok, "GET", "/api/events?date=2026-11-11", ""))
	if len(list) != 1 || !list[0].AllDay || list[0].URL != "https://conf.example" || list[0].Travel != 40 {
		t.Fatalf("многодневное от ассистента: %+v", list)
	}
}
