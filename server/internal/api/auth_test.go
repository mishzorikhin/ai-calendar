package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func TestAuthFlow(t *testing.T) {
	h := newTestServer(t)

	// Валидация регистрации.
	for name, body := range map[string]string{
		"логин кириллицей": `{"username":"миша","password":"secret1"}`,
		"короткий логин":   `{"username":"ab","password":"secret1"}`,
		"короткий пароль":  `{"username":"misha","password":"123"}`,
	} {
		if rec := do(t, h, "POST", "/api/auth/register", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s, ждали 400", name, rec.Code, rec.Body)
		}
	}

	// Регистрация → токен и профиль.
	rec := do(t, h, "POST", "/api/auth/register", `{"username":"Alice","name":"Алиса","password":"secret1"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("регистрация: %d %s", rec.Code, rec.Body)
	}
	out := decode[struct {
		User  model.User `json:"user"`
		Token string     `json:"token"`
	}](t, rec)
	if out.User.Username != "alice" || out.User.Name != "Алиса" || out.User.PassHash != "" || out.Token == "" {
		t.Fatalf("ответ регистрации: %+v", out)
	}
	tok := out.Token

	// Имя приводится к нижнему регистру, дубликат — 409.
	if rec := do(t, h, "POST", "/api/auth/register", `{"username":"ALICE","password":"secret1"}`); rec.Code != http.StatusConflict {
		t.Fatalf("дубликат: %d %s", rec.Code, rec.Body)
	}

	// me — свой профиль.
	me := decode[model.User](t, doAs(t, h, tok, "GET", "/api/me", ""))
	if me.Username != "alice" || me.PassHash != "" {
		t.Fatalf("me: %+v", me)
	}

	// Смена отображаемого имени.
	me = decode[model.User](t, doAs(t, h, tok, "PATCH", "/api/me", `{"name":"Алиса Z"}`))
	if me.Name != "Алиса Z" {
		t.Fatalf("rename: %+v", me)
	}

	// Вход по логину в любом регистре.
	rec = do(t, h, "POST", "/api/auth/login", `{"username":"Alice","password":"secret1"}`)
	if rec.Code != 200 || decode[struct {
		Token string `json:"token"`
	}](t, rec).Token == "" {
		t.Fatalf("логин: %d %s", rec.Code, rec.Body)
	}
	// Неверный пароль и несуществующий логин — одинаковый 401.
	for _, body := range []string{
		`{"username":"alice","password":"wrong"}`,
		`{"username":"nobody","password":"secret1"}`,
	} {
		if rec := do(t, h, "POST", "/api/auth/login", body); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: %d, ждали 401", body, rec.Code)
		}
	}

	// Выход: токен перестаёт работать.
	if rec := doAs(t, h, tok, "POST", "/api/auth/logout", ""); rec.Code != http.StatusNoContent && rec.Code != 200 {
		t.Fatalf("logout: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "GET", "/api/me", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("после logout me: %d", rec.Code)
	}
}

func TestAuthRequired(t *testing.T) {
	h := newTestServer(t)
	// Все данные — только за токеном.
	for _, path := range []string{
		"/api/events?date=2026-10-20", "/api/month?year=2026&month=10", "/api/tasks",
		"/api/messages", "/api/notifications", "/api/users", "/api/me",
	} {
		if rec := do(t, h, "GET", path, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s без токена: %d, ждали 401", path, rec.Code)
		}
	}
	for _, p := range [][2]string{
		{"POST", "/api/events"}, {"POST", "/api/tasks"}, {"POST", "/api/messages"}, {"POST", "/api/chat"},
	} {
		if rec := do(t, h, p[0], p[1], `{}`); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s без токена: %d, ждали 401", p[0], p[1], rec.Code)
		}
	}
	// Плохой токен — тоже 401.
	if rec := doAs(t, h, "broken-token", "GET", "/api/me", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("битый токен: %d", rec.Code)
	}
	// А здоровье и вход — открыты.
	if rec := do(t, h, "GET", "/api/health", ""); rec.Code != 200 {
		t.Fatalf("health: %d", rec.Code)
	}
}

func TestDataIsolation(t *testing.T) {
	h, alice := newAuthedServer(t)
	bob := register(t, h, "bob")

	// Алиса создала событие, задачу и сообщение — у Боба всё пусто.
	doAs(t, h, alice, "POST", "/api/events", `{"date":"2026-10-20","title":"Встреча","start":600,"end":660}`)
	doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Личное"}`)
	doAs(t, h, alice, "POST", "/api/messages", `{"role":"user","text":"только моё"}`)

	if got := decode[[]model.Event](t, doAs(t, h, bob, "GET", "/api/events?date=2026-10-20", "")); len(got) != 0 {
		t.Fatalf("чужие события у Боба: %+v", got)
	}
	if got := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", "")); len(got) != 0 {
		t.Fatalf("чужие задачи у Боба: %+v", got)
	}
	if got := decode[[]model.Message](t, doAs(t, h, bob, "GET", "/api/messages", "")); len(got) != 1 {
		t.Fatalf("чужие сообщения у Боба (только приветствие): %+v", got)
	}
	// Чужое событие по id — 404, а не «есть, но не трогай».
	events := decode[[]model.Event](t, doAs(t, h, alice, "GET", "/api/events?date=2026-10-20", ""))
	if rec := doAs(t, h, bob, "DELETE", "/api/events/"+events[0].ID, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("удаление чужого события: %d", rec.Code)
	}
}

