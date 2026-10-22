package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// testSuggestions — предложения ассистента: ключ не повторяется, ответ один раз, чужие не видны.
func testSuggestions(t *testing.T, s Store) {
	t.Helper()
	ctx := userCtx(t, s)
	bob, err := s.CreateUser(context.Background(), "bob2", "Bob", "hash")
	if err != nil {
		t.Fatal(err)
	}
	bctx := WithUser(context.Background(), bob)
	now := time.Now().Truncate(time.Second)
	sg := model.Suggestion{Kind: model.SuggestLunch, Key: "lunch:2026-10-20", Title: "Обед", Body: "Окно 13:00",
		Action:    model.SuggestionAction{Type: model.ActionEvent, Title: "Обед", Date: "2026-10-20", Start: 780, End: 840, Badge: model.BadgeFood},
		CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	a, ok, err := s.AddSuggestion(ctx, sg)
	if err != nil || !ok || a.ID == 0 || a.Status != model.SuggestionPending || a.Action.Start != 780 {
		t.Fatalf("добавление: %+v %v %v", a, ok, err)
	}
	if _, ok, err := s.AddSuggestion(ctx, sg); ok || err != nil {
		t.Fatalf("тот же ключ: %v %v", ok, err)
	}
	// У другого пользователя тот же ключ — своё предложение.
	if _, ok, _ := s.AddSuggestion(bctx, sg); !ok {
		t.Fatal("ключ у другого пользователя")
	}
	sg2 := sg
	sg2.Key, sg2.Kind = "date:p1:2026-10-24", model.SuggestDate
	b, _, _ := s.AddSuggestion(ctx, sg2)
	list := s.Suggestions(ctx, now.Add(-time.Minute))
	if len(list) != 2 || list[0].ID != b.ID || list[1].Action.Badge != model.BadgeFood || !list[1].ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("список: %+v", list)
	}
	if len(s.Suggestions(ctx, now.Add(time.Minute))) != 0 {
		t.Fatal("since не учитывается")
	}
	if _, err := s.AnswerSuggestion(bctx, a.ID, model.SuggestionAccepted); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужое: %v", err)
	}
	got, err := s.AnswerSuggestion(ctx, a.ID, model.SuggestionAccepted)
	if err != nil || got.Status != model.SuggestionAccepted {
		t.Fatalf("ответ: %+v %v", got, err)
	}
	if _, err := s.AnswerSuggestion(ctx, a.ID, model.SuggestionDismissed); !errors.Is(err, ErrConflict) {
		t.Fatalf("второй ответ: %v", err)
	}
}

func TestFileSuggestions(t *testing.T) {
	s, _ := Open("")
	testSuggestions(t, s)
}

func TestPostgresSuggestions(t *testing.T) {
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
	testSuggestions(t, s)
	// Задача помнит, когда её завели.
	tctx := userCtx(t, s)
	task, err := s.CreateTask(tctx, model.Task{Title: "x", Kind: model.TaskKindTask})
	if err != nil || task.CreatedAt.IsZero() {
		t.Fatalf("createdAt: %+v %v", task, err)
	}
}
