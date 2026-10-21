// Package fakecal — поддельные CalDAV-сервер и API Google/Microsoft для тестов.
// Хранят события в памяти и отвечают так же, как настоящие сервисы в основных сценариях.
package fakecal

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
)

// Cleaner — то, что умеет снимать ресурсы по окончании (testing.T и подобные).
type Cleaner interface{ Cleanup(func()) }

// DAV — CalDAV-сервер: /principals/alice/ → /calendars/alice/ → календари work и tasks.
type DAV struct {
	*httptest.Server
	User, Pass string

	mu        sync.Mutex
	resources map[string]resource // путь → ресурс календаря work
	etagSeq   int
	// Log — методы и пути запросов («PUT /calendars/alice/work/x.ics»).
	Log []string
	// NoCalendarData — отвечать на calendar-query без тел (как старые серверы).
	NoCalendarData bool
}

type resource struct {
	etag string
	body string
}

// WorkPath — путь календаря с событиями.
const WorkPath = "/calendars/alice/work/"

// NewDAV запускает сервер; Close — через t.Cleanup.
func NewDAV(t Cleaner) *DAV {
	d := &DAV{User: "alice", Pass: "app-pass", resources: map[string]resource{}}
	d.Server = httptest.NewServer(http.HandlerFunc(d.serve))
	t.Cleanup(d.Close)
	return d
}

// Put кладёт ресурс в календарь work (подготовка теста).
func (d *DAV) Put(name, ics string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.etagSeq++
	path := WorkPath + name
	d.resources[path] = resource{etag: fmt.Sprintf(`"e%d"`, d.etagSeq), body: ics}
	return path
}

// Body — текущее содержимое ресурса.
func (d *DAV) Body(path string) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	r, ok := d.resources[path]
	return r.body, ok
}

// Paths — пути ресурсов календаря.
func (d *DAV) Paths() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for p := range d.resources {
		out = append(out, p)
	}
	return out
}