func TestUsersSearch(t *testing.T) {
	h, alice := newAuthedServer(t)
	register(t, h, "anna")
	register(t, h, "anatoly")
	register(t, h, "bob")

	users := decode[[]model.User](t, doAs(t, h, alice, "GET", "/api/users?q=an", ""))
	names := []string{}
	for _, u := range users {
		names = append(names, u.Username)
		if u.PassHash != "" {
			t.Fatalf("хэш утёк в поиск: %+v", u)
		}
	}
	if len(names) != 2 {
		t.Fatalf("поиск 'an': %v", names)
	}
	// Себя в выдаче нет.
	users = decode[[]model.User](t, doAs(t, h, alice, "GET", "/api/users?q=alice", ""))
	if len(users) != 0 {
		t.Fatalf("сам нашёлся: %+v", users)
	}
}

func TestTaskSharing(t *testing.T) {
	h, alice := newAuthedServer(t)
	bob := register(t, h, "bob")
	carol := register(t, h, "carol")

	// Алиса создаёт задачу с участником.
	rec := doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Поход в горы","members":["bob"]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание: %d %s", rec.Code, rec.Body)
	}
	task := decode[model.Task](t, rec)
	if task.Role != model.TaskRoleOwner || len(task.Members) != 1 || task.Members[0].Username != "bob" {
		t.Fatalf("задача: %+v", task)
	}

	// Боб видит её как участник, а Кэрол — нет.
	bobTasks := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", ""))
	if len(bobTasks) != 1 || bobTasks[0].Role != model.TaskRoleMember || bobTasks[0].Owner == nil || bobTasks[0].Owner.Username != "alice" {
		t.Fatalf("задачи Боба: %+v", bobTasks)
	}
	if got := decode[[]model.Task](t, doAs(t, h, carol, "GET", "/api/tasks", "")); len(got) != 0 {
		t.Fatalf("Кэрол видит чужое: %+v", got)
	}

	// Боб получил уведомление о шаринге.
	notifs := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", ""))
	if len(notifs) != 1 || notifs[0].Read || notifs[0].TaskID != task.ID ||
		notifs[0].From == nil || notifs[0].From.Username != "alice" || !strings.Contains(notifs[0].Text, "Поход в горы") {
		t.Fatalf("уведомление Боба: %+v", notifs)
	}
	if rec := doAs(t, h, bob, "POST", "/api/notifications/read", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("read: %d", rec.Code)
	}
	notifs = decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", ""))
	if !notifs[0].Read {
		t.Fatalf("не прочиталось: %+v", notifs)
	}

	// Участник правит задачу.
	rec = doAs(t, h, bob, "PATCH", "/api/tasks/"+task.ID, `{"done":true}`)
	if rec.Code != 200 || !decode[model.Task](t, rec).Done {
		t.Fatalf("правка участником: %d %s", rec.Code, rec.Body)
	}

	// Участник не может удалять других — это право владельца.
	if rec := doAs(t, h, bob, "DELETE", "/api/tasks/"+task.ID+"/members/carol", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("участник удаляет чужого: %d", rec.Code)
	}
	// Владелец удаляет участника.
	rec = doAs(t, h, alice, "DELETE", "/api/tasks/"+task.ID+"/members/bob", "")
	if rec.Code != 200 || len(decode[model.Task](t, rec).Members) != 0 {
		t.Fatalf("удаление участника владельцем: %d %s", rec.Code, rec.Body)
	}
	if got := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", "")); len(got) != 0 {
		t.Fatalf("Боб после отчисления: %+v", got)
	}

	// Владелец не может «выйти» из своей задачи.
	if rec := doAs(t, h, alice, "DELETE", "/api/tasks/"+task.ID+"/members/alice", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("выход владельца: %d", rec.Code)
	}
	// Незнакомый логин — 404/400.
	if rec := doAs(t, h, alice, "POST", "/api/tasks/"+task.ID+"/members", `{"username":"ghost"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("неизвестный участник: %d", rec.Code)
	}
	if rec := doAs(t, h, alice, "POST", "/api/tasks", `{"title":"x","members":["ghost"]}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("members при создании: %d", rec.Code)
	}
}

