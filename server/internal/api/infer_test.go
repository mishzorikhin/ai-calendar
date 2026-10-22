package api

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// sportWeeks — спорт по вторникам и четвергам вечером по 90 минут, n недель до 2026-10-22.
func sportWeeks(n int) []model.Event {
	var out []model.Event
	for w := 1; w <= n; w++ {
		for _, d := range []string{"2026-10-20", "2026-10-22"} {
			out = append(out, model.Event{ID: fmt.Sprint(w, d), Date: addDays(d, -7*w), Start: 19 * 60, End: 19*60 + 90, Badge: model.BadgeSport})
		}
	}
	return out
}

func keys(list []model.Memory) string {
	var out []string
	for _, m := range list {
		out = append(out, m.Key)
	}
	return strings.Join(out, " ")
}

func TestInferHabits(t *testing.T) {
	events := sportWeeks(3)
	// Работа — пять раз по часу: длительность не интересна, а дни разные — привычного времени нет.
	for i := range 5 {
		events = append(events, model.Event{Date: addDays("2026-10-19", -i*3), Start: 600, End: 660, Badge: model.BadgeWork})
	}
	// Не считаются: из чужого календаря, на весь день, раньше окна, сегодня.
	events = append(events,
		model.Event{Date: "2026-10-01", Start: 600, End: 900, Badge: model.BadgeRead, Source: "int-1"},
		model.Event{Date: "2026-10-02", AllDay: true, Start: 0, End: 1440, Badge: model.BadgeRead},
		model.Event{Date: "2026-01-01", Start: 600, End: 900, Badge: model.BadgeSport},
		model.Event{Date: "2026-10-22", Start: 600, End: 610, Badge: model.BadgeSport},
	)
	tasks := []model.Task{
		{ID: "t1", Title: "Налоги", Postponed: 3},
		{ID: "t2", Title: "Готово", Postponed: 5, Done: true},
		{ID: "t3", Title: "Чужая", Postponed: 4, Role: model.TaskRoleMember},
		{ID: "t4", Title: "Пока ок", Postponed: 2},
	}
	got := inferHabits(events, tasks, "2026-10-22")
	if keys(got) != "duration:sport:90 time:sport:2,4:night postponed:t1" {
		t.Fatalf("догадки: %q", keys(got))
	}
	if got[0].Text != "Обычно спорт длится 1,5 ч" || got[1].Text != "Спорт — обычно вт, чт вечером" || !strings.Contains(got[2].Text, "3 раза") {
		t.Fatalf("тексты: %q / %q / %q", got[0].Text, got[1].Text, got[2].Text)
	}
	for _, m := range got {
		if m.Source != model.SourceInferred || m.Confirmed {
			t.Fatalf("догадка подтверждена сама: %+v", m)
		}
	}
	// Меньше пяти событий — выводов нет; медиана считается по середине.
	if got := inferHabits(sportWeeks(2), nil, "2026-10-22"); len(got) != 0 {
		t.Fatalf("мало событий: %q", keys(got))
	}
	if median([]int{30, 90, 45, 120}) != 67 || median([]int{5, 1, 3}) != 3 {
		t.Fatal("медиана")
	}
}

func TestInferForAndPostponed(t *testing.T) {
	s, h, st := newPushServer(t)
	tok := register(t, h, "alice")
	now := time.Date(2026, 10, 22, 4, 0, 0, 0, time.UTC)
	ctx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	for _, e := range sportWeeks(3) {
		if _, err := st.CreateEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	// Срок переносят трижды на более поздний — растёт счётчик; на более ранний — нет.
	task := decode[model.Task](t, doAs(t, h, tok, "POST", "/api/tasks", `{"title":"Налоги","kind":"goal","due":"2026-10-01"}`))
	for _, due := range []string{"2026-10-05", "2026-10-03", "2026-10-10", "2026-10-20"} {
		task = decode[model.Task](t, doAs(t, h, tok, "PATCH", "/api/tasks/"+task.ID, `{"due":"`+due+`"}`))
	}
	if task.Postponed != 3 {
		t.Fatalf("переносов: %d", task.Postponed)
	}

	s.inferAll(context.Background(), now)
	mem := decode[[]model.Memory](t, doAs(t, h, tok, "GET", "/api/memories", ""))
	if keys(mem) != "postponed:"+task.ID+" time:sport:2,4:night duration:sport:90" {
		t.Fatalf("память: %q", keys(mem))
	}
	// Догадку о длительности отклонили — она остаётся отклонённой и не появляется снова,
	// даже когда пора пересчитывать.
	var dur model.Memory
	for _, m := range mem {
		if strings.HasPrefix(m.Key, "duration:") {
			dur = m
		}
	}
	doAs(t, h, tok, "PATCH", fmt.Sprintf("/api/memories/%d", dur.ID), `{"rejected":true}`)
	s.inferAll(context.Background(), now.Add(time.Hour)) // рано — пропуск
	s.inferAll(context.Background(), now.Add(25*time.Hour))
	if got := keys(st.Memories(ctx)); strings.Count(got, "duration:sport:90") != 1 || strings.Count(got, "time:sport") != 1 {
		t.Fatalf("повторные догадки: %q", got)
	}
	// Память выключена — догадок нет.
	bob := register(t, h, "bob")
	doAs(t, h, bob, "PATCH", "/api/profile", `{"memory":false}`)
	bctx := store.WithUser(context.Background(), mustUser(t, st, "bob"))
	for _, e := range sportWeeks(3) {
		_, _ = st.CreateEvent(bctx, e)
	}
	if n := s.inferFor(bctx, mustUser(t, st, "bob"), now); n != 0 {
		t.Fatalf("при выключенной памяти: %d", n)
	}
}
