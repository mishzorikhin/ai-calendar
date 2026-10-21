package calsync_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/calsync"
	"github.com/mishzorikhin/ai-calendar/server/internal/calsync/fakecal"
)

var (
	ctx    = context.Background()
	moscow = func() *time.Location { l, _ := time.LoadLocation("Europe/Moscow"); return l }()
	from   = time.Date(2026, 10, 1, 0, 0, 0, 0, moscow)
	to     = time.Date(2026, 12, 1, 0, 0, 0, 0, moscow)
	// Тестовые серверы слушают 127.0.0.1 — разрешаем внутреннюю сеть.
	testNet = calsync.NewNet(true, 5*time.Second)
)

const meetingICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:m1\r\nSUMMARY:Встреча\r\nLOCATION:Офис\r\nVALARM-KEEP:да\r\n" +
	"DTSTART:20261021T060000Z\r\nDTEND:20261021T070000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"

func TestDiscoverCalDAV(t *testing.T) {
	d := fakecal.NewDAV(t)
	// Адрес не календаря — путь через /.well-known/caldav с редиректом.
	cals, err := calsync.DiscoverCalDAV(ctx, testNet, d.URL+"/nothing", d.User, d.Pass)
	if err != nil {
		t.Fatal(err)
	}
	if len(cals) != 2 {
		t.Fatalf("ждали два календаря с событиями (без VTODO): %+v", cals)
	}
	work := cals[0]
	if work.Name != "Работа" || !strings.HasSuffix(work.URL, fakecal.WorkPath) || !work.Writable || work.Color != "#FF8800" {
		t.Fatalf("календарь: %+v", work)
	}
	if cals[1].Writable {
		t.Fatalf("праздники только для чтения: %+v", cals[1])
	}
	if _, err := calsync.DiscoverCalDAV(ctx, testNet, d.URL, d.User, "wrong"); !errors.Is(err, calsync.ErrAuth) {
		t.Fatalf("неверный пароль: %v", err)
	}
}

