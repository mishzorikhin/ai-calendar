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

// testPlanningFields — оценка задачи и связь события с задачей сохраняются; приглашённый связи не видит.
func testPlanningFields(t *testing.T, s Store) {
	t.Helper()
	ctx := userCtx(t, s)
	task, err := s.CreateTask(ctx, model.Task{Title: "Отчёт", Kind: model.TaskKindTask, Estimate: 90})
	if err != nil || task.Estimate != 90 || task.CreatedAt.IsZero() {
		t.Fatalf("задача: %+v %v", task, err)
	}
	est := 120
	if task, err = s.UpdateTask(ctx, task.ID, model.TaskPatch{Estimate: &est}); err != nil || task.Estimate != 120 {
		t.Fatalf("правка оценки: %+v %v", task, err)
	}
	// Привычка: частота, отметки, время закрытия.
	habit, err := s.CreateTask(ctx, model.Task{Title: "Зарядка", Kind: model.TaskKindHabit, Cadence: model.CadenceWeekdays})
	if err != nil || habit.Cadence != model.CadenceWeekdays || habit.Checks != nil {
		t.Fatalf("привычка: %+v %v", habit, err)
	}
	checks := []string{"2030-01-07", "2030-01-08"}
	doneAt := time.Date(2030, 1, 8, 9, 0, 0, 0, time.UTC)
	if habit, err = s.UpdateTask(ctx, habit.ID, model.TaskPatch{Checks: &checks, DoneAt: &doneAt}); err != nil ||
		len(habit.Checks) != 2 || habit.Checks[1] != "2030-01-08" || !habit.DoneAt.Equal(doneAt) {
		t.Fatalf("отметки: %+v %v", habit, err)
	}
	zero := time.Time{}
	if habit, _ = s.UpdateTask(ctx, habit.ID, model.TaskPatch{DoneAt: &zero}); !habit.DoneAt.IsZero() {
		t.Fatalf("doneAt не снят: %+v", habit)
	}
	ev, err := s.CreateEvent(ctx, model.Event{Date: "2030-01-07", Title: "Отчёт", Start: 540, End: 660, Badge: model.BadgeWork, TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	title := "Отчёт, часть 1"
	if got, err := s.UpdateEvent(ctx, ev.ID, model.EventPatch{Title: &title}); err != nil || got.TaskID != task.ID {
		t.Fatalf("после правки события: %+v %v", got, err)
	}
	guest, err := s.CreateUser(context.Background(), "guest3", "Гость", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetAttendees(ctx, ev.ID, []model.User{guest}); err != nil {
		t.Fatal(err)
	}
	inv := s.InvitedEvents(WithUser(context.Background(), guest), "2030-01-01", "2030-02-01")
	if len(inv) != 1 || inv[0].TaskID != "" {
		t.Fatalf("приглашённый видит задачу: %+v", inv)
	}
}

func TestFileSuggestions(t *testing.T) {
	s, _ := Open("")
	testSuggestions(t, s)
	testPlanningFields(t, s)
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
	testPlanningFields(t, s)
}
