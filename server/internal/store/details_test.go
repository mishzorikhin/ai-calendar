package store

import (
	"context"
	"os"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// testEventDetails — заметки, ссылка, дорога и многодневные события в обоих хранилищах.
func testEventDetails(t *testing.T, s Store) {
	t.Helper()
	ctx := userCtx(t, s)
	e, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-21", EndDate: "2026-10-23", Title: "Конференция", Start: 600, End: 1080,
		Badge: model.BadgeWork, Notes: "Бейдж на входе", URL: "https://conf.example", Travel: 40})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Event(ctx, e.ID)
	if err != nil || got.Notes != "Бейдж на входе" || got.URL != "https://conf.example" || got.Travel != 40 || got.EndDate != "2026-10-23" {
		t.Fatalf("чтение: %+v %v", got, err)
	}
	// Многодневное пересекает окна, в которых его первого дня нет.
	if l := s.MultiDayEvents(ctx, "2026-10-22", "2026-10-22"); len(l) != 1 {
		t.Fatalf("середина: %+v", l)
	}
	if l := s.MultiDayEvents(ctx, "2026-10-24", "2026-10-30"); len(l) != 0 {
		t.Fatalf("после конца: %+v", l)
	}
	if l := s.MultiDayEvents(ctx, "2026-10-01", "2026-10-20"); len(l) != 0 {
		t.Fatalf("до начала: %+v", l)
	}
	// Поиск: по заметкам, без учёта регистра и «ё», спецсимволы LIKE — как текст.
	if got := s.SearchEvents(ctx, "БЕЙДЖ", 10); len(got) != 1 || got[0].ID != e.ID {
		t.Fatalf("поиск по заметкам: %+v", got)
	}
	if got := s.SearchEvents(ctx, "%", 10); len(got) != 0 {
		t.Fatalf("%% — не шаблон: %+v", got)
	}
	if _, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-01", Title: "Ёлка", Start: 600, End: 660, Badge: model.BadgeRoutine}); err != nil {
		t.Fatal(err)
	}
	if got := s.SearchEvents(ctx, "елк", 10); len(got) != 1 {
		t.Fatalf("ё = е: %+v", got)
	}
	if got := s.SearchEvents(WithUser(context.Background(), model.User{ID: 999}), "Ёлка", 10); len(got) != 0 {
		t.Fatalf("чужой поиск: %+v", got)
	}
	empty, travel := "", 0
	upd, err := s.UpdateEvent(ctx, e.ID, model.EventPatch{EndDate: &empty, URL: &empty, Travel: &travel})
	if err != nil || upd.EndDate != "" || upd.URL != "" || upd.Travel != 0 || upd.Notes != "Бейдж на входе" {
		t.Fatalf("правка: %+v %v", upd, err)
	}
	if l := s.MultiDayEvents(ctx, "2026-10-01", "2026-10-30"); len(l) != 0 {
		t.Fatalf("стало однодневным: %+v", l)
	}
	// Синхронизация переносит заметки и ссылку внешнего события.
	if _, err := s.SyncEvents(ctx, "cal-1", []model.Event{{ExternalID: "x", Date: "2026-10-21", Title: "Созвон", Start: 600, End: 660,
		Badge: model.BadgeRoutine, Notes: "Повестка", URL: "https://meet.google.com/a"}}); err != nil {
		t.Fatal(err)
	}
	for _, ev := range s.EventsOn(ctx, "2026-10-21") {
		if ev.Source == "cal-1" && (ev.Notes != "Повестка" || ev.URL != "https://meet.google.com/a") {
			t.Fatalf("синхронизация: %+v", ev)
		}
	}
}

func TestFileEventDetails(t *testing.T) {
	s, _ := Open("")
	testEventDetails(t, s)
}

func TestPostgresEventDetails(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL не задан")
	}
	ctx := context.Background()
	s, err := OpenPostgres(ctx, dsn, "")
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	defer s.(*pgStore).pool.Close()
	mustWipe(ctx, t, s)
	testEventDetails(t, s)
}
