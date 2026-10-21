package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/calsync"
	"github.com/mishzorikhin/ai-calendar/server/internal/calsync/fakecal"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

var moscow = func() *time.Location { l, _ := time.LoadLocation("Europe/Moscow"); return l }()

// newCalServer — сервер с календарями; тестовые сервисы слушают 127.0.0.1, поэтому AllowPrivate.
func newCalServer(t *testing.T, opts CalendarOptions) (http.Handler, string) {
	t.Helper()
	st, err := store.Open("")
	if err != nil {
		t.Fatal(err)
	}
	opts.AllowPrivate = true
	opts.DefaultTimeZone = "Europe/Moscow"
	h := New(Options{Store: st, Version: "test", Calendars: opts})
	return h, register(t, h, "alice")
}

// tomorrow — завтрашняя дата по Москве и момент времени в этот день.
func tomorrow(hour int) (string, time.Time) {
	now := time.Now().In(moscow)
	d := time.Date(now.Year(), now.Month(), now.Day()+1, hour, 0, 0, 0, moscow)
	return d.Format(time.DateOnly), d
}

func icsEvent(uid, title string, start time.Time, minutes int) string {
	return fmt.Sprintf("BEGIN:VEVENT\r\nUID:%s\r\nSUMMARY:%s\r\nDTSTART:%s\r\nDTEND:%s\r\nEND:VEVENT\r\n",
		uid, title, start.UTC().Format("20060102T150405Z"), start.Add(time.Duration(minutes)*time.Minute).UTC().Format("20060102T150405Z"))
}

func dayEvents(t *testing.T, h http.Handler, tok, date string) []model.Event {
	t.Helper()
	rec := doAs(t, h, tok, "GET", "/api/events?date="+date, "")
	if rec.Code != 200 {
		t.Fatalf("события дня: %d %s", rec.Code, rec.Body)
	}
	return decode[[]model.Event](t, rec)
}

func findTitle(events []model.Event, title string) (model.Event, bool) {
	for _, e := range events {
		if e.Title == title {
			return e, true
		}
	}
	return model.Event{}, false
}

