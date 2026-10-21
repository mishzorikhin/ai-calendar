package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func dates(events []model.Event) string {
	var out []string
	for _, e := range events {
		out = append(out, e.Date)
	}
	return strings.Join(out, " ")
}

func TestExpandRepeat(t *testing.T) {
	base := model.Event{ID: "e", Date: "2026-10-20", Title: "x", Start: 600, End: 660, Highlight: true} // вторник
	cases := []struct {
		name     string
		repeat   model.Repeat
		until    string
		exdates  []string
		from, to string
		want     string
	}{
		{"каждый день", model.RepeatDaily, "", nil, "2026-10-19", "2026-10-22", "2026-10-20 2026-10-21 2026-10-22"},
		{"по будням", model.RepeatWeekdays, "", nil, "2026-10-23", "2026-10-27", "2026-10-23 2026-10-26 2026-10-27"},
		{"каждую неделю", model.RepeatWeekly, "", nil, "2026-10-21", "2026-11-10", "2026-10-27 2026-11-03 2026-11-10"},
		{"до даты и без убранных", model.RepeatWeekly, "2026-11-03", []string{"2026-10-27"}, "2026-10-01", "2026-12-01", "2026-10-20 2026-11-03"},
		{"окно до начала серии", model.RepeatDaily, "", nil, "2026-10-01", "2026-10-19", ""},
		{"каждый год", model.RepeatYearly, "", nil, "2027-01-01", "2028-12-31", "2027-10-20 2028-10-20"},
	}
	for _, c := range cases {
		e := base
		e.Repeat, e.RepeatUntil, e.ExDates = c.repeat, c.until, c.exdates
		if got := dates(expandRepeat(e, c.from, c.to)); got != c.want {
			t.Errorf("%s: %q, ожидали %q", c.name, got, c.want)
		}
	}
	// 31-е — только в месяцах, где оно есть; 29 февраля — только в високосные годы.
	e31 := base
	e31.Date, e31.Repeat = "2026-01-31", model.RepeatMonthly
	if got := dates(expandRepeat(e31, "2026-01-01", "2026-05-31")); got != "2026-01-31 2026-03-31 2026-05-31" {
		t.Errorf("31-е: %q", got)
	}
	leap := base
	leap.Date, leap.Repeat = "2024-02-29", model.RepeatYearly
	if got := dates(expandRepeat(leap, "2024-01-01", "2029-01-01")); got != "2024-02-29 2028-02-29" {
		t.Errorf("29 февраля: %q", got)
	}
	// «Новое» — только у первого вхождения; id общий.
	e := base
	e.Repeat = model.RepeatDaily
	occ := expandRepeat(e, "2026-10-20", "2026-10-21")
	if len(occ) != 2 || !occ[0].Highlight || occ[1].Highlight || occ[1].ID != "e" {
		t.Fatalf("вхождения: %+v", occ)
	}
}

