package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

var b64 = base64.RawURLEncoding

// fakeDevice — браузер с подпиской и сервис доставки, который складывает полученное.
type fakeDevice struct {
	ua     *ecdh.PrivateKey
	auth   []byte
	srv    *httptest.Server
	status int

	mu  sync.Mutex
	got []model.PushMessage
	hdr []http.Header
}

func newFakeDevice(t *testing.T) *fakeDevice {
	t.Helper()
	ua, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	d := &fakeDevice{ua: ua, auth: []byte("fedcba9876543210"), status: http.StatusCreated}
	d.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.status == http.StatusCreated {
			var m model.PushMessage
			if err := json.Unmarshal(d.decrypt(t, body), &m); err != nil {
				t.Errorf("содержимое: %v", err)
			}
			d.got = append(d.got, m)
			d.hdr = append(d.hdr, r.Header.Clone())
		}
		w.WriteHeader(d.status)
	}))
	t.Cleanup(d.srv.Close)
	return d
}

func (d *fakeDevice) subscription(path string) string {
	return fmt.Sprintf(`{"endpoint":%q,"expirationTime":null,"keys":{"p256dh":%q,"auth":%q}}`,
		d.srv.URL+path, b64.EncodeToString(d.ua.PublicKey().Bytes()), b64.EncodeToString(d.auth))
}

func (d *fakeDevice) messages() []model.PushMessage {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]model.PushMessage(nil), d.got...)
}

// decrypt — расшифровка aes128gcm на стороне браузера (RFC 8291).
func (d *fakeDevice) decrypt(t *testing.T, body []byte) []byte {
	salt, idlen := body[:16], int(body[20])
	as, err := ecdh.P256().NewPublicKey(body[21 : 21+idlen])
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := d.ua.ECDH(as)
	info := append(append([]byte("WebPush: info\x00"), d.ua.PublicKey().Bytes()...), as.Bytes()...)
	ikm, _ := hkdf.Key(sha256.New, shared, d.auth, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[21+idlen:], nil)
	if err != nil {
		t.Fatalf("расшифровка: %v", err)
	}
	return plain[:len(plain)-1]
}

// newPushServer — сервер, которому разрешены http-адреса подписок (фейковый сервис доставки).
func newPushServer(t *testing.T) (*server, http.Handler, store.Store) {
	t.Helper()
	st, err := store.Open("")
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{
		Store:     st,
		Calendars: CalendarOptions{AllowPrivate: true, DefaultTimeZone: "Europe/Moscow"},
		Push:      PushOptions{Doer: webpush.HTTPDoer{}},
	}
	s := newServer(opts)
	return s, s.handler(opts), st
}