func TestICSSubscriptionFlow(t *testing.T) {
	date, start := tomorrow(10)
	allDay := start.Format("20060102")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/html" {
			_, _ = w.Write([]byte("<html></html>"))
			return
		}
		w.Header().Set("Content-Type", "text/calendar")
		fmt.Fprintf(w, "BEGIN:VCALENDAR\r\n%sBEGIN:VEVENT\r\nUID:bd\r\nSUMMARY:День рождения\r\nDTSTART;VALUE=DATE:%s\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
			icsEvent("w1", "Стендап", start, 30), allDay)
	}))
	defer srv.Close()
	h, tok := newCalServer(t, CalendarOptions{})

	if rec := doAs(t, h, tok, "POST", "/api/integrations", `{"kind":"ics","url":"ftp://x"}`); rec.Code != 400 {
		t.Fatalf("плохой адрес: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, tok, "POST", "/api/integrations", fmt.Sprintf(`{"kind":"ics","url":%q}`, srv.URL+"/html")); rec.Code != 400 {
		t.Fatalf("не календарь: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, tok, "POST", "/api/integrations", `{"kind":"google"}`); rec.Code != 400 {
		t.Fatalf("google — только через OAuth: %d", rec.Code)
	}
	rec := doAs(t, h, tok, "POST", "/api/integrations", fmt.Sprintf(`{"kind":"ics","url":%q,"name":"Работа","badge":"work"}`, srv.URL+"/cal.ics"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("подписка: %d %s", rec.Code, rec.Body)
	}
	view := decode[integrationView](t, rec)
	if view.Writable || view.Account != "127.0.0.1" || view.LastSync == nil {
		t.Fatalf("представление: %+v", view)
	}
	if strings.Contains(rec.Body.String(), "secret") || strings.Contains(rec.Body.String(), "/cal.ics") {
		t.Fatalf("в ответе лишнее: %s", rec.Body)
	}

	events := dayEvents(t, h, tok, date)
	standup, ok := findTitle(events, "Стендап")
	if !ok || standup.Start != 600 || standup.End != 630 || !standup.ReadOnly || standup.Source != view.ID || standup.Badge != model.BadgeWork {
		t.Fatalf("событие подписки: %+v", events)
	}
	if bd, ok := findTitle(events, "День рождения"); !ok || !bd.AllDay {
		t.Fatalf("событие на весь день: %+v", events)
	}
	if rec := doAs(t, h, tok, "PATCH", "/api/events/"+standup.ID, `{"title":"x"}`); rec.Code != 403 {
		t.Fatalf("правка подписки: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, tok, "DELETE", "/api/events/"+standup.ID, ""); rec.Code != 403 {
		t.Fatalf("удаление из подписки: %d", rec.Code)
	}
	// Подписку нельзя сделать основной — в неё не записать.
	if rec := doAs(t, h, tok, "PATCH", "/api/integrations/"+view.ID, `{"primary":true}`); rec.Code != 400 {
		t.Fatalf("основная подписка: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "POST", "/api/integrations/"+view.ID+"/sync", ""); rec.Code != 200 {
		t.Fatalf("синхронизация по кнопке: %d %s", rec.Code, rec.Body)
	}
	if again := dayEvents(t, h, tok, date); len(again) != len(events) {
		t.Fatalf("повторная синхронизация задублировала: %+v", again)
	}

	// Чужой пользователь подписку не видит и не трогает.
	bob := register(t, h, "bob")
	if items := decode[struct{ Items []integrationView }](t, doAs(t, h, bob, "GET", "/api/integrations", "")).Items; len(items) != 0 {
		t.Fatalf("bob видит чужое: %+v", items)
	}
	if rec := doAs(t, h, bob, "DELETE", "/api/integrations/"+view.ID, ""); rec.Code != 404 {
		t.Fatalf("bob удаляет чужое: %d", rec.Code)
	}

	if rec := doAs(t, h, tok, "DELETE", "/api/integrations/"+view.ID, ""); rec.Code != 204 {
		t.Fatalf("отключение: %d", rec.Code)
	}
	if left := dayEvents(t, h, tok, date); len(left) != 0 {
		t.Fatalf("события отключённого календаря остались: %+v", left)
	}
}

func TestIntegrationsBlockPrivateNetwork(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st, Calendars: CalendarOptions{}})
	tok := register(t, h, "alice")
	rec := doAs(t, h, tok, "POST", "/api/integrations", `{"kind":"ics","url":"http://192.168.0.16:8080/v1/models"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "внутренней сети") {
		t.Fatalf("внутренняя сеть: %d %s", rec.Code, rec.Body)
	}
}

func TestCalDAVIntegrationTwoWay(t *testing.T) {
	d := fakecal.NewDAV(t)
	date, start := tomorrow(9)
	d.Put("m1.ics", "BEGIN:VCALENDAR\r\n"+icsEvent("m1", "Планёрка", start, 60)+"END:VCALENDAR\r\n")
	h, tok := newCalServer(t, CalendarOptions{})

	creds := func(pass string) string {
		return fmt.Sprintf(`{"url":%q,"username":"alice","password":%q}`, d.URL, pass)
	}
	if rec := doAs(t, h, tok, "POST", "/api/integrations/caldav/discover", creds("wrong")); rec.Code != 400 {
		t.Fatalf("неверный пароль: %d %s", rec.Code, rec.Body)
	}
	rec := doAs(t, h, tok, "POST", "/api/integrations/caldav/discover", creds(d.Pass))
	if rec.Code != 200 {
		t.Fatalf("поиск календарей: %d %s", rec.Code, rec.Body)
	}
	cals := decode[struct{ Calendars []calsync.CalendarInfo }](t, rec).Calendars
	if len(cals) != 2 || cals[0].Name != "Работа" {
		t.Fatalf("календари: %+v", cals)
	}

	body := fmt.Sprintf(`{"kind":"caldav","url":%q,"username":"alice","password":%q,"writable":true,"primary":true,"name":"Яндекс"}`, cals[0].URL, d.Pass)
	rec = doAs(t, h, tok, "POST", "/api/integrations", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("подключение: %d %s", rec.Code, rec.Body)
	}
	view := decode[integrationView](t, rec)
	if !view.Primary || !view.Writable || !strings.HasPrefix(view.Account, "alice · ") {
		t.Fatalf("представление: %+v", view)
	}

	meeting, ok := findTitle(dayEvents(t, h, tok, date), "Планёрка")
	if !ok || meeting.ReadOnly || meeting.Start != 540 {
		t.Fatalf("событие CalDAV: %+v", meeting)
	}

	// Правка уходит на сервер календаря.
	rec = doAs(t, h, tok, "PATCH", "/api/events/"+meeting.ID, `{"title":"Планёрка у Глеба","start":660,"end":720}`)
	if rec.Code != 200 {
		t.Fatalf("правка: %d %s", rec.Code, rec.Body)
	}
	if b, _ := d.Body(fakecal.WorkPath + "m1.ics"); !strings.Contains(b, "SUMMARY:Планёрка у Глеба") || !strings.Contains(b, start.Add(2*time.Hour).UTC().Format("T150405Z")) {
		t.Fatalf("на сервере после правки:\n%s", b)
	}

	// Новое событие — сразу в основной календарь.
	rec = doAs(t, h, tok, "POST", "/api/events", fmt.Sprintf(`{"date":%q,"title":"Звонок маме","start":1080,"end":1110}`, date))
	if rec.Code != 201 {
		t.Fatalf("создание: %d %s", rec.Code, rec.Body)
	}
	created := decode[model.Event](t, rec)
	if created.Source != view.ID || created.ExternalID == "" {
		t.Fatalf("событие не ушло в календарь: %+v", created)
	}
	if _, ok := d.Body(created.ExternalID); !ok {
		t.Fatalf("на сервере нет ресурса %s: %v", created.ExternalID, d.Paths())
	}
	// Синхронизация не плодит дубль созданного события и сохраняет его id.
	doAs(t, h, tok, "POST", "/api/integrations/"+view.ID+"/sync", "")
	events := dayEvents(t, h, tok, date)
	if call, ok := findTitle(events, "Звонок маме"); !ok || call.ID != created.ID || len(events) != 2 {
		t.Fatalf("после синхронизации: %+v", events)
	}

	if rec := doAs(t, h, tok, "DELETE", "/api/events/"+created.ID, ""); rec.Code != 204 {
		t.Fatalf("удаление: %d %s", rec.Code, rec.Body)
	}
	if _, ok := d.Body(created.ExternalID); ok {
		t.Fatal("событие осталось на сервере календаря")
	}

	// Сервер календаря недоступен — правка отклоняется с 424, событие не меняется.
	d.Close()
	rec = doAs(t, h, tok, "PATCH", "/api/events/"+meeting.ID, `{"title":"Офлайн-правка"}`)
	if rec.Code != 424 || !strings.Contains(rec.Body.String(), "Яндекс") {
		t.Fatalf("недоступный календарь: %d %s", rec.Code, rec.Body)
	}
	if ev, _ := findTitle(dayEvents(t, h, tok, date), "Офлайн-правка"); ev.ID != "" {
		t.Fatal("локальная копия разошлась с календарём")
	}
	// Новое событие при недоступном календаре сохраняется локально, ошибка — в статусе.
	rec = doAs(t, h, tok, "POST", "/api/events", fmt.Sprintf(`{"date":%q,"title":"Без сети","start":1200,"end":1230}`, date))
	if rec.Code != 201 || decode[model.Event](t, rec).Source != "" {
		t.Fatalf("локальное сохранение: %d %s", rec.Code, rec.Body)
	}
	items := decode[struct{ Items []integrationView }](t, doAs(t, h, tok, "GET", "/api/integrations", "")).Items
	if len(items) != 1 || !strings.Contains(items[0].LastError, "Без сети") {
		t.Fatalf("ошибка в статусе: %+v", items)
	}
}

func TestOAuthGoogleFlow(t *testing.T) {
	o := fakecal.NewOAuth(t)
	date, start := tomorrow(13)
	o.Add("g-lunch", map[string]any{"summary": "Обед",
		"start": map[string]any{"dateTime": start.Format(time.RFC3339)},
		"end":   map[string]any{"dateTime": start.Add(time.Hour).Format(time.RFC3339)}})
	app := &calsync.OAuthApp{ClientID: "id", ClientSecret: "sec", AuthURL: o.URL + "/auth", TokenURL: o.URL + "/token", APIBase: o.URL}
	h, tok := newCalServer(t, CalendarOptions{Google: app, PublicURL: "https://cal.example.com"})

	info := decode[struct {
		Providers map[string]bool
	}](t, doAs(t, h, tok, "GET", "/api/integrations", ""))
	if !info.Providers["google"] || info.Providers["outlook"] {
		t.Fatalf("провайдеры: %+v", info)
	}
	if rec := doAs(t, h, tok, "POST", "/api/integrations/oauth/outlook/start", ""); rec.Code != 404 {
		t.Fatalf("выключенный провайдер: %d", rec.Code)
	}
	rec := doAs(t, h, tok, "POST", "/api/integrations/oauth/google/start", "")
	if rec.Code != 200 {
		t.Fatalf("старт: %d %s", rec.Code, rec.Body)
	}
	authURL, _ := url.Parse(decode[map[string]string](t, rec)["url"])
	if got := authURL.Query().Get("redirect_uri"); got != "https://cal.example.com/api/integrations/oauth/google/callback" {
		t.Fatalf("redirect_uri: %s", got)
	}
	state := authURL.Query().Get("state")
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].Name != oauthCookie {
		t.Fatalf("cookie входа: %+v", cookies)
	}

	callbackWith := func(q string, cs []*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/integrations/oauth/google/callback?"+q, nil)
		for _, c := range cs {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	callback := func(q string) *httptest.ResponseRecorder { return callbackWith(q, cookies) }
	// Тот же state, но из другого браузера (без cookie) — отказ: защита от подмены аккаунта.
	if rec := callbackWith("code=good-code&state="+url.QueryEscape(state), nil); !strings.Contains(rec.Header().Get("Location"), "calendars=error") {
		t.Fatalf("колбэк без cookie: %s", rec.Header().Get("Location"))
	}
	if rec := callback("code=good-code&state=" + url.QueryEscape(state+"x")); !strings.Contains(rec.Header().Get("Location"), "calendars=error") {
		t.Fatalf("подделанный state: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	if rec := callback("error=access_denied&state=" + url.QueryEscape(state)); !strings.Contains(rec.Header().Get("Location"), "calendars=error") {
		t.Fatalf("отказ: %s", rec.Header().Get("Location"))
	}
	rec = callback("code=good-code&state=" + url.QueryEscape(state))
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != "/?calendars=connected" {
		t.Fatalf("колбэк: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	items := decode[struct{ Items []integrationView }](t, doAs(t, h, tok, "GET", "/api/integrations", "")).Items
	if len(items) != 1 || items[0].Kind != model.IntegrationGoogle || items[0].Account != "alice@example.com" || !items[0].Primary {
		t.Fatalf("подключение Google: %+v", items)
	}
	if lunch, ok := findTitle(dayEvents(t, h, tok, date), "Обед"); !ok || lunch.Start != 13*60 || lunch.ReadOnly {
		t.Fatalf("событие Google: %+v", lunch)
	}

	// Повторное подключение того же аккаунта не создаёт дубль.
	rec = doAs(t, h, tok, "POST", "/api/integrations/oauth/google/start", "")
	again, _ := url.Parse(decode[map[string]string](t, rec)["url"])
	callbackWith("code=good-code&state="+url.QueryEscape(again.Query().Get("state")), rec.Result().Cookies())
	if items := decode[struct{ Items []integrationView }](t, doAs(t, h, tok, "GET", "/api/integrations", "")).Items; len(items) != 1 {
		t.Fatalf("дубль подключения: %+v", items)
	}

	// Новое событие уходит в Google.
	rec = doAs(t, h, tok, "POST", "/api/events", fmt.Sprintf(`{"date":%q,"title":"Кино","start":1200,"end":1320}`, date))
	created := decode[model.Event](t, rec)
	if created.Source != items[0].ID || o.Count() != 2 {
		t.Fatalf("событие не ушло в Google: %+v, событий в API %d", created, o.Count())
	}
	if rec := doAs(t, h, tok, "PATCH", "/api/events/"+created.ID, `{"title":"Кино с Глебом"}`); rec.Code != 200 {
		t.Fatalf("правка: %d %s", rec.Code, rec.Body)
	}
	if ev, _ := o.Get(created.ExternalID); ev["summary"] != "Кино с Глебом" {
		t.Fatalf("в Google: %+v", ev)
	}
}

func TestFeedExport(t *testing.T) {
	h, tok := newCalServer(t, CalendarOptions{})
	date, _ := tomorrow(0)
	doAs(t, h, tok, "POST", "/api/events", fmt.Sprintf(`{"date":%q,"title":"Встреча, важная","start":600,"end":660}`, date))
	if path := decode[map[string]string](t, doAs(t, h, tok, "GET", "/api/feed", ""))["path"]; path != "" {
		t.Fatalf("лента выключена по умолчанию: %q", path)
	}
	path := decode[map[string]string](t, doAs(t, h, tok, "POST", "/api/feed", ""))["path"]
	if !strings.HasPrefix(path, "/api/feed/") || !strings.HasSuffix(path, ".ics") {
		t.Fatalf("путь ленты: %q", path)
	}
	rec := do(t, h, "GET", path, "")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/calendar") {
		t.Fatalf("лента: %d %s", rec.Code, rec.Header())
	}
	body := rec.Body.String()
	_, start := tomorrow(10)
	if !strings.Contains(body, `SUMMARY:Встреча\, важная`) || !strings.Contains(body, "DTSTART:"+start.UTC().Format("20060102T150405Z")) {
		t.Fatalf("содержимое ленты:\n%s", body)
	}
	newPath := decode[map[string]string](t, doAs(t, h, tok, "POST", "/api/feed", ""))["path"]
	if newPath == path || do(t, h, "GET", path, "").Code != 404 {
		t.Fatal("старая ссылка должна перестать работать")
	}
	doAs(t, h, tok, "DELETE", "/api/feed", "")
	if do(t, h, "GET", newPath, "").Code != 404 || do(t, h, "GET", "/api/feed/.ics", "").Code != 404 {
		t.Fatal("выключенная лента недоступна")
	}
}

func TestMeTimeZone(t *testing.T) {
	h, tok := newCalServer(t, CalendarOptions{})
	rec := doAs(t, h, tok, "PATCH", "/api/me", `{"timeZone":"Asia/Tokyo"}`)
	if rec.Code != 200 || decode[model.User](t, rec).TimeZone != "Asia/Tokyo" {
		t.Fatalf("пояс: %d %s", rec.Code, rec.Body)
	}
	if u := decode[model.User](t, doAs(t, h, tok, "GET", "/api/me", "")); u.TimeZone != "Asia/Tokyo" {
		t.Fatalf("me: %+v", u)
	}
	for _, bad := range []string{`"Mars/Olympus"`, `"Local"`, `""`} {
		if rec := doAs(t, h, tok, "PATCH", "/api/me", `{"timeZone":`+bad+`}`); rec.Code != 400 {
			t.Fatalf("пояс %s: %d", bad, rec.Code)
		}
	}
	// Другим пользователям пояс не виден.
	bob := register(t, h, "bob")
	if rec := doAs(t, h, bob, "GET", "/api/users?q=alice", ""); strings.Contains(rec.Body.String(), "Tokyo") {
		t.Fatalf("пояс утёк: %s", rec.Body)
	}
}

func TestFreeSlotsIgnoreAllDay(t *testing.T) {
	st, _ := store.Open("")
	s := &server{store: st, cal: newCalendars(CalendarOptions{})}
	u, _ := st.CreateUser(context.Background(), "alice", "Alice", "h")
	ctx := store.WithUser(context.Background(), u)
	_, _ = st.SyncEvents(ctx, "cal-1", []model.Event{{Date: "2026-10-22", Title: "Праздник", Start: 0, End: 1440, AllDay: true, ReadOnly: true, ExternalID: "h", Badge: model.BadgeRoutine}})
	out, _ := s.toolFreeSlots(ctx, chatTurn{now: time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)}, map[string]any{"date": "2026-10-22"})
	if out != `{"free":[{"end":"21:00","start":"08:00"}]}` {
		t.Fatalf("день с праздником свободен: %s", out)
	}
	sched, _ := s.toolDaySchedule(ctx, map[string]any{"date": "2026-10-22"})
	if !strings.Contains(sched, `"all_day":true`) || !strings.Contains(sched, `"read_only":true`) || strings.Contains(sched, `"start"`) {
		t.Fatalf("расписание: %s", sched)
	}
}

func TestBackgroundSync(t *testing.T) {
	_, start := tomorrow(9)
	title, status := "Первая версия", http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		fmt.Fprintf(w, "BEGIN:VCALENDAR\r\n%sEND:VCALENDAR\r\n", icsEvent("bg", title, start, 60))
	}))
	defer srv.Close()
	st, _ := store.Open("")
	s := &server{store: st, cal: newCalendars(CalendarOptions{AllowPrivate: true})}
	u, _ := st.CreateUser(context.Background(), "alice", "Alice", "h")
	ctx := store.WithUser(context.Background(), u)
	in, err := st.SaveIntegration(ctx, model.Integration{Kind: model.IntegrationICS, Name: "Лента", URL: srv.URL, Badge: model.BadgeRoutine})
	if err != nil {
		t.Fatal(err)
	}
	date := start.Format(time.DateOnly)

	// Фоновый проход работает без запроса пользователя: контекст собирается сам.
	s.syncAll(context.Background())
	got := st.EventsOn(ctx, date)
	if len(got) != 1 || got[0].Title != "Первая версия" {
		t.Fatalf("первый проход: %+v", got)
	}
	id := got[0].ID

	title = "Вторая версия"
	s.syncAll(context.Background())
	if got := st.EventsOn(ctx, date); len(got) != 1 || got[0].ID != id || got[0].Title != "Вторая версия" {
		t.Fatalf("второй проход: %+v", got)
	}

	// Сервис упал — события остаются, ошибка видна в статусе.
	status = http.StatusInternalServerError
	s.syncAll(context.Background())
	if got := st.EventsOn(ctx, date); len(got) != 1 {
		t.Fatalf("при ошибке сервиса события пропали: %+v", got)
	}
	if cur, _ := st.Integration(ctx, in.ID); cur.LastError == "" || cur.LastSync.IsZero() {
		t.Fatalf("статус после ошибки: %+v", cur)
	}

	// Цикл останавливается вместе с контекстом сервера.
	loopCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.runSyncLoop(loopCtx, time.Hour); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("фоновый цикл не остановился")
	}
}