func TestRepeatingEventsAPI(t *testing.T) {
	h, token := newAuthedServer(t)
	rec := doAs(t, h, token, "POST", "/api/events",
		`{"date":"2026-10-20","title":"Йога","start":1140,"end":1200,"badge":"sport","repeat":"weekly"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание: %d %s", rec.Code, rec.Body)
	}
	ev := decode[model.Event](t, rec)
	day := func(d string) []model.Event {
		return decode[[]model.Event](t, doAs(t, h, token, "GET", "/api/events?date="+d, ""))
	}
	if got := day("2026-11-03"); len(got) != 1 || got[0].ID != ev.ID || got[0].Date != "2026-11-03" || got[0].Repeat != "weekly" {
		t.Fatalf("вхождение через две недели: %+v", got)
	}
	if got := day("2026-11-04"); len(got) != 0 {
		t.Fatalf("в среду йоги нет: %+v", got)
	}
	dots := decode[map[string][]model.Badge](t, doAs(t, h, token, "GET", "/api/month?year=2026&month=11", ""))
	if len(dots) != 4 || len(dots["3"]) != 1 {
		t.Fatalf("месяц: %+v", dots)
	}

	// Убрать один день; правка вхождения с переносом на день позже сдвигает всю серию.
	if rec := doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, `{"skip":"2026-11-03"}`); rec.Code != http.StatusOK {
		t.Fatalf("убрать день: %d %s", rec.Code, rec.Body)
	}
	if got := day("2026-11-03"); len(got) != 0 {
		t.Fatalf("убранный день: %+v", got)
	}
	rec = doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, `{"occurrence":"2026-11-10","date":"2026-11-11"}`)
	if rec.Code != http.StatusOK || decode[model.Event](t, rec).Date != "2026-10-21" {
		t.Fatalf("сдвиг серии: %d %s", rec.Code, rec.Body)
	}
	if got := day("2026-11-11"); len(got) != 1 {
		t.Fatalf("после сдвига — по средам: %+v", got)
	}

	// Проверки: неизвестный повтор, конец раньше начала, «убрать день» у обычного события.
	for _, body := range []string{
		`{"date":"2026-10-20","title":"x","start":600,"end":660,"repeat":"hourly"}`,
		`{"date":"2026-10-20","title":"x","start":600,"end":660,"repeat":"daily","repeatUntil":"2026-10-01"}`,
		`{"date":"2026-10-20","title":"x","start":600,"end":660,"repeatUntil":"2026-12-01"}`,
	} {
		if rec := doAs(t, h, token, "POST", "/api/events", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	plain := decode[model.Event](t, doAs(t, h, token, "POST", "/api/events", `{"date":"2026-10-20","title":"Разово","start":600,"end":660}`))
	if rec := doAs(t, h, token, "PATCH", "/api/events/"+plain.ID, `{"skip":"2026-10-20"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("skip у обычного: %d", rec.Code)
	}
	// Снять повтор — снова одно событие.
	doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, `{"repeat":""}`)
	if got := day("2026-11-11"); len(got) != 0 {
		t.Fatalf("повтор снят: %+v", got)
	}
}

