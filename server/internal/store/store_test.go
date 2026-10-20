package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// userCtx создаёт пользователя (или берёт существующего) и возвращает
// контекст с ним — как после auth-middleware.
func userCtx(t *testing.T, s Store) context.Context {
	t.Helper()
	u, err := s.CreateUser(context.Background(), "alice", "Alice", "hash")
	if errors.Is(err, ErrConflict) {
		u, err = s.UserByUsername(context.Background(), "alice")
	}
	if err != nil {
		t.Fatal(err)
	}
	return WithUser(context.Background(), u)
}

func TestPersistence(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userCtx(t, s)
	ev, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660, Badge: model.BadgeRoutine})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddMessage(ctx, model.RoleUser, "Привет"); err != nil {
		t.Fatal(err)
	}

	// Новое открытие читает то же самое с диска.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Другой пользователь не видит данные alice; сама alice — видит.
	bob, _ := s2.CreateUser(context.Background(), "bob", "Bob", "hash")
	if got := s2.EventsOn(WithUser(context.Background(), bob), "2026-10-20"); len(got) != 0 {
		t.Fatalf("bob увидел чужое: %+v", got)
	}
	u, _ := s2.UserByUsername(context.Background(), "alice")
	ctx2 := WithUser(context.Background(), u)
	if got := s2.EventsOn(ctx2, "2026-10-20"); len(got) != 1 || got[0].ID != ev.ID {
		t.Fatalf("события после перезапуска: %+v", got)
	}
	if got := s2.Messages(ctx2); len(got) != 2 || got[1].ID != 1 {
		t.Fatalf("сообщения после перезапуска: %+v", got)
	}
}

func TestTasks(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	ctx := userCtx(t, s)

	task, err := s.CreateTask(ctx, model.Task{Title: "Подготовка", Kind: model.TaskKindTask, Category: model.CategoryWork})
	if err != nil {
		t.Fatal(err)
	}
	done := true
	task, err = s.UpdateTask(ctx, task.ID, model.TaskPatch{Done: &done, Category: ptr(model.CategorySport)})
	if err != nil {
		t.Fatal(err)
	}
	if !task.Done || task.Category != model.CategorySport {
		t.Fatalf("после патча: %+v", task)
	}

	s2, _ := Open(dir)
	u, _ := s2.UserByUsername(context.Background(), "alice")
	ctx2 := WithUser(context.Background(), u)
	tasks := s2.Tasks(ctx2)
	// 2 сида + созданная; проверяем, что наша сохранилась с патчем.
	var found *model.Task
	for i := range tasks {
		if tasks[i].ID == task.ID {
			found = &tasks[i]
		}
	}
	if found == nil || !found.Done || found.Category != model.CategorySport {
		t.Fatalf("задачи после перезапуска: %+v", tasks)
	}
	if err := s2.DeleteTask(ctx2, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s2.UpdateTask(ctx2, task.ID, model.TaskPatch{Done: &done}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("patch удалённой: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestNotFound(t *testing.T) {
	s, _ := Open("")
	ctx := userCtx(t, s)
	if err := s.DeleteEvent(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидали ErrNotFound, получили %v", err)
	}
	if err := s.DeleteTask(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидали ErrNotFound, получили %v", err)
	}
}

func TestUnauthenticated(t *testing.T) {
	s, _ := Open("")
	ctx := context.Background()
	if _, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-20", Title: "x", Start: 1, End: 2}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("событие без пользователя: %v", err)
	}
	if got := s.EventsOn(ctx, "2026-10-20"); got != nil {
		t.Fatalf("события без пользователя: %+v", got)
	}
	if got := s.Tasks(ctx); got != nil {
		t.Fatalf("задачи без пользователя: %+v", got)
	}
}

func TestTaskMembersStore(t *testing.T) {
	s, _ := Open("")
	alice, _ := s.CreateUser(context.Background(), "alice", "Alice", "h")
	bob, _ := s.CreateUser(context.Background(), "bob", "Bob", "h")
	carol, _ := s.CreateUser(context.Background(), "carol", "Carol", "h")
	actx := WithUser(context.Background(), alice)
	bctx := WithUser(context.Background(), bob)

	task, err := s.CreateTask(actx, model.Task{Title: "Общая", Kind: model.TaskKindTask})
	if err != nil {
		t.Fatal(err)
	}

	// Чужой не может добавить участника к чужой задаче.
	cctx := WithUser(context.Background(), carol)
	if _, err := s.AddTaskMember(cctx, task.ID, carol.ID); !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
		t.Fatalf("чужой добавляет: %v", err)
	}

	// Владелец добавляет — участник видит и правит.
	if _, err := s.AddTaskMember(actx, task.ID, bob.ID); err != nil {
		t.Fatal(err)
	}
	if got := s.Tasks(bctx); len(got) != 1 || got[0].Role != model.TaskRoleMember {
		t.Fatalf("задачи участника: %+v", got)
	}
	done := true
	if _, err := s.UpdateTask(bctx, task.ID, model.TaskPatch{Done: &done}); err != nil {
		t.Fatalf("правка участником: %v", err)
	}

	// Участник не может удалить владельца, но может выйти.
	if _, err := s.RemoveTaskMember(bctx, task.ID, alice.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("участник удалил владельца: %v", err)
	}
	if err := s.DeleteTask(bctx, task.ID); err != nil {
		t.Fatalf("выход участника: %v", err)
	}
	if got := s.Tasks(bctx); len(got) != 0 {
		t.Fatalf("после выхода: %+v", got)
	}
	got := s.Tasks(actx)
	if len(got) != 1 || len(got[0].Members) != 0 {
		t.Fatalf("у владельца после выхода: %+v", got)
	}
}

// Если запись на диск не удалась, изменение не остаётся в памяти.
func TestRollbackOnSaveError(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userCtx(t, s)
	kept, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-20", Title: "Остаётся", Start: 540, End: 600})
	if err != nil {
		t.Fatal(err)
	}

	// Каталог на месте временного файла делает запись невозможной.
	if err := os.Mkdir(filepath.Join(dir, "data.json.tmp"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660}); err == nil {
		t.Fatal("ожидали ошибку записи")
	}
	if _, err := s.AddMessage(ctx, model.RoleUser, "Привет"); err == nil {
		t.Fatal("ожидали ошибку записи")
	}
	if got := s.EventsOn(ctx, "2026-10-20"); len(got) != 1 || got[0].ID != kept.ID {
		t.Fatalf("после неудачной записи в памяти должно остаться только прежнее событие: %+v", got)
	}
	if got := s.Messages(ctx); len(got) != 1 {
		t.Fatalf("сообщение осталось в памяти: %+v", got)
	}

	// Хранилище не сломалось: когда запись снова возможна, всё сохраняется.
	if err := os.Remove(filepath.Join(dir, "data.json.tmp")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateEvent(ctx, model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660}); err != nil {
		t.Fatal(err)
	}
	if got := s.EventsOn(ctx, "2026-10-20"); len(got) != 2 {
		t.Fatalf("события: %+v", got)
	}
}