func (d *DAV) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Log = append(d.Log, r.Method+" "+r.URL.Path)
	if u, p, ok := r.BasicAuth(); !ok || u != d.User || p != d.Pass {
		w.Header().Set("WWW-Authenticate", `Basic realm="cal"`)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ms := func(inner string) {
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusMultiStatus)
		fmt.Fprintf(w, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">%s</d:multistatus>`, inner)
	}
	switch {
	case r.Method == "PROPFIND" && r.URL.Path == "/.well-known/caldav":
		http.Redirect(w, r, "/dav/", http.StatusMovedPermanently)
	case r.Method == "PROPFIND" && (r.URL.Path == "/dav/" || r.URL.Path == "/"):
		ms(`<d:response><d:href>/dav/</d:href><d:propstat><d:prop>
			<d:current-user-principal><d:href>/principals/alice/</d:href></d:current-user-principal>
			<d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
			<d:propstat><d:prop><c:calendar-home-set/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`)
	case r.Method == "PROPFIND" && r.URL.Path == "/principals/alice/":
		ms(`<d:response><d:href>/principals/alice/</d:href><d:propstat><d:prop>
			<c:calendar-home-set><d:href>/calendars/alice/</d:href></c:calendar-home-set></d:prop>
			<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
	case r.Method == "PROPFIND" && r.URL.Path == "/calendars/alice/":
		ms(`<d:response><d:href>/calendars/alice/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
			<d:response><d:href>/calendars/alice/work/</d:href><d:propstat><d:prop>
				<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Работа</d:displayname>
				<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
				<a:calendar-color>#FF8800FF</a:calendar-color>
				<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>
			</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
			<d:response><d:href>/calendars/alice/holidays/</d:href><d:propstat><d:prop>
				<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Праздники</d:displayname>
				<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
			</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
			<d:response><d:href>/calendars/alice/tasks/</d:href><d:propstat><d:prop>
				<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Задачи</d:displayname>
				<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
			</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
	case r.Method == "REPORT" && r.URL.Path == WorkPath:
		var b strings.Builder
		multiget := strings.Contains(string(body), "calendar-multiget")
		for path, res := range d.resources {
			if multiget && !strings.Contains(string(body), path) {
				continue
			}
			data := ""
			if multiget || !d.NoCalendarData {
				var esc strings.Builder
				_ = xmlEscape(&esc, res.body)
				data = "<c:calendar-data>" + esc.String() + "</c:calendar-data>"
			}
			fmt.Fprintf(&b, `<d:response><d:href>%s</d:href><d:propstat><d:prop><d:getetag>%s</d:getetag>%s</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
				path, res.etag, data)
		}
		ms(b.String())
	case r.Method == http.MethodGet:
		res, ok := d.resources[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("ETag", res.etag)
		_, _ = io.WriteString(w, res.body)
	case r.Method == http.MethodPut:
		res, exists := d.resources[r.URL.Path]
		if r.Header.Get("If-None-Match") == "*" && exists {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		if m := r.Header.Get("If-Match"); m != "" && (!exists || m != res.etag) {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		d.etagSeq++
		etag := fmt.Sprintf(`"e%d"`, d.etagSeq)
		d.resources[r.URL.Path] = resource{etag: etag, body: string(body)}
		w.Header().Set("ETag", etag)
		if exists {
			w.WriteHeader(http.StatusNoContent)
		} else {
			w.WriteHeader(http.StatusCreated)
		}
	case r.Method == http.MethodDelete:
		if _, ok := d.resources[r.URL.Path]; !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		delete(d.resources, r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func xmlEscape(b *strings.Builder, s string) error {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	_, err := b.WriteString(r.Replace(s))
	return err
}

// OAuth — поддельные страница согласия, токены и REST API календаря (Google или Graph).
type OAuth struct {
	*httptest.Server

	mu sync.Mutex
	// Events — события по id; поля — как в JSON соответствующего API.
	Events  map[string]map[string]any
	nextID  int
	issued  int
	Refresh int
	// Log — методы и пути запросов к API.
	Log []string
	// Expired — следующий запрос к API получит 401 (проверка обновления токена).
	Expired bool
}

// NewOAuth запускает сервер. Код авторизации — «good-code».
func NewOAuth(t Cleaner) *OAuth {
	o := &OAuth{Events: map[string]map[string]any{}}
	o.Server = httptest.NewServer(http.HandlerFunc(o.serve))
	t.Cleanup(o.Close)
	return o
}

// IDToken — id_token с e-mail (подпись не проверяется клиентом).
const IDToken = "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFsaWNlQGV4YW1wbGUuY29tIn0.sig"

func (o *OAuth) serve(w http.ResponseWriter, r *http.Request) {
	o.mu.Lock()
	defer o.mu.Unlock()
	writeJSON := func(status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	if r.URL.Path == "/token" {
		_ = r.ParseForm()
		switch r.Form.Get("grant_type") {
		case "authorization_code":
			if r.Form.Get("code") != "good-code" {
				writeJSON(400, map[string]string{"error": "invalid_grant"})
				return
			}
		case "refresh_token":
			if r.Form.Get("refresh_token") != "refresh-1" {
				writeJSON(400, map[string]string{"error": "invalid_grant"})
				return
			}
			o.Refresh++
		}
		o.issued++
		writeJSON(200, map[string]any{
			"access_token": fmt.Sprintf("access-%d", o.issued), "refresh_token": "refresh-1",
			"expires_in": 3600, "id_token": IDToken,
		})
		return
	}
	o.Log = append(o.Log, r.Method+" "+r.URL.Path)
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer access-") {
		writeJSON(401, map[string]string{"error": "no token"})
		return
	}
	if o.Expired {
		o.Expired = false
		writeJSON(401, map[string]string{"error": "expired"})
		return
	}
	path := r.URL.Path
	id := path[strings.LastIndex(path, "/")+1:]
	switch {
	// Google: /calendars/primary/events[/id]; Graph: /me/calendarView, /me/events[/id].
	case r.Method == http.MethodGet && (strings.HasSuffix(path, "/events") || strings.HasSuffix(path, "/calendarView")):
		var items []map[string]any
		for _, ev := range o.Events {
			items = append(items, ev)
		}
		if strings.HasSuffix(path, "/calendarView") {
			writeJSON(200, map[string]any{"value": items})
		} else {
			writeJSON(200, map[string]any{"items": items})
		}
	case r.Method == http.MethodPost:
		var ev map[string]any
		_ = json.NewDecoder(r.Body).Decode(&ev)
		o.nextID++
		id := fmt.Sprintf("g%d", o.nextID)
		ev["id"], ev["etag"], ev["changeKey"] = id, `"v1"`, "ck1"
		o.Events[id] = ev
		writeJSON(200, ev)
	case r.Method == http.MethodPatch:
		ev, ok := o.Events[id]
		if !ok {
			writeJSON(404, map[string]string{"error": "not found"})
			return
		}
		if m := r.Header.Get("If-Match"); m != "" && m != ev["etag"] {
			writeJSON(412, map[string]string{"error": "conditionNotMet"})
			return
		}
		var patch map[string]any
		_ = json.NewDecoder(r.Body).Decode(&patch)
		for k, v := range patch {
			ev[k] = v
		}
		ev["etag"], ev["changeKey"] = `"v2"`, "ck2"
		writeJSON(200, ev)
	case r.Method == http.MethodDelete:
		if _, ok := o.Events[id]; !ok {
			writeJSON(410, map[string]string{"error": "gone"})
			return
		}
		delete(o.Events, id)
		w.WriteHeader(http.StatusNoContent)
	default:
		writeJSON(404, map[string]string{"error": "unknown " + url.PathEscape(path)})
	}
}

// Add кладёт событие в API (подготовка теста).
func (o *OAuth) Add(id string, ev map[string]any) {
	o.mu.Lock()
	defer o.mu.Unlock()
	ev["id"] = id
	if _, ok := ev["etag"]; !ok {
		ev["etag"] = `"v1"`
	}
	o.Events[id] = ev
}

// Get — событие по id.
func (o *OAuth) Get(id string) (map[string]any, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	ev, ok := o.Events[id]
	return ev, ok
}

// Count — сколько событий в API.
func (o *OAuth) Count() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.Events)
}