func TestRepeatNotForExternal(t *testing.T) {
	_, h, st := newPushServer(t)
	token := register(t, h, "alice")
	ctx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	if _, err := st.SyncEvents(ctx, "cal-1", []model.Event{{ExternalID: "x", Date: "2026-10-20", Title: "Чужое", Start: 600, End: 660, Badge: model.BadgeWork}}); err != nil {
		t.Fatal(err)
	}
	ev := st.EventsOn(ctx, "2026-10-20")[0]
	// Подключения нет в хранилище — запись наружу пропускается, но правило повтора всё равно отклоняется.
	if rec := doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, `{"repeat":"daily"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("повтор у внешнего: %d %s", rec.Code, rec.Body)
	}
}

func TestQuietHoursAndBadgeDefaults(t *testing.T) {
	ns := model.DefaultNotifySettings
	ns.QuietFrom, ns.QuietTo = 23*60, 7*60
	for m, want := range map[int]bool{22*60 + 59: false, 23 * 60: true, 0: true, 6*60 + 59: true, 7 * 60: false} {
		if ns.Quiet(m) != want {
			t.Errorf("Quiet(%d) = %v", m, !want)
		}
	}
	day := model.NotifySettings{QuietFrom: 13 * 60, QuietTo: 14 * 60}
	if !day.Quiet(13*60+30) || day.Quiet(12*60) {
		t.Error("тихие часы днём")
	}

	loc, _ := time.LoadLocation("Europe/Moscow")
	at := func(h, m int) time.Time { return time.Date(2026, 10, 20, h, m, 0, 0, loc) }
	ns.BadgeReminders = map[model.Badge]int{model.BadgeSport: 60, model.BadgeWork: -1}
	events := []model.Event{
		{ID: "late", Date: "2026-10-20", Title: "Поздний звонок", Start: 23*60 + 40, End: 1440, Badge: model.BadgeRoutine},             // по умолчанию в 23:30 — тихо
		{ID: "own", Date: "2026-10-20", Title: "Поезд", Start: 23*60 + 40, End: 1440, Badge: model.BadgeRoutine, Reminders: []int{10}}, // явно — придёт
		{ID: "sport", Date: "2026-10-20", Title: "Бег", Start: 19 * 60, End: 20 * 60, Badge: model.BadgeSport},                         // за час — 18:00
		{ID: "work", Date: "2026-10-20", Title: "Созвон", Start: 18 * 60, End: 19 * 60, Badge: model.BadgeWork},                        // не напоминать
	}
	keys := func(rs []reminder) string {
		var out []string
		for _, r := range rs {
			out = append(out, r.key)
		}
		return strings.Join(out, " ")
	}
	if got := keys(planReminders(loc, ns, events, nil, at(23, 25), at(23, 35))); got != "event:own:2026-10-20:1420:10" {
		t.Fatalf("тихие часы: %q", got)
	}
	if got := keys(planReminders(loc, ns, events, nil, at(17, 45), at(18, 5))); got != "event:sport:2026-10-20:1140:60" {
		t.Fatalf("по типу события: %q", got)
	}
	// Задача в тихие часы не приходит.
	ns.TaskTime = 23*60 + 30
	if got := keys(planReminders(loc, ns, nil, []model.Task{{ID: "t", Title: "x", Due: "2026-10-20"}}, at(23, 25), at(23, 35))); got != "" {
		t.Fatalf("задача в тихие часы: %q", got)
	}
}

func TestEveningDigestAndBadgeCount(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	at := func(d, h int) time.Time { return time.Date(2026, 10, d, h, 0, 0, 0, loc) }
	ns := model.NotifySettings{EventReminder: -1, TaskTime: -1, Digest: 8 * 60, Evening: 20 * 60, QuietFrom: -1, QuietTo: -1}
	events := []model.Event{
		{ID: "a", Date: "2026-10-21", Title: "Завтрак", Start: 9 * 60, End: 10 * 60},
		{ID: "b", Date: "2026-10-20", Title: "Обед", Start: 13 * 60, End: 14 * 60},
		{ID: "c", Date: "2026-10-20", Title: "Ужин", Start: 19 * 60, End: 20 * 60},
	}
	tasks := []model.Task{
		{ID: "old", Title: "Старое", Due: "2026-10-18"},
		{ID: "tom", Title: "Завтра", Due: "2026-10-21"},
		{ID: "done", Title: "Готово", Due: "2026-10-19", Done: true},
	}
	got := planReminders(loc, ns, events, tasks, at(20, 7).Add(59*time.Minute), at(20, 8))
	if len(got) != 1 || got[0].msg.Body != "2 встречи, первая в 13:00 — Обед. Просрочено: 1 задача" {
		t.Fatalf("утро: %+v", got)
	}
	// Число на иконке в 8:00: две встречи впереди и одна просроченная задача.
	if got[0].msg.Badge == nil || *got[0].msg.Badge != 3 {
		t.Fatalf("число на иконке: %v", got[0].msg.Badge)
	}
	got = planReminders(loc, ns, events, tasks, at(20, 19).Add(59*time.Minute), at(20, 20))
	if len(got) != 1 || got[0].key != "evening:2026-10-20" || got[0].msg.Title != "План на завтра" ||
		got[0].msg.Body != "В 9:00 — Завтрак. 1 задача со сроком завтра" || got[0].msg.URL != "/#day/2026-10-21" {
		t.Fatalf("вечер: %+v", got)
	}
}

func TestAlarmsAPI(t *testing.T) {
	s, h, _ := newPushServer(t)
	token := register(t, h, "alice")
	dev := newFakeDevice(t)
	doAs(t, h, token, "POST", "/api/push/subscriptions", dev.subscription("/a"))
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	s.cal.now = func() time.Time { return now }

	for _, body := range []string{
		`{"text":"","at":"2026-10-20T13:00:00Z"}`,
		`{"text":"Позвонить","at":"2026-10-20T10:00:00Z"}`,
		`{"text":"Позвонить","at":"2028-10-20T10:00:00Z"}`,
		`{"text":"Позвонить"}`,
	} {
		if rec := doAs(t, h, token, "POST", "/api/reminders", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", body, rec.Code, rec.Body)
		}
	}
	rec := doAs(t, h, token, "POST", "/api/reminders", `{"text":"Позвонить маме","at":"2026-10-20T15:00:00Z"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание: %d %s", rec.Code, rec.Body)
	}
	created := decode[alarmView](t, rec)
	other := decode[alarmView](t, doAs(t, h, token, "POST", "/api/reminders", `{"text":"Купить хлеб","at":"2026-10-20T14:00:00Z"}`))
	list := decode[[]alarmView](t, doAs(t, h, token, "GET", "/api/reminders", ""))
	if len(list) != 2 || list[0].Text != "Купить хлеб" || list[1].Kind != model.PushReminder {
		t.Fatalf("список: %+v", list)
	}
	bob := register(t, h, "bob")
	if rec := doAs(t, h, bob, "DELETE", fmt.Sprintf("/api/reminders/%d", created.ID), ""); rec.Code != http.StatusNotFound {
		t.Fatalf("чужое: %d", rec.Code)
	}
	if rec := doAs(t, h, token, "DELETE", fmt.Sprintf("/api/reminders/%d", other.ID), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("отмена: %d", rec.Code)
	}
	// Приходит в своё время, даже в тихие часы.
	doAs(t, h, token, "PATCH", "/api/push/settings", `{"quietFrom":0,"quietTo":1439}`)
	s.remindAll(context.Background(), now.Add(2*time.Hour))
	if len(dev.messages()) != 0 {
		t.Fatalf("рано: %+v", dev.messages())
	}
	s.remindAll(context.Background(), now.Add(3*time.Hour))
	got := dev.messages()
	if len(got) != 1 || got[0].Kind != model.PushReminder || got[0].Title != "Позвонить маме" || !strings.HasPrefix(got[0].Tag, "reminder:") {
		t.Fatalf("напоминание: %+v", got)
	}
	if list := decode[[]alarmView](t, doAs(t, h, token, "GET", "/api/reminders", "")); len(list) != 0 {
		t.Fatalf("после отправки: %+v", list)
	}
}

