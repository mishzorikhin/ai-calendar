package store

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

func testAccount(t *testing.T, s Store) {
	t.Helper()
	bg := context.Background()
	u, err := s.CreateUser(bg, "carol", "Carol", "hash1")
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithUser(bg, u)
	dave, _ := s.CreateUser(bg, "dave", "Dave", "hash")
	dctx := WithUser(bg, dave)

	// Сессии: две свои, у Дейва своя; список без хэшей, удаление по id.
	exp := time.Now().Add(time.Hour)
	for _, h := range []string{"aaaaaaaaaaaaaaaa1", "bbbbbbbbbbbbbbbb2"} {
		if err := s.CreateSession(bg, u.ID, h, "Chrome · Mac", exp); err != nil {
			t.Fatal(err)
		}
	}
	_ = s.CreateSession(bg, dave.ID, "cccccccccccccccc3", "", exp)
	list := s.Sessions(ctx)
	if len(list) != 2 || list[0].Label != "Chrome · Mac" || len(list[0].ID) != SessionIDLen || strings.Contains(list[0].ID, "1") {
		t.Fatalf("сессии: %+v", list)
	}
	if err := s.DeleteSessionByID(dctx, "aaaaaaaaaaaa"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужая: %v", err)
	}
	if err := s.DeleteSessionByID(ctx, "aaaaaaaaaaaa"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(bg, "aaaaaaaaaaaaaaaa1"); err == nil {
		t.Fatal("сессия не завершилась")
	}
	_ = s.CreateSession(bg, u.ID, "dddddddddddddddd4", "", exp)
	if err := s.DeleteOtherSessions(ctx, "dddddddddddddddd4"); err != nil {
		t.Fatal(err)
	}
	if list := s.Sessions(ctx); len(list) != 1 || list[0].ID != "dddddddddddd" {
		t.Fatalf("после «остальных»: %+v", list)
	}
	if len(s.Sessions(dctx)) != 1 {
		t.Fatal("задеты сессии другого пользователя")
	}

	if err := s.SetPassword(ctx, "hash2"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.UserByUsername(bg, "carol"); got.PassHash != "hash2" {
		t.Fatalf("пароль: %q", got.PassHash)
	}

	// Удаление: всё своё пропадает, совместная задача Дейва остаётся без Кэрол.
	if _, err := s.CreateEvent(ctx, model.Event{Date: "2030-01-07", Title: "x", Start: 540, End: 600, Badge: model.BadgeWork}); err != nil {
		t.Fatal(err)
	}
	_, _ = s.AddMemory(ctx, model.Memory{Kind: model.MemoryRule, Text: "x", Source: model.SourceUser, Confirmed: true})
	_ = s.SetProfile(ctx, model.Profile{WakeUp: 1, BedTime: 2, WorkStart: 1, WorkEnd: 2, Focus: model.FocusNone, MeetingMinutes: 60, Tone: "brief", Address: "ty"})
	own, _ := s.CreateTask(ctx, model.Task{Title: "моя", Kind: model.TaskKindTask})
	if _, err := s.AddTaskMember(ctx, own.ID, dave.ID); err != nil {
		t.Fatal(err)
	}
	shared, _ := s.CreateTask(dctx, model.Task{Title: "Дейва", Kind: model.TaskKindTask})
	if _, err := s.AddTaskMember(dctx, shared.ID, u.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUser(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserByUsername(bg, "carol"); err == nil {
		t.Fatal("пользователь остался")
	}
	tasks := s.Tasks(dctx)
	if len(tasks) != 1 || tasks[0].ID != shared.ID || len(tasks[0].Members) != 0 {
		t.Fatalf("задачи Дейва: %+v", tasks)
	}
	again, err := s.CreateUser(bg, "carol", "Carol 2", "h")
	if err != nil {
		t.Fatalf("логин не освободился: %v", err)
	}
	actx := WithUser(bg, again)
	if len(s.EventsBetween(actx, "2030-01-01", "2030-12-31")) != 0 || len(s.Memories(actx)) != 0 || len(s.Sessions(actx)) != 0 {
		t.Fatal("данные достались новому пользователю")
	}
	if p, _ := s.Profile(actx); p.WakeUp != model.DefaultProfile().WakeUp {
		t.Fatalf("профиль достался новому: %+v", p)
	}
}

func TestFileAccount(t *testing.T) {
	s, _ := Open("")
	testAccount(t, s)
}

func TestPostgresAccount(t *testing.T) {
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
	testAccount(t, s)
}
