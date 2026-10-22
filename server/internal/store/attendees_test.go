package store

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// testAttendees — приглашения на встречи в обоих хранилищах: права, ответы, повторы, удаление.
func testAttendees(t *testing.T, s Store) {
	t.Helper()
	actx := userCtx(t, s)
	mk := func(name string) (model.User, context.Context) {
		u, err := s.CreateUser(context.Background(), name, name, "hash")
		if err != nil {
			t.Fatal(err)
		}
		return u, WithUser(context.Background(), u)
	}
	bob, bctx := mk("bob")
	carl, cctx := mk("carl")

	ev, err := s.CreateEvent(actx, model.Event{Date: "2026-10-21", Title: "Созвон", Start: 600, End: 660, Badge: model.BadgeWork})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetAttendees(bctx, ev.ID, []model.User{carl}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужой не приглашает: %v", err)
	}
	list, err := s.SetAttendees(actx, ev.ID, []model.User{bob, carl})
	if err != nil || len(list) != 2 || list[0].Username != "bob" || list[0].Status != model.RSVPPending {
		t.Fatalf("приглашение: %+v %v", list, err)
	}
	// Приглашённый видит событие с приглашением, но не может его прочитать как своё.
	inv := s.InvitedEvents(bctx, "2026-10-21", "2026-10-21")
	if len(inv) != 1 || inv[0].Invite == nil || inv[0].Invite.From.Username != "alice" || inv[0].Invite.Status != model.RSVPPending {
		t.Fatalf("приглашения: %+v", inv)
	}
	if _, err := s.Event(bctx, ev.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("приглашённый не владеет событием")
	}
	if len(s.InvitedEvents(bctx, "2026-10-22", "2026-10-30")) != 0 {
		t.Fatal("вне окна приглашений нет")
	}
	if err := s.SetRSVP(bctx, ev.ID, model.RSVPAccepted); err != nil {
		t.Fatal(err)
	}
	if err := s.SetRSVP(actx, ev.ID, model.RSVPAccepted); !errors.Is(err, ErrNotFound) {
		t.Fatalf("владелец не отвечает сам себе: %v", err)
	}
	if got, err := s.InvitedEvent(bctx, ev.ID); err != nil || got.Invite.Status != model.RSVPAccepted {
		t.Fatalf("ответ: %+v %v", got, err)
	}
	// Замена списка сохраняет ответ оставшихся, убранный теряет приглашение.
	list, _ = s.SetAttendees(actx, ev.ID, []model.User{bob})
	if len(list) != 1 || list[0].Status != model.RSVPAccepted {
		t.Fatalf("после замены: %+v", list)
	}
	if _, err := s.InvitedEvent(cctx, ev.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("убранный больше не приглашён")
	}
	if m := s.Attendees(cctx, []string{ev.ID}); len(m) != 0 {
		t.Fatalf("посторонний не видит участников: %+v", m)
	}
	if m := s.Attendees(bctx, []string{ev.ID}); len(m[ev.ID]) != 1 {
		t.Fatalf("участник видит список: %+v", m)
	}
	// Серия: приглашение видно в окне, где серия идёт.
	series, _ := s.CreateEvent(actx, model.Event{Date: "2026-10-01", Title: "Планёрка", Start: 540, End: 570, Badge: model.BadgeWork, Repeat: model.RepeatWeekly})
	_, _ = s.SetAttendees(actx, series.ID, []model.User{bob})
	if inv := s.InvitedEvents(bctx, "2026-11-10", "2026-11-12"); len(inv) != 1 || inv[0].ID != series.ID {
		t.Fatalf("серия: %+v", inv)
	}
	// Удаление события убирает приглашения.
	if err := s.DeleteEvent(actx, ev.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InvitedEvent(bctx, ev.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("после удаления приглашения нет")
	}
}

func TestFileAttendees(t *testing.T) {
	s, _ := Open(t.TempDir())
	testAttendees(t, s)
}

func TestPostgresAttendees(t *testing.T) {
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
	testAttendees(t, s)
}
