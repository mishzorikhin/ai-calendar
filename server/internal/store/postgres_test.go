package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Запускается только с TEST_DATABASE_URL (чистая тестовая база):
//
//	TEST_DATABASE_URL=postgres://... go test ./internal/store -run TestPostgres
func TestPostgres(t *testing.T) {
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

	// Первый пользователь: приветствие в чате.
	u, err := s.CreateUser(ctx, "alice", "Alice", "hash")
	if err != nil {
		t.Fatal(err)
	}
	actx := WithUser(ctx, u)
	if msgs := s.Messages(actx); len(msgs) != 1 || msgs[0].Text != greetingText {
		t.Fatalf("сообщения: %+v", msgs)
	}

	// Событие: создание, чтение по дате и месяцу, удаление.
	ev, err := s.CreateEvent(actx, model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660, Badge: model.BadgeRoutine})
	if err != nil {
		t.Fatal(err)
	}
	if ev.ID != "evt-1" {
		t.Fatalf("id: %s", ev.ID)
	}
	if got := s.EventsOn(actx, "2026-10-20"); len(got) != 1 || got[0].Title != "Звонок" {
		t.Fatalf("EventsOn: %+v", got)
	}
	if got := s.EventsInMonth(actx, "2026-10"); len(got) != 1 {
		t.Fatalf("EventsInMonth: %+v", got)
	}
	if got := s.EventsInMonth(actx, "2026-11"); len(got) != 0 {
		t.Fatalf("EventsInMonth соседнего месяца: %+v", got)
	}
	if err := s.DeleteEvent(actx, ev.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteEvent(actx, ev.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("повторное удаление должно давать ErrNotFound")
	}

	// Сообщения: добавление и порядок по id.
	if _, err := s.AddMessage(actx, model.RoleUser, "Привет"); err != nil {
		t.Fatal(err)
	}
	if msgs := s.Messages(actx); len(msgs) != 2 || msgs[1].Text != "Привет" {
		t.Fatalf("сообщения: %+v", msgs)
	}

	// Общая задача: участник видит и правит, выходит.
	bob, err := s.CreateUser(ctx, "bob", "Bob", "hash")
	if err != nil {
		t.Fatal(err)
	}
	bctx := WithUser(ctx, bob)
	task, err := s.CreateTask(actx, model.Task{Title: "Общая", Kind: model.TaskKindTask})
	if err != nil {
		t.Fatal(err)
	}
	if task.ID != "task-1" || task.Role != model.TaskRoleOwner {
		t.Fatalf("задача: %+v", task)
	}
	if _, err := s.AddTaskMember(actx, task.ID, bob.ID); err != nil {
		t.Fatal(err)
	}
	if got := s.Tasks(bctx); len(got) != 1 || got[0].Role != model.TaskRoleMember || got[0].Owner.Username != "alice" {
		t.Fatalf("задачи участника: %+v", got)
	}
	done := true
	if _, err := s.UpdateTask(bctx, task.ID, model.TaskPatch{Done: &done}); err != nil {
		t.Fatalf("правка участником: %v", err)
	}
	if err := s.AddNotification(bctx, model.Notification{UserID: bob.ID, Text: "тест"}); err != nil {
		t.Fatal(err)
	}
	if got := s.Notifications(bctx); len(got) != 1 || got[0].Read {
		t.Fatalf("уведомления: %+v", got)
	}
	if err := s.MarkNotificationsRead(bctx); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTask(bctx, task.ID); err != nil {
		t.Fatalf("выход участника: %v", err)
	}
	if got := s.Tasks(bctx); len(got) != 0 {
		t.Fatalf("после выхода: %+v", got)
	}

	// Участник выходит через RemoveTaskMember — после выхода задача ему
	// уже невидима, но операция должна завершиться без ошибки.
	task2, err := s.CreateTask(actx, model.Task{Title: "Выход", Kind: model.TaskKindTask})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddTaskMember(actx, task2.ID, bob.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RemoveTaskMember(bctx, task2.ID, bob.ID); err != nil {
		t.Fatalf("самовыход участника: %v", err)
	}
	if got := s.Tasks(bctx); len(got) != 0 {
		t.Fatalf("после RemoveTaskMember: %+v", got)
	}
	got := s.Tasks(actx)
	if len(got) != 2 || len(got[1].Members) != 0 {
		t.Fatalf("у владельца после RemoveTaskMember: %+v", got)
	}

	// Поиск пользователей: себя нет, запрос фильтрует.
	if got := s.SearchUsers(actx, "bob", 10); len(got) != 1 || got[0].PassHash != "" {
		t.Fatalf("поиск: %+v", got)
	}
	if got := s.SearchUsers(actx, "alice", 10); len(got) != 0 {
		t.Fatalf("сам нашёлся: %+v", got)
	}

	// Сессии: создание, продление, истечение.
	if err := s.CreateSession(ctx, u.ID, "tok", time.Now().Add(SessionTTL)); err != nil {
		t.Fatal(err)
	}
	if got, err := s.UserBySession(ctx, "tok"); err != nil || got.Username != "alice" {
		t.Fatalf("сессия: %v %+v", err, got)
	}
	if err := s.DeleteSession(ctx, "tok"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, "tok"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("удалённая сессия: %v", err)
	}

	// Импорт data.json в пустую базу: записи и счётчики переносятся.
	mustWipe(ctx, t, s)
	dir := t.TempDir()
	writeDataJSON(t, dir)
	s2, err := OpenPostgres(ctx, dsn, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.(*pgStore).pool.Close()
	// У записей из файла нет владельца: первый же аккаунт их усыновляет.
	u3, err := s2.CreateUser(ctx, "carol", "Carol", "hash")
	if err != nil {
		t.Fatal(err)
	}
	cctx := WithUser(ctx, u3)
	if got := s2.EventsOn(cctx, "2026-10-20"); len(got) != 1 || got[0].ID != "evt-7" {
		t.Fatalf("импортированные события: %+v", got)
	}
	// приветствие + импортированная реплика
	if msgs := s2.Messages(cctx); len(msgs) != 3 {
		t.Fatalf("импортированные сообщения: %+v", msgs)
	}
	// Новые записи продолжают нумерацию после импортированных.
	if _, err := s2.CreateEvent(cctx, model.Event{Date: "2026-10-22", Title: "Новое", Start: 60, End: 120, Badge: model.BadgeWork}); err != nil {
		t.Fatal(err)
	}
	if got := s2.EventsOn(cctx, "2026-10-22"); len(got) != 1 || got[0].ID != "evt-8" {
		t.Fatalf("событие после импорта: %+v", got)
	}

	// Повторный запуск с тем же data.json не дублирует данные.
	s3, err := OpenPostgres(ctx, dsn, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s3.(*pgStore).pool.Close()
	if got := s3.EventsOn(cctx, "2026-10-20"); len(got) != 1 {
		t.Fatalf("повторный импорт задублировал события: %+v", got)
	}
	if msgs := s3.Messages(cctx); len(msgs) != 3 {
		t.Fatalf("повторный импорт задублировал сообщения: %+v", msgs)
	}
}

// mustWipe очищает таблицы между сценариями (тестовая база одноразовая).
func mustWipe(ctx context.Context, t *testing.T, s Store) {
	t.Helper()
	pg := s.(*pgStore)
	for _, stmt := range []string{
		`TRUNCATE events, messages, tasks, task_members, users, sessions, notifications, integrations RESTART IDENTITY`,
		`SELECT setval('event_id_seq', 1, FALSE)`,
		`SELECT setval('task_id_seq', 1, FALSE)`,
		`SELECT setval('integration_id_seq', 1, FALSE)`,
	} {
		if _, err := pg.pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("очистка: %v", err)
		}
	}
}

// writeDataJSON пишет data.json с записями, чьи id «не первые», чтобы проверить сдвиг счётчиков.
func writeDataJSON(t *testing.T, dir string) {
	t.Helper()
	content := `{
  "events": [{"id":"evt-7","date":"2026-10-20","title":"Из файла","start":600,"end":660,"badge":"work","highlight":true}],
  "messages": [{"id":0,"role":"ai","text":"Чем могу помочь?","createdAt":"2026-10-19T10:00:00Z"},{"id":1,"role":"user","text":"Привет","createdAt":"2026-10-19T10:00:05Z"}],
  "nextId": 8
}`
	if err := os.WriteFile(dir+"/data.json", []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresIntegrations(t *testing.T) {
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
	testIntegrations(t, s, userCtx(t, s))
	// Миграции повторяемы: второй запуск на той же базе проходит.
	s2, err := OpenPostgres(ctx, dsn, "")
	if err != nil {
		t.Fatalf("повторная миграция: %v", err)
	}
	s2.(*pgStore).pool.Close()
}
