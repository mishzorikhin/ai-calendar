package api

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// loginAs — вход с другим User-Agent (ещё одно устройство); возвращает токен.
func loginAs(t *testing.T, h http.Handler, username, password, ua string) (string, int) {
	t.Helper()
	rec := doAsUA(t, h, "", "POST", "/api/auth/login", `{"username":"`+username+`","password":"`+password+`"}`, ua)
	if rec.Code != 200 {
		return "", rec.Code
	}
	return decode[struct {
		Token string `json:"token"`
	}](t, rec).Token, rec.Code
}

const androidUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"

func TestSessionsAndPassword(t *testing.T) {
	h := newTestServer(t)
	tok := register(t, h, "alice")
	phone, _ := loginAs(t, h, "alice", "secret1", androidUA)
	tablet, _ := loginAs(t, h, "alice", "secret1", "")

	list := decode[[]model.Session](t, doAs(t, h, tok, "GET", "/api/auth/sessions", ""))
	if len(list) != 3 {
		t.Fatalf("сессии: %+v", list)
	}
	var phoneID string
	current := 0
	for _, s := range list {
		if s.Current {
			current++
		}
		if s.Label == "Chrome · Android" {
			phoneID = s.ID
		}
		if len(s.ID) != store.SessionIDLen || s.CreatedAt.IsZero() {
			t.Fatalf("сессия: %+v", s)
		}
	}
	if current != 1 || phoneID == "" {
		t.Fatalf("текущая или телефон: %+v", list)
	}
	// Завершить телефон: его токен больше не работает; чужую сессию не завершить.
	bob := register(t, h, "bob")
	if rec := doAs(t, h, bob, "DELETE", "/api/auth/sessions/"+phoneID, ""); rec.Code != 404 {
		t.Fatalf("чужая сессия: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "DELETE", "/api/auth/sessions/"+phoneID, ""); rec.Code != 204 {
		t.Fatalf("завершить: %d", rec.Code)
	}
	if rec := doAs(t, h, phone, "GET", "/api/me", ""); rec.Code != 401 {
		t.Fatalf("телефон всё ещё в аккаунте: %d", rec.Code)
	}

	// Смена пароля: неверный текущий, короткий новый, затем успех — остальные выходят.
	if rec := doAs(t, h, tok, "POST", "/api/auth/password", `{"current":"wrong","next":"newsecret"}`); rec.Code != 403 {
		t.Fatalf("неверный текущий: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "POST", "/api/auth/password", `{"current":"secret1","next":"x"}`); rec.Code != 400 {
		t.Fatalf("короткий: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "POST", "/api/auth/password", `{"current":"secret1","next":"newsecret"}`); rec.Code != 204 {
		t.Fatalf("смена: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, tablet, "GET", "/api/me", ""); rec.Code != 401 {
		t.Fatalf("другое устройство не вышло: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "GET", "/api/me", ""); rec.Code != 200 {
		t.Fatalf("текущее устройство вышло: %d", rec.Code)
	}
	if _, code := loginAs(t, h, "alice", "secret1", ""); code != 401 {
		t.Fatalf("старый пароль подходит: %d", code)
	}
	again, code := loginAs(t, h, "alice", "newsecret", "")
	if code != 200 {
		t.Fatalf("новый пароль: %d", code)
	}
	if rec := doAs(t, h, tok, "POST", "/api/auth/logout-others", ""); rec.Code != 204 {
		t.Fatalf("выйти на остальных: %d", rec.Code)
	}
	if rec := doAs(t, h, again, "GET", "/api/me", ""); rec.Code != 401 {
		t.Fatalf("после «выйти на остальных»: %d", rec.Code)
	}
}

func TestExportAndDeleteAccount(t *testing.T) {
	_, h, st := newPushServer(t)
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	doAs(t, h, alice, "POST", "/api/events", `{"date":"2030-01-07","title":"Йога","start":540,"end":600}`)
	doAs(t, h, alice, "POST", "/api/memories", `{"kind":"rule","text":"Не ставить встречи до 10"}`)
	mine := decode[model.Task](t, doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Отпуск","members":["bob"]}`))
	bobs := decode[model.Task](t, doAs(t, h, bob, "POST", "/api/tasks", `{"title":"Ремонт","members":["alice"]}`))
	actx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	if _, err := st.SaveIntegration(actx, model.Integration{Kind: model.IntegrationICS, Name: "Работа",
		URL: "https://cal.example.com/private.ics?token=SECRET", Secret: "PASSWORD", Badge: model.BadgeWork}); err != nil {
		t.Fatal(err)
	}

	rec := doAs(t, h, alice, "GET", "/api/export", "")
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Disposition"), "ai-calendar-alice.json") {
		t.Fatalf("экспорт: %d %v", rec.Code, rec.Header())
	}
	for _, want := range []string{"Йога", "Не ставить встречи до 10", "Отпуск", "Ремонт", "https://cal.example.com/private.ics"} {
		if !strings.Contains(body, want) {
			t.Errorf("в экспорте нет %q", want)
		}
	}
	for _, secret := range []string{"SECRET", "PASSWORD", "passHash", "p256dh"} {
		if strings.Contains(body, secret) {
			t.Errorf("в экспорте секрет %q", secret)
		}
	}

	if rec := doAs(t, h, alice, "DELETE", "/api/me", `{"password":"nope"}`); rec.Code != 403 {
		t.Fatalf("удаление с неверным паролем: %d", rec.Code)
	}
	if rec := doAs(t, h, alice, "DELETE", "/api/me", `{"password":"secret1"}`); rec.Code != 204 {
		t.Fatalf("удаление: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, alice, "GET", "/api/me", ""); rec.Code != 401 {
		t.Fatalf("токен после удаления: %d", rec.Code)
	}
	// У Боба: задача Алисы пропала, его задача осталась — без Алисы.
	tasks := decode[[]model.Task](t, doAs(t, h, bob, "GET", "/api/tasks", ""))
	if len(tasks) != 1 || tasks[0].ID != bobs.ID || len(tasks[0].Members) != 0 {
		t.Fatalf("задачи Боба: %+v (удалённая %s)", tasks, mine.ID)
	}
	// Логин свободен, а данных у нового владельца нет.
	fresh := register(t, h, "alice")
	if evs := decode[[]model.Event](t, doAs(t, h, fresh, "GET", "/api/events?date=2030-01-07", "")); len(evs) != 0 {
		t.Fatalf("события достались новому: %+v", evs)
	}
	if mem := decode[[]model.Memory](t, doAs(t, h, fresh, "GET", "/api/memories", "")); len(mem) != 0 {
		t.Fatalf("память досталась новому: %+v", mem)
	}
}

func TestLogoutOthersDropsPush(t *testing.T) {
	_, h, st := newPushServer(t)
	tok := register(t, h, "alice")
	dev := newFakeDevice(t)
	doAs(t, h, tok, "POST", "/api/push/subscriptions", dev.subscription("/lost-phone"))
	ctx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	if len(st.PushSubscriptions(ctx)) != 1 {
		t.Fatal("подписка не сохранилась")
	}
	if rec := doAs(t, h, tok, "POST", "/api/auth/logout-others", ""); rec.Code != 204 {
		t.Fatalf("выйти на остальных: %d", rec.Code)
	}
	if n := len(st.PushSubscriptions(ctx)); n != 0 {
		t.Fatalf("потерянное устройство всё ещё получает push: %d", n)
	}
}
