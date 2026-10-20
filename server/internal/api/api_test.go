package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	st, err := store.Open("")
	if err != nil {
		t.Fatal(err)
	}
	web := fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>AI</title>")},
		"assets/app-abc.js":    {Data: []byte("console.log(1)")},
		"manifest.webmanifest": {Data: []byte("{}")},
	}
	return New(Options{Store: st, Web: web, Version: "test"})
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&v); err != nil {
		t.Fatalf("разбор ответа %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestHealth(t *testing.T) {
	rec := do(t, newTestServer(t), "GET", "/api/health", "")
	if rec.Code != 200 || decode[map[string]string](t, rec)["status"] != "ok" {
		t.Fatalf("health: %d %s", rec.Code, rec.Body)
	}
}

func TestEventsFlow(t *testing.T) {
	h := newTestServer(t)

	base := decode[[]model.Event](t, do(t, h, "GET", "/api/events?date=2026-10-20", ""))
	if len(base) == 0 {
		t.Fatal("ожидали типовое расписание")
	}

	rec := do(t, h, "POST", "/api/events", `{"date":"2026-10-20","title":"Звонок маме","start":540,"end":600}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание: %d %s", rec.Code, rec.Body)
	}
	created := decode[model.Event](t, rec)
	if created.Badge != model.BadgeRoutine || !created.Highlight {
		t.Fatalf("значения по умолчанию: %+v", created)
	}

	after := decode[[]model.Event](t, do(t, h, "GET", "/api/events?date=2026-10-20", ""))
	if len(after) != len(base)+1 {
		t.Fatalf("событий %d, ожидали %d", len(after), len(base)+1)
	}
	for i := 1; i < len(after); i++ {
		if after[i-1].Start > after[i].Start {
			t.Fatal("события не отсортированы по времени")
		}
	}

	if rec := do(t, h, "DELETE", "/api/events/"+created.ID, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("удаление: %d", rec.Code)
	}
	if rec := do(t, h, "DELETE", "/api/events/"+created.ID, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("повторное удаление: %d", rec.Code)
	}
}

func TestEventValidation(t *testing.T) {
	h := newTestServer(t)
	cases := map[string]string{
		"дата":         `{"date":"20.10.2026","title":"x","start":60,"end":120}`,
		"пустое имя":   `{"date":"2026-10-20","title":"  ","start":60,"end":120}`,
		"время":        `{"date":"2026-10-20","title":"x","start":120,"end":60}`,
		"тип":          `{"date":"2026-10-20","title":"x","start":60,"end":120,"badge":"party"}`,
		"подзаголовок": `{"date":"2026-10-20","title":"x","subtitle":"` + strings.Repeat("я", maxSubtitle+1) + `","start":60,"end":120}`,
		"лишнее поле":  `{"date":"2026-10-20","title":"x","start":60,"end":120,"color":"red"}`,
		"битый JSON":   `{"date":`,
		"два объекта":  `{"date":"2026-10-20","title":"x","start":60,"end":120}{}`,
	}
	for name, body := range cases {
		if rec := do(t, h, "POST", "/api/events", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: код %d, ожидали 400 (%s)", name, rec.Code, rec.Body)
		}
	}
	if rec := do(t, h, "GET", "/api/events", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("без даты: %d", rec.Code)
	}
}

func TestBookingFlow(t *testing.T) {
	h := newTestServer(t)

	if rec := do(t, h, "POST", "/api/bookings", `{"placeId":"ambient","date":"2026-10-21","start":540,"end":630,"guests":2}`); rec.Code != http.StatusConflict {
		t.Fatalf("закрытое место: %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, "POST", "/api/bookings", `{"placeId":"scramble","date":"2026-10-21","start":540,"end":630,"guests":12}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("много гостей: %d", rec.Code)
	}
	if rec := do(t, h, "POST", "/api/bookings", `{"placeId":"nope","date":"2026-10-21","start":540,"end":630,"guests":2}`); rec.Code != http.StatusNotFound {
		t.Fatalf("нет места: %d", rec.Code)
	}

	rec := do(t, h, "POST", "/api/bookings", `{"placeId":"scramble","date":"2026-10-21","start":540,"end":630,"guests":2,"invite":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("бронь: %d %s", rec.Code, rec.Body)
	}
	b := decode[model.Booking](t, rec)
	if b.Code != "A-4821" || b.Place.Name != "Scramble place" || b.Status != model.BookingConfirmed {
		t.Fatalf("бронь: %+v", b)
	}

	// Бронь появляется в дне и в месяце.
	day := decode[[]model.Event](t, do(t, h, "GET", "/api/events?date=2026-10-21", ""))
	if !containsEvent(day, "booking-"+b.ID) {
		t.Fatal("бронь не попала в события дня")
	}
	dots := decode[map[string][]model.Badge](t, do(t, h, "GET", "/api/month?year=2026&month=10", ""))
	if len(dots["21"]) == 0 {
		t.Fatalf("бронь не попала в точки месяца: %v", dots)
	}

	// Пересекающаяся бронь на то же время — 409, смежная — можно.
	if rec := do(t, h, "POST", "/api/bookings", `{"placeId":"scramble","date":"2026-10-21","start":600,"end":700,"guests":2}`); rec.Code != http.StatusConflict {
		t.Fatalf("пересечение броней: %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, "POST", "/api/bookings", `{"placeId":"scramble","date":"2026-10-21","start":630,"end":700,"guests":2}`); rec.Code != http.StatusCreated {
		t.Fatalf("смежная бронь: %d %s", rec.Code, rec.Body)
	}

	cancelled := decode[model.Booking](t, do(t, h, "DELETE", "/api/bookings/"+b.ID, ""))
	if cancelled.Status != model.BookingCancelled {
		t.Fatalf("отмена: %+v", cancelled)
	}
	day = decode[[]model.Event](t, do(t, h, "GET", "/api/events?date=2026-10-21", ""))
	if containsEvent(day, "booking-"+b.ID) {
		t.Fatal("отменённая бронь осталась в дне")
	}
}

func containsEvent(list []model.Event, id string) bool {
	for _, e := range list {
		if e.ID == id {
			return true
		}
	}
	return false
}

func TestPlacesAndMessages(t *testing.T) {
	h := newTestServer(t)
	if places := decode[[]model.Place](t, do(t, h, "GET", "/api/places", "")); len(places) == 0 {
		t.Fatal("нет мест")
	}
	if rec := do(t, h, "GET", "/api/places/scramble/reviews", ""); rec.Code != 200 {
		t.Fatalf("отзывы: %d", rec.Code)
	}
	if rec := do(t, h, "GET", "/api/places/nope/reviews", ""); rec.Code != 404 {
		t.Fatalf("отзывы несуществующего места: %d", rec.Code)
	}

	msgs := decode[[]model.Message](t, do(t, h, "GET", "/api/messages", ""))
	if len(msgs) != 1 || msgs[0].Role != model.RoleAI {
		t.Fatalf("приветствие: %+v", msgs)
	}
	if rec := do(t, h, "POST", "/api/messages", `{"role":"robot","text":"x"}`); rec.Code != 400 {
		t.Fatalf("роль: %d", rec.Code)
	}
	m := decode[model.Message](t, do(t, h, "POST", "/api/messages", `{"role":"user","text":"  Привет  "}`))
	if m.Text != "Привет" || m.ID != 1 {
		t.Fatalf("сообщение: %+v", m)
	}
}

func TestMonthValidation(t *testing.T) {
	h := newTestServer(t)
	for _, q := range []string{"", "?year=2026", "?year=2026&month=13", "?year=abc&month=1"} {
		if rec := do(t, h, "GET", "/api/month"+q, ""); rec.Code != 400 {
			t.Errorf("%q: %d", q, rec.Code)
		}
	}
}

func TestSPA(t *testing.T) {
	h := newTestServer(t)

	rec := do(t, h, "GET", "/", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "<title>AI</title>") || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("index: %d %q %q", rec.Code, rec.Body, rec.Header().Get("Cache-Control"))
	}
	if rec := do(t, h, "GET", "/day", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), "AI") {
		t.Fatalf("клиентский маршрут: %d", rec.Code)
	}
	rec = do(t, h, "GET", "/assets/app-abc.js", "")
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("ассет: %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	if rec := do(t, h, "GET", "/assets/missing.js", ""); rec.Code != 404 {
		t.Fatalf("нет файла: %d", rec.Code)
	}
	if ct := do(t, h, "GET", "/manifest.webmanifest", "").Header().Get("Content-Type"); ct != "application/manifest+json" {
		t.Fatalf("манифест: %q", ct)
	}
	if rec := do(t, h, "GET", "/api/unknown", ""); rec.Code != 404 || !strings.Contains(rec.Body.String(), "error") {
		t.Fatalf("неизвестный метод API: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("нет Content-Security-Policy")
	}
	if rec := do(t, h, "POST", "/", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST на статику: %d", rec.Code)
	}
}

func TestCORS(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st, CORSOrigins: []string{"http://localhost:5173"}})
	req := httptest.NewRequest("OPTIONS", "/api/events", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}
	req = httptest.NewRequest("GET", "/api/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("чужой источник получил доступ")
	}
}