func TestMentions(t *testing.T) {
	h, alice := newAuthedServer(t)
	bob := register(t, h, "bob")

	// @логин в названии делит задачу.
	rec := doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Купить палатку с @bob"}`)
	task := decode[model.Task](t, rec)
	if rec.Code != 201 || len(task.Members) != 1 || task.Members[0].Username != "bob" {
		t.Fatalf("mention при создании: %d %+v", rec.Code, task)
	}
	// Боб упомянут — у него уведомление.
	notifs := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", ""))
	if len(notifs) != 1 {
		t.Fatalf("уведомления Боба: %+v", notifs)
	}

	// Упоминание в заметке при правке добавляет ещё одного участника.
	register(t, h, "carol")
	rec = doAs(t, h, alice, "PATCH", "/api/tasks/"+task.ID, `{"subtitle":"спросить @carol про сроки"}`)
	task = decode[model.Task](t, rec)
	if len(task.Members) != 2 {
		t.Fatalf("mention при правке: %+v", task)
	}

	// Неизвестное @имя — просто текст, ошибки нет.
	rec = doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Позвонить @никому"}`)
	if rec.Code != http.StatusCreated || len(decode[model.Task](t, rec).Members) != 0 {
		t.Fatalf("неизвестный mention: %d %s", rec.Code, rec.Body)
	}
	// Повторное упоминание не дублирует участника.
	rec = doAs(t, h, alice, "PATCH", "/api/tasks/"+task.ID, `{"title":"Купить палатку с @bob уже"}`)
	if got := decode[model.Task](t, rec); len(got.Members) != 2 {
		t.Fatalf("дубль участника: %+v", got)
	}
}

func TestMemberLeavesSharedTask(t *testing.T) {
	h, alice := newAuthedServer(t)
	bob := register(t, h, "bob")

	rec := doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Общая","members":["bob"]}`)
	task := decode[model.Task](t, rec)

	// Участник удаляет задачу у себя — у владельца она остаётся.
	if rec := doAs(t, h, bob, "DELETE", "/api/tasks/"+task.ID, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("выход участника: %d", rec.Code)
	}
	if got := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", "")); len(got) != 0 {
		t.Fatalf("Боб после выхода: %+v", got)
	}
	rest := decode[[]model.Task](t, doAs(t, h, alice, "GET", "/api/tasks", ""))
	if len(rest) != 1 || len(rest[0].Members) != 0 {
		t.Fatalf("задача Алисы после выхода Боба: %+v", rest)
	}
	// Владелец удаляет — задача пропадает у всех.
	if rec := doAs(t, h, alice, "DELETE", "/api/tasks/"+task.ID, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("удаление владельцем: %d", rec.Code)
	}
}

