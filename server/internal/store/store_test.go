package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

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

// checkRecentMessages — последние реплики идут по порядку и не смешиваются с чужими.
func checkRecentMessages(t *testing.T, s Store) {
	t.Helper()
	ctx := userCtx(t, s)
	other, err := s.CreateUser(context.Background(), "recent-other", "Other", "hash")
	if err != nil {
		t.Fatal(err)
	}
	octx := WithUser(context.Background(), other)
	for _, text := range []string{"раз", "два", "три"} {
		if _, err := s.AddMessage(ctx, model.RoleUser, text); err != nil {
			t.Fatal(err)
		}
		if _, err := s.AddMessage(octx, model.RoleUser, "чужое "+text); err != nil {
			t.Fatal(err)
		}
	}
	got := s.RecentMessages(ctx, 2)
	if len(got) != 2 || got[0].Text != "два" || got[1].Text != "три" || got[0].ID >= got[1].ID {
		t.Fatalf("последние реплики: %+v", got)
	}
	if all := s.RecentMessages(ctx, 100); len(all) != len(s.Messages(ctx)) {
		t.Fatalf("n больше истории: %d из %d", len(all), len(s.Messages(ctx)))
	}
	if s.UserCount(context.Background()) < 2 {
		t.Fatal("UserCount не видит аккаунты")
	}
}

func TestRecentMessages(t *testing.T) {
	s, _ := Open("")
	if s.UserCount(context.Background()) != 0 {
		t.Fatal("пустое хранилище без аккаунтов")
	}
	checkRecentMessages(t, s)
}