func TestPushAPI(t *testing.T) {
	_, h, _ := newPushServer(t)
	token := register(t, h, "alice")
	dev := newFakeDevice(t)

	rec := doAs(t, h, token, "GET", "/api/push", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/push: %d %s", rec.Code, rec.Body)
	}
	view := decode[pushView](t, rec)
	if key, err := b64.DecodeString(view.PublicKey); err != nil || len(key) != 65 {
		t.Fatalf("открытый ключ: %q", view.PublicKey)
	}
	if !reflect.DeepEqual(view.Settings, model.DefaultNotifySettings) || view.Devices != 0 {
		t.Fatalf("начальное состояние: %+v", view)
	}
	// Ключ один и тот же между запросами.
	if again := decode[pushView](t, doAs(t, h, token, "GET", "/api/push", "")); again.PublicKey != view.PublicKey {
		t.Fatal("ключ VAPID сменился")
	}
	if rec := do(t, h, "GET", "/api/push", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("без входа: %d", rec.Code)
	}

	// Подписка: проверка адреса и ключей.
	bad := []string{
		`{"endpoint":"","keys":{"p256dh":"x","auth":"y"}}`,
		`{"endpoint":"ftp://push.example/1","keys":{"p256dh":"x","auth":"y"}}`,
		`{"endpoint":"https://user:pass@push.example/1","keys":{"p256dh":"x","auth":"y"}}`,
		strings.Replace(dev.subscription("/a"), `"auth":"`, `"auth":"x`, 1),
		`{"endpoint":"https://push.example/1","keys":{"p256dh":"BAAA","auth":"AAAAAAAAAAAAAAAAAAAAAA"}}`,
		`{"endpoint":"https://push.example/1","unknown":1}`,
	}
	for i, body := range bad {
		if rec := doAs(t, h, token, "POST", "/api/push/subscriptions", body); rec.Code != http.StatusBadRequest {
			t.Errorf("случай %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	if rec := doAs(t, h, token, "POST", "/api/push/subscriptions", dev.subscription("/a")); rec.Code != http.StatusNoContent {
		t.Fatalf("подписка: %d %s", rec.Code, rec.Body)
	}
	if v := decode[pushView](t, doAs(t, h, token, "GET", "/api/push", "")); v.Devices != 1 {
		t.Fatalf("устройств: %d", v.Devices)
	}

	// Настройки: частичная правка и проверка границ.
	rec = doAs(t, h, token, "PATCH", "/api/push/settings", `{"digest":480}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("настройки: %d %s", rec.Code, rec.Body)
	}
	if ns := decode[model.NotifySettings](t, rec); ns.Digest != 480 || ns.EventReminder != 10 || ns.TaskTime != 540 {
		t.Fatalf("настройки: %+v", ns)
	}
	for _, body := range []string{`{"digest":1440}`, `{"taskTime":-2}`, `{"eventReminder":20000}`, `{"eventReminder":-5}`} {
		if rec := doAs(t, h, token, "PATCH", "/api/push/settings", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	if rec := doAs(t, h, token, "PATCH", "/api/push/settings", `{"eventReminder":-1,"taskTime":-1}`); rec.Code != http.StatusOK {
		t.Fatalf("выключить: %d %s", rec.Code, rec.Body)
	}

	// Проверка доставки: уведомление дошло и расшифровалось.
	rec = doAs(t, h, token, "POST", "/api/push/test", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"sent":1`) {
		t.Fatalf("проверка: %d %s", rec.Code, rec.Body)
	}
	if got := dev.messages(); len(got) != 1 || got[0].Kind != model.PushTest || got[0].Title != "Уведомления работают" {
		t.Fatalf("получено: %+v", got)
	}
	if hdr := dev.hdr[0]; !strings.HasPrefix(hdr.Get("Authorization"), "vapid t=") || hdr.Get("Urgency") != "high" {
		t.Fatalf("заголовки: %v", hdr)
	}

	// Отложить: проверка полей.
	snoozeBad := []string{
		`{"minutes":0,"message":{"kind":"event","title":"x"}}`,
		`{"minutes":2000,"message":{"kind":"event","title":"x"}}`,
		`{"minutes":10,"message":{"kind":"spam","title":"x"}}`,
		`{"minutes":10,"message":{"kind":"event","title":" "}}`,
		`{"minutes":10,"message":{"kind":"event","title":"x","url":"https://evil.example"}}`,
		`{"minutes":10,"message":{"kind":"event","title":"x","url":"//evil.example"}}`,
	}
	for _, body := range snoozeBad {
		if rec := doAs(t, h, token, "POST", "/api/push/snooze", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	if rec := doAs(t, h, token, "POST", "/api/push/snooze",
		`{"minutes":10,"message":{"kind":"event","title":"Звонок","url":"/#day/2026-10-20","tag":"event:evt-1"}}`); rec.Code != http.StatusNoContent {
		t.Fatalf("отложить: %d %s", rec.Code, rec.Body)
	}

	// Отписка: чужой токен не трогает, свой — удаляет; сервис ответил 410 — подписка забывается.
	other := register(t, h, "bob")
	unsub := fmt.Sprintf(`{"endpoint":%q}`, dev.srv.URL+"/a")
	if rec := doAs(t, h, other, "DELETE", "/api/push/subscriptions", unsub); rec.Code != http.StatusNoContent {
		t.Fatalf("чужая отписка: %d", rec.Code)
	}
	if v := decode[pushView](t, doAs(t, h, token, "GET", "/api/push", "")); v.Devices != 1 {
		t.Fatal("bob отписал устройство alice")
	}
	if rec := doAs(t, h, token, "DELETE", "/api/push/subscriptions", unsub); rec.Code != http.StatusNoContent {
		t.Fatalf("отписка: %d", rec.Code)
	}
	if rec := doAs(t, h, token, "POST", "/api/push/test", ""); rec.Code != http.StatusConflict {
		t.Fatalf("проверка без устройств: %d", rec.Code)
	}
	doAs(t, h, token, "POST", "/api/push/subscriptions", dev.subscription("/b"))
	dev.mu.Lock()
	dev.status = http.StatusGone
	dev.mu.Unlock()
	if rec := doAs(t, h, token, "POST", "/api/push/test", ""); rec.Code != http.StatusConflict {
		t.Fatalf("410: %d %s", rec.Code, rec.Body)
	}
	if v := decode[pushView](t, doAs(t, h, token, "GET", "/api/push", "")); v.Devices != 0 {
		t.Fatal("подписка с ответом 410 должна удалиться")
	}
}

func TestPushRequiresHTTPS(t *testing.T) {
	h, token := newAuthedServer(t)
	dev := newFakeDevice(t) // http://127.0.0.1 — без AllowPrivate не принимается
	if rec := doAs(t, h, token, "POST", "/api/push/subscriptions", dev.subscription("/a")); rec.Code != http.StatusBadRequest {
		t.Fatalf("http-адрес: %d", rec.Code)
	}
}

func TestEventRemindersAPI(t *testing.T) {
	h, token := newAuthedServer(t)
	create := func(body string) *httptest.ResponseRecorder {
		return doAs(t, h, token, "POST", "/api/events", body)
	}
	rec := create(`{"date":"2026-10-20","title":"Звонок","start":600,"end":660}`)
	ev := decode[model.Event](t, rec)
	if ev.Reminders != nil || !strings.Contains(rec.Body.String(), `"reminders":null`) {
		t.Fatalf("по умолчанию: %s", rec.Body)
	}
	rec = create(`{"date":"2026-10-20","title":"Обед","start":720,"end":780,"reminders":[10,60,10]}`)
	if got := decode[model.Event](t, rec); fmt.Sprint(got.Reminders) != "[60 10]" {
		t.Fatalf("упорядочены и без повторов: %s", rec.Body)
	}
	for _, body := range []string{
		`{"date":"2026-10-20","title":"x","start":600,"end":660,"reminders":[-1]}`,
		`{"date":"2026-10-20","title":"x","start":600,"end":660,"reminders":[10081]}`,
		`{"date":"2026-10-20","title":"x","start":600,"end":660,"reminders":[1,2,3,4]}`,
	} {
		if rec := create(body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	patch := func(body string) *httptest.ResponseRecorder {
		return doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, body)
	}
	if got := decode[model.Event](t, patch(`{"reminders":[]}`)); got.Reminders == nil || len(got.Reminders) != 0 {
		t.Fatalf("без напоминаний: %+v", got.Reminders)
	}
	if got := decode[model.Event](t, patch(`{"title":"Звонок маме"}`)); got.Reminders == nil {
		t.Fatal("правка названия не должна сбрасывать напоминания")
	}
	if got := decode[model.Event](t, patch(`{"reminders":null}`)); got.Reminders != nil {
		t.Fatalf("null — по умолчанию: %+v", got.Reminders)
	}
	if rec := patch(`{"reminders":"soon"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("неверный тип: %d", rec.Code)
	}
}

func TestReminderOnReadOnlyEvent(t *testing.T) {
	s, h, st := newPushServer(t)
	token := register(t, h, "alice")
	u, _ := st.UserByUsername(context.Background(), "alice")
	ctx := store.WithUser(context.Background(), u)
	if _, err := st.SyncEvents(ctx, "cal-1", []model.Event{{
		ExternalID: "x1", Date: "2026-10-20", Title: "Из подписки", Start: 600, End: 660, Badge: model.BadgeWork, ReadOnly: true,
	}}); err != nil {
		t.Fatal(err)
	}
	ev := st.EventsOn(ctx, "2026-10-20")[0]
	if rec := doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, `{"title":"нельзя"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("правка события только для чтения: %d", rec.Code)
	}
	rec := doAs(t, h, token, "PATCH", "/api/events/"+ev.ID, `{"reminders":[30]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("напоминание у события только для чтения: %d %s", rec.Code, rec.Body)
	}
	// Синхронизация не стирает напоминание.
	if _, err := st.SyncEvents(ctx, "cal-1", []model.Event{{
		ExternalID: "x1", Date: "2026-10-20", Title: "Новое название", Start: 600, End: 660, Badge: model.BadgeWork, ReadOnly: true,
	}}); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.Event(ctx, ev.ID); fmt.Sprint(got.Reminders) != "[30]" || got.Title != "Новое название" {
		t.Fatalf("после синхронизации: %+v", got)
	}
	_ = s
}

func TestPlanReminders(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Moscow")
	at := func(date string, h, m int) time.Time {
		d, _ := time.Parse(time.DateOnly, date)
		return time.Date(d.Year(), d.Month(), d.Day(), h, m, 0, 0, loc)
	}
	ns := model.NotifySettings{EventReminder: 10, TaskTime: 9 * 60, Digest: 8 * 60}
	events := []model.Event{
		{ID: "e1", Date: "2026-10-20", Title: "Звонок", Start: 10 * 60, End: 11 * 60, Subtitle: "Zoom"},         // по умолчанию: 9:50
		{ID: "e2", Date: "2026-10-20", Title: "Тихо", Start: 10 * 60, End: 11 * 60, Reminders: []int{}},         // без напоминаний
		{ID: "e3", Date: "2026-10-21", Title: "Завтра", Start: 9*60 + 50, End: 11 * 60, Reminders: []int{1440}}, // за сутки: 20-го в 9:50
		{ID: "e4", Date: "2026-10-20", Title: "Весь день", AllDay: true, Start: 0, End: 1440},
		{ID: "e5", Date: "2026-10-20", Title: "Обед", Start: 13 * 60, End: 14 * 60, Reminders: []int{60, 0}},
	}
	tasks := []model.Task{
		{ID: "t1", Title: "Отчёт", Kind: model.TaskKindTask, Due: "2026-10-20"},
		{ID: "t2", Title: "Готово", Kind: model.TaskKindTask, Due: "2026-10-20", Done: true},
		{ID: "t3", Title: "Без срока", Kind: model.TaskKindTask},
	}
	keys := func(rs []reminder) []string {
		var out []string
		for _, r := range rs {
			out = append(out, r.key)
		}
		return out
	}

	// 9:45–9:55: напоминание о звонке и о «Завтра» за сутки.
	got := planReminders(loc, ns, events, tasks, at("2026-10-20", 9, 45), at("2026-10-20", 9, 55))
	if fmt.Sprint(keys(got)) != "[event:e1:2026-10-20:600:10 event:e3:2026-10-21:590:1440]" {
		t.Fatalf("9:50: %v", keys(got))
	}
	if m := got[0].msg; m.Title != "Звонок" || m.Body != "Через 10 минут · 10:00–11:00 · Zoom" || m.URL != "/#day/2026-10-20" || m.Tag != "event:e1" {
		t.Fatalf("сообщение: %+v", m)
	}
	if got[1].msg.Body != "Через 1 день · 9:50–11:00" {
		t.Fatalf("за сутки: %q", got[1].msg.Body)
	}
	// Граница окна: (from, to] — ровно в from не входит, ровно в to — входит.
	if got := planReminders(loc, ns, events, nil, at("2026-10-20", 9, 50), at("2026-10-20", 9, 51)); len(got) != 0 {
		t.Fatalf("левая граница: %v", keys(got))
	}
	// Задача в 9:00 и сводка в 8:00.
	got = planReminders(loc, ns, events, tasks, at("2026-10-20", 7, 55), at("2026-10-20", 9, 0))
	if fmt.Sprint(keys(got)) != "[digest:2026-10-20 task:t1:2026-10-20:540]" {
		t.Fatalf("утро: %v", keys(got))
	}
	if d := got[0].msg; d.Body != "3 встречи, первая в 10:00 — Звонок. 1 событие на весь день. 1 задача со сроком сегодня" {
		t.Fatalf("сводка: %q", d.Body)
	}
	if task := got[1].msg; task.TaskID != "t1" || task.Kind != model.PushTask || task.Body != "Срок сегодня" {
		t.Fatalf("задача: %+v", task)
	}
	// Несколько напоминаний одного события; «в момент начала».
	got = planReminders(loc, ns, events, nil, at("2026-10-20", 11, 59), at("2026-10-20", 13, 0))
	if fmt.Sprint(keys(got)) != "[event:e5:2026-10-20:780:60 event:e5:2026-10-20:780:0]" || got[1].msg.Body != "Сейчас · 13:00–14:00" {
		t.Fatalf("обед: %v", got)
	}
	// Всё выключено.
	off := model.NotifySettings{EventReminder: -1, TaskTime: -1, Digest: -1}
	got = planReminders(loc, off, events, tasks, at("2026-10-20", 0, 0), at("2026-10-21", 0, 0))
	if fmt.Sprint(keys(got)) != "[event:e3:2026-10-21:590:1440 event:e5:2026-10-20:780:60 event:e5:2026-10-20:780:0]" {
		t.Fatalf("выключено (свои напоминания событий остаются): %v", keys(got))
	}
	// Пустой день — без сводки.
	if got := planReminders(loc, ns, nil, nil, at("2026-10-22", 7, 59), at("2026-10-22", 8, 0)); len(got) != 0 {
		t.Fatalf("пустой день: %v", keys(got))
	}
}

func TestPlanRemindersDST(t *testing.T) {
	// В Берлине 25 октября 2026 часы переводят назад: 10:00 по настенным часам — 09:00 UTC.
	loc, _ := time.LoadLocation("Europe/Berlin")
	ev := model.Event{ID: "e1", Date: "2026-10-25", Title: "Бранч", Start: 10 * 60, End: 11 * 60, Reminders: []int{0}}
	want := time.Date(2026, 10, 25, 9, 0, 0, 0, time.UTC)
	got := planReminders(loc, model.DefaultNotifySettings, []model.Event{ev}, nil, want.Add(-time.Minute), want)
	if len(got) != 1 || !got[0].at.Equal(want) {
		t.Fatalf("после перевода часов: %+v", got)
	}
}

func TestPlural(t *testing.T) {
	for n, want := range map[int]string{1: "1 минуту", 2: "2 минуты", 5: "5 минут", 11: "11 минут", 21: "21 минуту", 22: "22 минуты", 112: "112 минут"} {
		if got := plural(n, "минуту", "минуты", "минут"); got != want {
			t.Errorf("%d: %q", n, got)
		}
	}
}

func TestRemindAll(t *testing.T) {
	s, h, st := newPushServer(t)
	token := register(t, h, "alice")
	dev := newFakeDevice(t)
	doAs(t, h, token, "POST", "/api/push/subscriptions", dev.subscription("/a"))
	// Пользователь без подписок ничего не получает и не мешает остальным.
	register(t, h, "bob")

	loc, _ := time.LoadLocation("Europe/Moscow")
	now := time.Date(2026, 10, 20, 9, 50, 0, 0, loc)
	s.cal.now = func() time.Time { return now }
	doAs(t, h, token, "POST", "/api/events", `{"date":"2026-10-20","title":"Звонок","start":600,"end":660}`)
	doAs(t, h, token, "POST", "/api/events", `{"date":"2026-10-20","title":"Тихо","start":600,"end":660,"reminders":[]}`)
	// Отложенное из уведомления: придёт через 10 минут.
	doAs(t, h, token, "POST", "/api/push/snooze", `{"minutes":10,"message":{"kind":"task","title":"Отчёт","taskId":"tsk-1"}}`)

	ctx := context.Background()
	s.remindAll(ctx, now)
	got := dev.messages()
	if len(got) != 1 || got[0].Title != "Звонок" || got[0].Body != "Через 10 минут · 10:00–11:00" {
		t.Fatalf("напоминание: %+v", got)
	}
	// Повторный проход не дублирует.
	s.remindAll(ctx, now.Add(30*time.Second))
	if len(dev.messages()) != 1 {
		t.Fatalf("повтор: %+v", dev.messages())
	}
	// Перенесли встречу — напоминание придёт заново к новому времени.
	ev := st.EventsOn(store.WithUser(ctx, mustUser(t, st, "alice")), "2026-10-20")
	for _, e := range ev {
		if e.Title == "Звонок" {
			doAs(t, h, token, "PATCH", "/api/events/"+e.ID, `{"start":620,"end":680}`)
		}
	}
	s.remindAll(ctx, now.Add(10*time.Minute)) // отложенное
	s.remindAll(ctx, now.Add(20*time.Minute)) // 10:10 — за 10 минут до новой встречи
	got = dev.messages()
	if len(got) != 3 || got[1].Title != "Отчёт" || got[2].Body != "Через 10 минут · 10:20–11:20" {
		t.Fatalf("после переноса и отложенного: %+v", got)
	}
	// Ответ 404 от сервиса доставки — подписка забыта.
	dev.mu.Lock()
	dev.status = http.StatusNotFound
	dev.mu.Unlock()
	if _, err := s.pushTo(store.WithUser(ctx, mustUser(t, st, "alice")), model.PushMessage{Kind: model.PushTest, Title: "x"}, pushOpts{}); err != nil {
		t.Fatal(err)
	}
	if ids := st.PushUserIDs(ctx); len(ids) != 0 {
		t.Fatalf("подписки после 404: %v", ids)
	}
}

func TestSharePush(t *testing.T) {
	_, h, _ := newPushServer(t)
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	dev := newFakeDevice(t)
	doAs(t, h, bob, "POST", "/api/push/subscriptions", dev.subscription("/bob"))
	rec := doAs(t, h, alice, "POST", "/api/tasks", `{"title":"Купить торт","kind":"task","members":["bob"]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("задача: %d %s", rec.Code, rec.Body)
	}
	// Уведомление уходит в фоне — ждём его.
	deadline := time.Now().Add(5 * time.Second)
	for len(dev.messages()) == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	got := dev.messages()
	if len(got) != 1 || got[0].Kind != model.PushShare || got[0].Title != "Купить торт" || got[0].Body != "Общая задача от alice" {
		t.Fatalf("уведомление о задаче: %+v", got)
	}
}

func mustUser(t *testing.T, st store.Store, username string) model.User {
	t.Helper()
	u, err := st.UserByUsername(context.Background(), username)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestChatReminderTools(t *testing.T) {
	st, _ := store.Open("")
	// Модель создаёт событие с напоминанием за час, затем выключает напоминания, затем отвечает.
	llmc, _ := fakeChatLLM(t, [][]string{
		{`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"create_event","arguments":"{\"date\":\"2026-10-21\",\"title\":\"Врач\",\"start\":\"15:00\",\"end\":\"16:00\",\"reminders\":[60]}"}}]}}]}`},
		{`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c2","type":"function","function":{"name":"create_event","arguments":"{\"date\":\"2026-10-21\",\"title\":\"Плохо\",\"start\":\"17:00\",\"end\":\"18:00\",\"reminders\":[-5]}"}}]}}]}`},
		{`{"choices":[{"delta":{"content":"Готово, напомню за час."}}]}`},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	rec := doAs(t, h, tok, "POST", "/api/chat", `{"text":"запиши к врачу на 15:00 и напомни за час"}`)
	if !strings.Contains(rec.Body.String(), "Готово") {
		t.Fatalf("поток: %s", rec.Body)
	}
	events := decode[[]model.Event](t, doAs(t, h, tok, "GET", "/api/events?date=2026-10-21", ""))
	if len(events) != 1 || events[0].Title != "Врач" || fmt.Sprint(events[0].Reminders) != "[60]" {
		t.Fatalf("события: %+v", events)
	}

	u := mustUser(t, st, "alice")
	s := &server{store: st, cal: newCalendars(CalendarOptions{})}
	out, _ := s.toolUpdateEvent(store.WithUser(context.Background(), u), map[string]any{"event_id": events[0].ID, "reminders": []any{}})
	if !strings.Contains(out, `"no_reminders":true`) {
		t.Fatalf("выключить напоминания: %s", out)
	}
	if out, _ := s.toolUpdateEvent(store.WithUser(context.Background(), u), map[string]any{"event_id": events[0].ID, "reminders": []any{1.5}}); !strings.Contains(out, "error") {
		t.Fatalf("дробные минуты: %s", out)
	}
}