func TestDevicesAPI(t *testing.T) {
	_, h, _ := newPushServer(t)
	token := register(t, h, "alice")
	dev := newFakeDevice(t)
	req := func(method, path, body, ua string) int {
		r := doAsUA(t, h, token, method, path, body, ua)
		return r.Code
	}
	if code := req("POST", "/api/push/subscriptions", dev.subscription("/phone"),
		"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"); code != http.StatusNoContent {
		t.Fatalf("подписка: %d", code)
	}
	req("POST", "/api/push/subscriptions", dev.subscription("/mac"),
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")
	list := decode[[]deviceView](t, doAs(t, h, token, "GET", "/api/push/devices", ""))
	if len(list) != 2 || list[0].Label != "Chrome · Android" || list[1].Label != "Safari · Mac" || list[0].ID != deviceID(dev.srv.URL+"/phone") {
		t.Fatalf("устройства: %+v", list)
	}
	if strings.Contains(fmt.Sprint(list), dev.srv.URL) {
		t.Fatal("адрес подписки не должен уходить в ответ")
	}
	if code := req("DELETE", "/api/push/devices/"+list[1].ID, "", ""); code != http.StatusNoContent {
		t.Fatalf("удаление: %d", code)
	}
	if code := req("DELETE", "/api/push/devices/"+list[1].ID, "", ""); code != http.StatusNotFound {
		t.Fatalf("повторное удаление: %d", code)
	}
	if list := decode[[]deviceView](t, doAs(t, h, token, "GET", "/api/push/devices", "")); len(list) != 1 {
		t.Fatalf("после удаления: %+v", list)
	}
	for ua, want := range map[string]string{
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1": "Safari · iPhone",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0":                   "Edge · Windows",
		"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0":                                                                  "Firefox · Linux",
		"": "Устройство",
	} {
		if got := deviceLabel(ua); got != want {
			t.Errorf("%q: %q", ua, got)
		}
	}
}

func TestNotifySettingsExtra(t *testing.T) {
	h, token := newAuthedServer(t)
	for _, body := range []string{
		`{"quietFrom":1380}`,
		`{"evening":1440}`,
		`{"badgeReminders":{"party":10}}`,
		`{"badgeReminders":{"sport":-2}}`,
	} {
		if rec := doAs(t, h, token, "PATCH", "/api/push/settings", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	rec := doAs(t, h, token, "PATCH", "/api/push/settings", `{"quietFrom":1380,"quietTo":420,"evening":1200,"badgeReminders":{"sport":60}}`)
	ns := decode[model.NotifySettings](t, rec)
	if ns.QuietFrom != 1380 || ns.QuietTo != 420 || ns.Evening != 1200 || ns.BadgeReminders[model.BadgeSport] != 60 {
		t.Fatalf("настройки: %s", rec.Body)
	}
	ns = decode[model.NotifySettings](t, doAs(t, h, token, "PATCH", "/api/push/settings", `{"badgeReminders":{},"quietFrom":-1,"quietTo":-1}`))
	if ns.BadgeReminders != nil || ns.QuietFrom != -1 {
		t.Fatalf("сброс: %+v", ns)
	}
}

func TestTaskChangeNotifications(t *testing.T) {
	_, h, _ := newPushServer(t)
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	dev := newFakeDevice(t)
	doAs(t, h, alice, "POST", "/api/push/subscriptions", dev.subscription("/alice"))
	task := decode[model.Task](t, doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Купить торт","kind":"task","members":["bob"]}`))

	// Bob отметил задачу — alice узнаёт; сам bob уведомления о своей правке не получает.
	if rec := doAs(t, h, bob, "PATCH", "/api/tasks/"+task.ID, `{"done":true}`); rec.Code != http.StatusOK {
		t.Fatalf("галочка: %d %s", rec.Code, rec.Body)
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(dev.messages()) == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if got := dev.messages(); len(got) != 1 || got[0].Body != "Задача выполнена · bob" {
		t.Fatalf("push: %+v", got)
	}
	notes := decode[[]model.Notification](t, doAs(t, h, alice, "GET", "/api/notifications", ""))
	if len(notes) == 0 || notes[0].Text != "Готово: «Купить торт»" || notes[0].From == nil || notes[0].From.Username != "bob" {
		t.Fatalf("уведомления alice: %+v", notes)
	}
	bobNotes := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", ""))
	for _, n := range bobNotes {
		if strings.HasPrefix(n.Text, "Готово") {
			t.Fatalf("bob получил уведомление о своей правке: %+v", n)
		}
	}
	// Заметка без смены названия и срока — без уведомления.
	doAs(t, h, alice, "PATCH", "/api/tasks/"+task.ID, `{"subtitle":"шоколадный"}`)
	if n := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", "")); len(n) != len(bobNotes) {
		t.Fatalf("лишнее уведомление: %+v", n)
	}
}

func TestChatReminderAndRepeatTools(t *testing.T) {
	st, _ := store.Open("")
	s := &server{store: st, cal: newCalendars(CalendarOptions{})}
	h := New(Options{Store: st})
	register(t, h, "alice")
	ctx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	loc, _ := time.LoadLocation("Europe/Moscow")
	turn := chatTurn{now: time.Now().In(loc)}

	out, _ := s.toolCreateReminder(ctx, turn, map[string]any{"text": "Позвонить маме", "in_minutes": float64(20)})
	if !strings.Contains(out, `"ok":true`) {
		t.Fatalf("через 20 минут: %s", out)
	}
	tomorrow := turn.now.AddDate(0, 0, 1).Format(time.DateOnly)
	out, _ = s.toolCreateReminder(ctx, turn, map[string]any{"text": "Врач", "date": tomorrow, "time": "09:30"})
	if !strings.Contains(out, `"time":"09:30"`) {
		t.Fatalf("на завтра: %s", out)
	}
	if out, _ := s.toolCreateReminder(ctx, turn, map[string]any{"text": "x"}); !strings.Contains(out, "error") {
		t.Fatalf("без времени: %s", out)
	}
	if out, _ := s.toolListReminders(ctx, turn); strings.Count(out, `"text"`) != 2 {
		t.Fatalf("список: %s", out)
	}

	out, _ = s.toolCreateEvent(ctx, map[string]any{"date": "2026-10-20", "title": "Планёрка", "start": "10:00", "end": "10:30", "repeat": "weekdays"})
	if !strings.Contains(out, `"repeat":"weekdays"`) {
		t.Fatalf("повтор: %s", out)
	}
	if out, _ := s.toolCreateEvent(ctx, map[string]any{"date": "2026-10-20", "title": "x", "start": "10:00", "end": "10:30", "repeat": "hourly"}); !strings.Contains(out, "error") {
		t.Fatalf("неверный повтор: %s", out)
	}
	if got := s.eventsOn(ctx, time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)); len(got) != 1 || got[0].Title != "Планёрка" {
		t.Fatalf("пятница: %+v", got)
	}
}

// doAsUA — запрос с токеном и своим User-Agent.
func doAsUA(t *testing.T, h http.Handler, token, method, path, body, ua string) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Authorization", "Bearer "+token)
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}