func TestExpiredSessionsPruned(t *testing.T) {
	st, _ := Open("")
	fs := st.(*fileStore)
	ctx := userCtx(t, st)
	u, _ := UserFrom(ctx)
	past := time.Now().Add(-time.Hour)
	if err := st.CreateSession(ctx, u.ID, "old", past); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSession(ctx, u.ID, "new", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, ok := fs.d.Sessions["old"]; ok {
		t.Fatal("истёкшая сессия не убрана")
	}
	if _, ok := fs.d.Sessions["new"]; !ok {
		t.Fatal("новая сессия пропала")
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

// testIntegrations — общий сценарий подключённых календарей для обеих реализаций хранилища.
func testIntegrations(t *testing.T, s Store, actx context.Context) {
	t.Helper()
	ctx := context.Background()
	bob, err := s.CreateUser(ctx, "bob-cal", "Bob", "hash")
	if err != nil {
		t.Fatal(err)
	}
	bctx := WithUser(ctx, bob)

	a, err := s.SaveIntegration(actx, model.Integration{Kind: model.IntegrationCalDAV, Name: "Яндекс", Badge: model.BadgeWork, Writable: true, Primary: true, Secret: "v1:x"})
	if err != nil || a.ID == "" || a.CreatedAt.IsZero() {
		t.Fatalf("создание: %+v %v", a, err)
	}
	b, err := s.SaveIntegration(actx, model.Integration{Kind: model.IntegrationGoogle, Name: "Google", Writable: true, Primary: true})
	if err != nil {
		t.Fatal(err)
	}
	// Основной календарь один: новый Primary снимает отметку со старого.
	if got, _ := s.Integration(actx, a.ID); got.Primary || got.Secret != "v1:x" {
		t.Fatalf("старый основной: %+v", got)
	}
	if got := s.Integrations(actx); len(got) != 2 || got[0].ID != a.ID || !got[1].Primary {
		t.Fatalf("список: %+v", got)
	}
	if got := s.Integrations(bctx); len(got) != 0 {
		t.Fatalf("bob видит чужие календари: %+v", got)
	}
	if _, err := s.Integration(bctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужой календарь: %v", err)
	}
	if _, err := s.SaveIntegration(bctx, model.Integration{ID: a.ID, Name: "взлом"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужой календарь не перезаписать: %v", err)
	}
	if all := s.AllIntegrations(ctx); len(all) != 2 {
		t.Fatalf("все подключения: %+v", all)
	}

	// Синхронизация: id сохраняются, лишнее удаляется, своё не трогается.
	own, _ := s.CreateEvent(actx, model.Event{Date: "2026-10-21", Title: "Своё", Start: 600, End: 660, Badge: model.BadgeRoutine})
	ext := func(id, title string, start int) model.Event {
		return model.Event{Date: "2026-10-21", Title: title, Start: start, End: start + 60, Badge: model.BadgeWork, ExternalID: id, ETag: "1"}
	}
	stats, err := s.SyncEvents(actx, a.ID, []model.Event{ext("x1", "Планёрка", 540), ext("x2", "Обед", 780), ext("x2", "дубль", 0)})
	if err != nil || stats.Added != 2 {
		t.Fatalf("первая синхронизация: %+v %v", stats, err)
	}
	day := s.EventsOn(actx, "2026-10-21")
	var planID string
	for _, e := range day {
		if e.ExternalID == "x1" {
			planID = e.ID
			if e.Source != a.ID || e.Highlight || e.ETag != "1" {
				t.Fatalf("внешнее событие: %+v", e)
			}
		}
	}
	if len(day) != 3 || planID == "" {
		t.Fatalf("день: %+v", day)
	}
	upd := ext("x1", "Планёрка (перенесли)", 600)
	upd.ReadOnly, upd.ETag = true, "2"
	stats, err = s.SyncEvents(actx, a.ID, []model.Event{upd})
	if err != nil || stats.Updated != 1 || stats.Removed != 1 || stats.Added != 0 {
		t.Fatalf("вторая синхронизация: %+v %v", stats, err)
	}
	got, err := s.Event(actx, planID)
	if err != nil || got.Title != "Планёрка (перенесли)" || got.Start != 600 || !got.ReadOnly || got.ETag != "2" {
		t.Fatalf("обновлённое событие сохранило id: %+v %v", got, err)
	}
	if stats, _ := s.SyncEvents(actx, a.ID, []model.Event{upd}); stats.Updated != 0 {
		t.Fatalf("без изменений — без обновлений: %+v", stats)
	}
	if err := s.SetEventETag(actx, planID, "3"); err != nil {
		t.Fatal(err)
	}
	if between := s.EventsBetween(actx, "2026-10-20", "2026-10-21"); len(between) != 2 {
		t.Fatalf("EventsBetween: %+v", between)
	}

	// Удаление подключения уносит его события, своё остаётся.
	if err := s.DeleteIntegration(actx, a.ID); err != nil {
		t.Fatal(err)
	}
	if day := s.EventsOn(actx, "2026-10-21"); len(day) != 1 || day[0].ID != own.ID {
		t.Fatalf("после удаления календаря: %+v", day)
	}
	if err := s.DeleteIntegration(actx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("повторное удаление: %v", err)
	}
	_ = b

	// Пояс и лента.
	u, err := s.SetTimeZone(actx, "Asia/Yekaterinburg")
	if err != nil || u.TimeZone != "Asia/Yekaterinburg" {
		t.Fatalf("пояс: %+v %v", u, err)
	}
	me, _ := UserFrom(actx)
	if byID, err := s.UserByID(ctx, me.ID); err != nil || byID.TimeZone != "Asia/Yekaterinburg" || byID.PassHash != "" {
		t.Fatalf("UserByID: %+v %v", byID, err)
	}
	if tok, _ := s.FeedToken(actx); tok != "" {
		t.Fatalf("лента выключена по умолчанию: %q", tok)
	}
	if err := s.SetFeedToken(actx, "feed-secret"); err != nil {
		t.Fatal(err)
	}
	if owner, err := s.UserByFeedToken(ctx, "feed-secret"); err != nil || owner.ID != me.ID {
		t.Fatalf("владелец ленты: %+v %v", owner, err)
	}
	if _, err := s.UserByFeedToken(ctx, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("пустой токен: %v", err)
	}
	_ = s.SetFeedToken(actx, "")
	if _, err := s.UserByFeedToken(ctx, "feed-secret"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("выключенная лента: %v", err)
	}
}

func TestFileIntegrations(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userCtx(t, s)
	testIntegrations(t, s, ctx)

	// Всё переживает перезапуск.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx2 := userCtx(t, s2)
	if got := s2.Integrations(ctx2); len(got) != 1 || got[0].Name != "Google" {
		t.Fatalf("после перезапуска: %+v", got)
	}
	if u, _ := UserFrom(ctx2); u.TimeZone != "Asia/Yekaterinburg" {
		t.Fatalf("пояс после перезапуска: %+v", u)
	}
}