func TestCalDAVTwoWay(t *testing.T) {
	d := fakecal.NewDAV(t)
	d.Put("m1.ics", meetingICS)
	c := &calsync.CalDAV{Net: testNet, URL: d.URL + fakecal.WorkPath, Username: d.User, Password: d.Pass, Loc: moscow}

	occ, err := c.Fetch(ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(occ) != 1 || occ[0].ExternalID != fakecal.WorkPath+"m1.ics" || occ[0].ETag == "" || occ[0].ReadOnly {
		t.Fatalf("чтение: %+v", occ)
	}

	// Правка сохраняет чужие свойства и меняет время.
	start := time.Date(2026, 10, 21, 11, 0, 0, 0, moscow)
	ref, err := c.Update(ctx, calsync.Ref{ID: occ[0].ExternalID, ETag: occ[0].ETag},
		calsync.Item{Title: "Встреча (перенесли)", Start: start, End: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := d.Body(fakecal.WorkPath + "m1.ics")
	if !strings.Contains(body, "VALARM-KEEP:да") || !strings.Contains(body, "DTSTART:20261021T080000Z") ||
		!strings.Contains(body, "SEQUENCE:1") || strings.Contains(body, "LOCATION") {
		t.Fatalf("после правки:\n%s", body)
	}
	if ref.ETag == occ[0].ETag {
		t.Fatal("ETag не обновился")
	}

	// Новое событие — отдельный ресурс.
	created, err := c.Create(ctx, calsync.Item{Title: "Новое", Start: start, End: start.Add(30 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := d.Body(created.ID); !ok || !strings.HasPrefix(created.ID, fakecal.WorkPath) {
		t.Fatalf("создание: %+v, ресурсы %v", created, d.Paths())
	}
	occ, _ = c.Fetch(ctx, from, to)
	if len(occ) != 2 {
		t.Fatalf("после создания: %+v", occ)
	}

	if err := c.Delete(ctx, created); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete(ctx, created); err != nil {
		t.Fatalf("повторное удаление — не ошибка: %v", err)
	}
	if _, ok := d.Body(created.ID); ok {
		t.Fatal("ресурс не удалён")
	}
}

func TestCalDAVMultigetAndRecurring(t *testing.T) {
	d := fakecal.NewDAV(t)
	d.NoCalendarData = true
	d.Put("r.ics", "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Йога\r\nDTSTART;TZID=Europe/Moscow:20261019T080000\r\n"+
		"DTEND;TZID=Europe/Moscow:20261019T090000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
	c := &calsync.CalDAV{Net: testNet, URL: d.URL + fakecal.WorkPath, Username: d.User, Password: d.Pass, Loc: moscow}
	occ, err := c.Fetch(ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(occ) != 3 || !occ[0].ReadOnly || !strings.Contains(occ[1].ExternalID, "#") {
		t.Fatalf("серия через multiget: %+v", occ)
	}
	if _, err := c.Update(ctx, calsync.Ref{ID: occ[1].ExternalID}, calsync.Item{}); !errors.Is(err, calsync.ErrReadOnly) {
		t.Fatalf("вхождение серии не правится: %v", err)
	}
}

func TestCalDAVMissingResource(t *testing.T) {
	d := fakecal.NewDAV(t)
	c := &calsync.CalDAV{Net: testNet, URL: d.URL + fakecal.WorkPath, Username: d.User, Password: d.Pass, Loc: moscow}
	start := time.Date(2026, 10, 21, 11, 0, 0, 0, moscow)
	_, err := c.Update(ctx, calsync.Ref{ID: fakecal.WorkPath + "gone.ics"}, calsync.Item{Title: "x", Start: start, End: start.Add(time.Hour)})
	var se *calsync.StatusError
	if !errors.As(err, &se) || se.Status != http.StatusNotFound {
		t.Fatalf("правка исчезнувшего ресурса: %v", err)
	}
}

func TestICSSubscription(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/calendar")
		_, _ = w.Write([]byte(meetingICS))
	}))
	defer srv.Close()
	c := &calsync.ICS{Net: testNet, URL: srv.URL, Loc: moscow}
	occ, err := c.Fetch(ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(occ) != 1 || !occ[0].ReadOnly || occ[0].ExternalID != "m1" {
		t.Fatalf("подписка: %+v", occ)
	}
	if _, err := c.Create(ctx, calsync.Item{}); !errors.Is(err, calsync.ErrReadOnly) {
		t.Fatalf("подписка только для чтения: %v", err)
	}
}

func TestNetBlocksPrivateAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	strict := calsync.NewNet(false, 5*time.Second)
	if _, _, err := strict.Do(ctx, http.MethodGet, srv.URL, nil, nil); !errors.Is(err, calsync.ErrBlockedHost) {
		t.Fatalf("127.0.0.1 должен быть закрыт: %v", err)
	}
	// Имя хоста тоже не помогает: проверяется адрес, к которому идёт соединение.
	local := strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)
	if _, _, err := strict.Do(ctx, http.MethodGet, local, nil, nil); !errors.Is(err, calsync.ErrBlockedHost) {
		t.Fatalf("localhost должен быть закрыт: %v", err)
	}
	if _, _, err := strict.Do(ctx, http.MethodGet, "http://192.168.0.16:8080/v1/models", nil, nil); !errors.Is(err, calsync.ErrBlockedHost) {
		t.Fatalf("домашняя сеть должна быть закрыта: %v", err)
	}
}

func newApp(o *fakecal.OAuth) *calsync.OAuthApp {
	return &calsync.OAuthApp{ClientID: "id", ClientSecret: "sec", AuthURL: o.URL + "/auth", TokenURL: o.URL + "/token", APIBase: o.URL}
}

func TestGoogleTwoWayWithRefresh(t *testing.T) {
	o := fakecal.NewOAuth(t)
	app := newApp(o)
	tok, email, err := app.Exchange(ctx, testNet, "good-code", "http://localhost/cb")
	if err != nil || email != "alice@example.com" || tok.Refresh != "refresh-1" {
		t.Fatalf("обмен кода: %+v %q %v", tok, email, err)
	}
	if _, _, err := app.Exchange(ctx, testNet, "bad", "http://localhost/cb"); !errors.Is(err, calsync.ErrAuth) {
		t.Fatalf("неверный код: %v", err)
	}
	if u := app.AuthCodeURL("st", "http://localhost/cb"); !strings.Contains(u, "state=st") || !strings.Contains(u, "redirect_uri=") {
		t.Fatalf("ссылка согласия: %s", u)
	}

	saved := 0
	ts := calsync.NewTokenSource(app, testNet, tok, func(calsync.Token) error { saved++; return nil })
	g := &calsync.Google{Tokens: ts, CalendarID: "primary"}
	o.Add("a1", map[string]any{"summary": "Обед", "start": map[string]any{"dateTime": "2026-10-21T13:00:00+03:00"},
		"end": map[string]any{"dateTime": "2026-10-21T14:00:00+03:00"}})
	o.Add("a2", map[string]any{"summary": "Праздник", "start": map[string]any{"date": "2026-11-04"}, "end": map[string]any{"date": "2026-11-05"}})
	o.Add("a3", map[string]any{"status": "cancelled", "start": map[string]any{"date": "2026-11-04"}, "end": map[string]any{"date": "2026-11-05"}})

	o.Expired = true // первый запрос получит 401 — токен обновится сам
	occ, err := g.Fetch(ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(occ) != 2 || o.Refresh != 1 || saved != 1 {
		t.Fatalf("чтение с обновлением токена: %+v refresh=%d saved=%d", occ, o.Refresh, saved)
	}

	start := time.Date(2026, 10, 22, 9, 0, 0, 0, moscow)
	ref, err := g.Create(ctx, calsync.Item{Title: "Новое", Start: start, End: start.Add(time.Hour)})
	if err != nil || ref.ID == "" {
		t.Fatalf("создание: %+v %v", ref, err)
	}
	if _, err := g.Update(ctx, calsync.Ref{ID: ref.ID, ETag: `"stale"`}, calsync.Item{Title: "x", Start: start, End: start.Add(time.Hour)}); !errors.Is(err, calsync.ErrConflict) {
		t.Fatalf("устаревший ETag: %v", err)
	}
	ref, err = g.Update(ctx, ref, calsync.Item{Title: "Переименовали", Start: start, End: start.Add(time.Hour)})
	if err != nil || ref.ETag != `"v2"` {
		t.Fatalf("правка: %+v %v", ref, err)
	}
	if ev, _ := o.Get(ref.ID); ev["summary"] != "Переименовали" {
		t.Fatalf("в API: %+v", ev)
	}
	if err := g.Delete(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := g.Delete(ctx, ref); err != nil {
		t.Fatalf("удаление удалённого (410) — не ошибка: %v", err)
	}
}

func TestOutlookReadWrite(t *testing.T) {
	o := fakecal.NewOAuth(t)
	app := newApp(o)
	ts := calsync.NewTokenSource(app, testNet, calsync.Token{Access: "access-0", Refresh: "refresh-1", Expiry: time.Now().Add(time.Hour)}, nil)
	ol := &calsync.Outlook{Tokens: ts}
	o.Add("o1", map[string]any{"subject": "Созвон", "changeKey": "ck0",
		"start":    map[string]any{"dateTime": "2026-10-21T06:00:00.0000000", "timeZone": "UTC"},
		"end":      map[string]any{"dateTime": "2026-10-21T06:30:00.0000000", "timeZone": "UTC"},
		"location": map[string]any{"displayName": "Teams"}})
	occ, err := ol.Fetch(ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(occ) != 1 || occ[0].Location != "Teams" || occ[0].Start.In(moscow).Hour() != 9 || occ[0].ETag != "ck0" {
		t.Fatalf("чтение: %+v", occ)
	}
	start := time.Date(2026, 10, 22, 9, 0, 0, 0, moscow)
	ref, err := ol.Create(ctx, calsync.Item{Title: "Новое", Start: start, End: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	ev, _ := o.Get(ref.ID)
	if st, _ := ev["start"].(map[string]any); st["dateTime"] != "2026-10-22T06:00:00" {
		t.Fatalf("время в UTC: %+v", ev)
	}
	if err := ol.Delete(ctx, ref); err != nil || o.Count() != 1 {
		t.Fatalf("удаление: %v, осталось %d", err, o.Count())
	}
}