func TestOrphanAdoption(t *testing.T) {
	// Файл с данными «до аккаунтов»: события/задачи/сообщения без владельца.
	dir := t.TempDir()
	legacy := `{
  "events": [{"id":"evt-1","date":"2026-10-20","title":"Старое","start":600,"end":660,"badge":"work"}],
  "tasks":  [{"id":"task-1","title":"Старая задача","kind":"task","done":false}],
  "messages": [{"id":0,"role":"ai","text":"Чем могу помочь?","createdAt":"2026-10-19T10:00:00Z"}],
  "nextId": 2
}`
	if err := os.WriteFile(filepath.Join(dir, "data.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	h := New(Options{Store: st})

	// Первый зарегистрированный получает всё старое.
	alice := register(t, h, "alice")
	if got := decode[[]model.Event](t, doAs(t, h, alice, "GET", "/api/events?date=2026-10-20", "")); len(got) != 1 {
		t.Fatalf("наследство событий: %+v", got)
	}
	got := decode[[]model.Task](t, doAs(t, h, alice, "GET", "/api/tasks", ""))
	if len(got) != 1 || got[0].Role != model.TaskRoleOwner {
		t.Fatalf("наследство задач: %+v", got)
	}

	// Второй — начинает с чистого листа (только приветствие в чате).
	bob := register(t, h, "bob")
	if got := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", "")); len(got) != 0 {
		t.Fatalf("Боб получил чужое наследство: %+v", got)
	}
	msgs := decode[[]model.Message](t, doAs(t, h, bob, "GET", "/api/messages", ""))
	if len(msgs) != 1 || msgs[0].Role != model.RoleAI {
		t.Fatalf("чат Боба: %+v", msgs)
	}
}

func TestChatShareTool(t *testing.T) {
	st, _ := store.Open("")
	// Модель создаёт задачу с участниками через members.
	llmc, _ := fakeChatLLM(t, [][]string{
		{`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"create_task","arguments":"{\"title\":\"Ремонт\",\"members\":[\"bob\"]}"}}]}}]}`},
		{`{"choices":[{"delta":{"content":"Сделал общей."}}]}`},
	})
	h := New(Options{Store: st, LLM: llmc})
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	doAs(t, h, alice, "POST", "/api/chat", `{"text":"общая задача ремонт с Бобом"}`)

	tasks := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", ""))
	if len(tasks) != 1 || tasks[0].Role != model.TaskRoleMember {
		t.Fatalf("общая задача из чата: %+v", tasks)
	}
}

func TestPasswordHashing(t *testing.T) {
	h1, err := hashPassword("secret1")
	if err != nil || !strings.HasPrefix(h1, "pbkdf2$") {
		t.Fatalf("hash: %v %q", err, h1)
	}
	if !checkPassword("secret1", h1) || checkPassword("other", h1) {
		t.Fatal("checkPassword")
	}
	if checkPassword("x", "garbage") || checkPassword("x", "pbkdf2$abc$zz$yy") {
		t.Fatal("битый формат прошёл проверку")
	}
}

func TestSessionExpiry(t *testing.T) {
	s, _ := store.Open("")
	ctx := t.Context()
	u, _ := s.CreateUser(ctx, "alice", "Alice", "hash")
	if err := s.CreateSession(ctx, u.ID, "expired", time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(ctx, "expired"); err != store.ErrUnauthorized {
		t.Fatalf("просроченная сессия: %v", err)
	}
	if err := s.CreateSession(ctx, u.ID, "fresh", time.Now().Add(store.SessionTTL)); err != nil {
		t.Fatal(err)
	}
	got, err := s.UserBySession(ctx, "fresh")
	if err != nil || got.Username != "alice" {
		t.Fatalf("свежая сессия: %v %+v", err, got)
	}
	s.DeleteSession(ctx, "fresh")
	if _, err := s.UserBySession(ctx, "fresh"); err != store.ErrUnauthorized {
		t.Fatalf("удалённая сессия: %v", err)
	}
}
