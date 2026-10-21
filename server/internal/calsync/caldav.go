package calsync

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// CalDAV — календарь на CalDAV-сервере (Яндекс, iCloud, Nextcloud, Fastmail…).
// URL — адрес коллекции календаря (её находит DiscoverCalDAV).
type CalDAV struct {
	Net      *Net
	URL      string
	Username string
	Password string
	Loc      *time.Location
	// ReadOnly — у пользователя нет права записи в этот календарь.
	ReadOnly bool
	// Now — часы для DTSTAMP (подменяются в тестах).
	Now func() time.Time
}

// CalendarInfo — календарь, найденный на CalDAV-сервере.
type CalendarInfo struct {
	URL      string `json:"url"`
	Name     string `json:"name"`
	Color    string `json:"color,omitempty"`
	Writable bool   `json:"writable"`
}

const (
	nsDAV    = "DAV:"
	nsCalDAV = "urn:ietf:params:xml:ns:caldav"
	nsApple  = "http://apple.com/ns/ical/"
)

// Ответ PROPFIND/REPORT (207 Multi-Status).
type multistatus struct {
	Responses []davResponse `xml:"DAV: response"`
}

type davResponse struct {
	Href      string        `xml:"DAV: href"`
	Propstats []davPropstat `xml:"DAV: propstat"`
}

type davPropstat struct {
	Prop   davProp `xml:"DAV: prop"`
	Status string  `xml:"DAV: status"`
}

type davHref struct {
	Href string `xml:"DAV: href"`
}

type davProp struct {
	Principal    *davHref `xml:"DAV: current-user-principal"`
	CalendarHome *davHref `xml:"urn:ietf:params:xml:ns:caldav calendar-home-set"`
	ResourceType *struct {
		Calendar *struct{} `xml:"urn:ietf:params:xml:ns:caldav calendar"`
	} `xml:"DAV: resourcetype"`
	DisplayName string `xml:"DAV: displayname"`
	Components  *struct {
		Comps []struct {
			Name string `xml:"name,attr"`
		} `xml:"urn:ietf:params:xml:ns:caldav comp"`
	} `xml:"urn:ietf:params:xml:ns:caldav supported-calendar-component-set"`
	Color      string `xml:"http://apple.com/ns/ical/ calendar-color"`
	Privileges *struct {
		List []struct {
			Inner []struct {
				XMLName xml.Name
			} `xml:",any"`
		} `xml:"DAV: privilege"`
	} `xml:"DAV: current-user-privilege-set"`
	ETag         string `xml:"DAV: getetag"`
	CalendarData string `xml:"urn:ietf:params:xml:ns:caldav calendar-data"`
}

// okProp — свойства из успешных propstat (у неизвестных свойств статус 404).
func (r davResponse) okProp() davProp {
	var out davProp
	for _, ps := range r.Propstats {
		if ps.Status != "" && !strings.Contains(ps.Status, " 200") {
			continue
		}
		p := ps.Prop
		if p.Principal != nil {
			out.Principal = p.Principal
		}
		if p.CalendarHome != nil {
			out.CalendarHome = p.CalendarHome
		}
		if p.ResourceType != nil {
			out.ResourceType = p.ResourceType
		}
		if p.DisplayName != "" {
			out.DisplayName = p.DisplayName
		}
		if p.Components != nil {
			out.Components = p.Components
		}
		if p.Color != "" {
			out.Color = p.Color
		}
		if p.Privileges != nil {
			out.Privileges = p.Privileges
		}
		if p.ETag != "" {
			out.ETag = p.ETag
		}
		if p.CalendarData != "" {
			out.CalendarData = p.CalendarData
		}
	}
	return out
}

func (p davProp) isCalendar() bool { return p.ResourceType != nil && p.ResourceType.Calendar != nil }

// supportsEvents — календарь хранит VEVENT (а не только задачи VTODO).
func (p davProp) supportsEvents() bool {
	if p.Components == nil || len(p.Components.Comps) == 0 {
		return true
	}
	for _, c := range p.Components.Comps {
		if strings.EqualFold(c.Name, "VEVENT") {
			return true
		}
	}
	return false
}

// writable — в наборе прав есть запись; если сервер права не сообщил — считаем, что можно.
func (p davProp) writable() bool {
	if p.Privileges == nil {
		return true
	}
	for _, pr := range p.Privileges.List {
		for _, in := range pr.Inner {
			switch in.XMLName.Local {
			case "write", "write-content", "all":
				return true
			}
		}
	}
	return false
}

type davClient struct {
	net        *Net
	user, pass string
}

func (c *davClient) header(extra map[string]string) http.Header {
	h := http.Header{}
	if c.user != "" || c.pass != "" {
		h.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.user+":"+c.pass)))
	}
	for k, v := range extra {
		h.Set(k, v)
	}
	return h
}

// davDo — запрос с XML-телом; 401/403 превращаются в ErrAuth.
func (c *davClient) davDo(ctx context.Context, method, target, depth, body string) (*http.Response, []byte, error) {
	extra := map[string]string{"Content-Type": "application/xml; charset=utf-8"}
	if depth != "" {
		extra["Depth"] = depth
	}
	resp, data, err := c.net.Do(ctx, method, target, c.header(extra), []byte(body))
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, nil, ErrAuth
	}
	return resp, data, nil
}

func (c *davClient) propfind(ctx context.Context, target, depth, props string) ([]davResponse, error) {
	body := `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>` + props + `</d:prop></d:propfind>`
	resp, data, err := c.davDo(ctx, "PROPFIND", target, depth, body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusMultiStatus {
		return nil, &StatusError{Status: resp.StatusCode, What: "CalDAV"}
	}
	var ms multistatus
	if err := xml.Unmarshal(data, &ms); err != nil {
		return nil, fmt.Errorf("CalDAV: непонятный ответ сервера: %w", err)
	}
	return ms.Responses, nil
}

// resolve — абсолютный адрес href относительно base.
func resolve(base, href string) string {
	b, err := url.Parse(base)
	if err != nil {
		return href
	}
	h, err := url.Parse(strings.TrimSpace(href))
	if err != nil {
		return href
	}
	return b.ResolveReference(h).String()
}

// DiscoverCalDAV находит календари пользователя по адресу сервера: сам адрес
// календаря, адрес пользователя (principal) или просто сервер — тогда через
// /.well-known/caldav (RFC 6764).
func DiscoverCalDAV(ctx context.Context, n *Net, server, username, password string) ([]CalendarInfo, error) {
	c := &davClient{net: n, user: username, pass: password}
	start, err := NormalizeURL(server)
	if err != nil {
		return nil, err
	}
	const firstProps = `<d:current-user-principal/><d:resourcetype/><d:displayname/><c:calendar-home-set/>`
	tryURLs := []string{start}
	if u, err := url.Parse(start); err == nil {
		wk := (&url.URL{Scheme: u.Scheme, Host: u.Host, Path: "/.well-known/caldav"}).String()
		if wk != start {
			tryURLs = append(tryURLs, wk)
		}
	}
	var principal, home string
	var lastErr error
	for _, target := range tryURLs {
		resps, err := c.propfind(ctx, target, "0", firstProps)
		if err != nil {
			if errors.Is(err, ErrAuth) || errors.Is(err, ErrBlockedHost) {
				return nil, err
			}
			lastErr = err
			continue
		}
		for _, r := range resps {
			p := r.okProp()
			if p.isCalendar() {
				href := resolve(target, r.Href)
				return []CalendarInfo{{URL: href, Name: nameOr(p.DisplayName, href), Color: p.Color, Writable: p.writable()}}, nil
			}
			if p.CalendarHome != nil {
				home = resolve(target, p.CalendarHome.Href)
			}
			if p.Principal != nil {
				principal = resolve(target, p.Principal.Href)
			}
		}
		if principal != "" || home != "" {
			break
		}
	}
	if principal == "" && home == "" {
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, errors.New("CalDAV: сервер не сообщил, где календари пользователя")
	}
	if home == "" {
		resps, err := c.propfind(ctx, principal, "0", `<c:calendar-home-set/>`)
		if err != nil {
			return nil, err
		}
		for _, r := range resps {
			if p := r.okProp(); p.CalendarHome != nil {
				home = resolve(principal, p.CalendarHome.Href)
			}
		}
		if home == "" {
			return nil, errors.New("CalDAV: не нашёл папку с календарями")
		}
	}
	resps, err := c.propfind(ctx, home, "1",
		`<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><a:calendar-color/><d:current-user-privilege-set/>`)
	if err != nil {
		return nil, err
	}
	var out []CalendarInfo
	for _, r := range resps {
		p := r.okProp()
		if !p.isCalendar() || !p.supportsEvents() {
			continue
		}
		href := resolve(home, r.Href)
		out = append(out, CalendarInfo{URL: href, Name: nameOr(p.DisplayName, href), Color: normColor(p.Color), Writable: p.writable()})
	}
	if len(out) == 0 {
		return nil, errors.New("CalDAV: календарей с событиями не нашлось")
	}
	return out, nil
}

func nameOr(name, href string) string {
	if name = strings.TrimSpace(name); name != "" {
		return name
	}
	parts := strings.Split(strings.Trim(href, "/"), "/")
	if last, err := url.PathUnescape(parts[len(parts)-1]); err == nil && last != "" {
		return last
	}
	return "Календарь"
}

// normColor — «#RRGGBBAA» от Apple → «#RRGGBB».
func normColor(c string) string {
	c = strings.TrimSpace(c)
	if len(c) == 9 && c[0] == '#' {
		return c[:7]
	}
	return c
}

func (d *CalDAV) client() *davClient {
	return &davClient{net: d.Net, user: d.Username, pass: d.Password}
}

func (d *CalDAV) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// Fetch — события коллекции в окне: calendar-query с time-range; если сервер
// не вернул тела событий, догружаем их calendar-multiget.
func (d *CalDAV) Fetch(ctx context.Context, from, to time.Time) ([]Occurrence, error) {
	c := d.client()
	query := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:getetag/><c:calendar-data/></d:prop>
<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="%s" end="%s"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`, from.UTC().Format(icalUTC), to.UTC().Format(icalUTC))
	resp, data, err := c.davDo(ctx, "REPORT", d.URL, "1", query)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusMultiStatus {
		return nil, &StatusError{Status: resp.StatusCode, What: "CalDAV"}
	}
	var ms multistatus
	if err := xml.Unmarshal(data, &ms); err != nil {
		return nil, fmt.Errorf("CalDAV: непонятный ответ сервера: %w", err)
	}
	var withData []davResponse
	var missing []string
	for _, r := range ms.Responses {
		p := r.okProp()
		switch {
		case p.CalendarData != "":
			withData = append(withData, r)
		case !strings.HasSuffix(r.Href, "/"):
			missing = append(missing, r.Href)
		}
	}
	for len(missing) > 0 {
		batch := missing[:min(len(missing), 100)]
		missing = missing[len(batch):]
		more, err := d.multiget(ctx, batch)
		if err != nil {
			return nil, err
		}
		withData = append(withData, more...)
	}

	var out []Occurrence
	for _, r := range withData {
		p := r.okProp()
		roots, err := Parse(strings.NewReader(p.CalendarData))
		if err != nil {
			continue // одно битое событие не должно ломать весь календарь
		}
		href := resolvePath(d.URL, r.Href)
		for _, o := range Expand(roots, from, to, d.Loc) {
			o.ETag = p.ETag
			o.ExternalID = href
			o.ReadOnly = d.ReadOnly
			if o.Recurrence != "" {
				// Вхождения серии правятся только в исходном календаре: здесь их не изменить точечно.
				o.ExternalID = href + "#" + o.Recurrence
				o.ReadOnly = true
			}
			out = append(out, o)
		}
	}
	return out, nil
}

func (d *CalDAV) multiget(ctx context.Context, hrefs []string) ([]davResponse, error) {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="utf-8"?>
<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>`)
	for _, h := range hrefs {
		b.WriteString("<d:href>")
		_ = xml.EscapeText(&b, []byte(h))
		b.WriteString("</d:href>")
	}
	b.WriteString(`</c:calendar-multiget>`)
	resp, data, err := d.client().davDo(ctx, "REPORT", d.URL, "1", b.String())
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusMultiStatus {
		return nil, &StatusError{Status: resp.StatusCode, What: "CalDAV"}
	}
	var ms multistatus
	if err := xml.Unmarshal(data, &ms); err != nil {
		return nil, fmt.Errorf("CalDAV: непонятный ответ сервера: %w", err)
	}
	return ms.Responses, nil
}

// resolvePath — путь ресурса (без схемы и хоста): так id не зависит от того, как сервер пишет href.
func resolvePath(base, href string) string {
	u, err := url.Parse(resolve(base, href))
	if err != nil {
		return href
	}
	return u.EscapedPath()
}

func (d *CalDAV) resourceURL(id string) string {
	path, _, _ := strings.Cut(id, "#")
	return resolve(d.URL, path)
}

func newUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Create — новый ресурс в коллекции: PUT с If-None-Match: *, чтобы не перезаписать чужой.
func (d *CalDAV) Create(ctx context.Context, it Item) (Ref, error) {
	if d.ReadOnly {
		return Ref{}, ErrReadOnly
	}
	uid := newUID()
	cal := NewCalendar("", NewEventComponent(uid+"@ai-calendar", it, d.now()))
	target := strings.TrimRight(d.URL, "/") + "/" + uid + ".ics"
	resp, _, err := d.Net.Do(ctx, http.MethodPut, target, d.client().header(map[string]string{
		"Content-Type":  "text/calendar; charset=utf-8",
		"If-None-Match": "*",
	}), Encode(cal))
	if err != nil {
		return Ref{}, err
	}
	if err := putStatus(resp); err != nil {
		return Ref{}, err
	}
	return Ref{ID: resolvePath(d.URL, target), ETag: resp.Header.Get("ETag")}, nil
}

// Update меняет только название, место и время: читает ресурс, правит VEVENT
// и пишет обратно с If-Match — будильники, участники и прочее сохраняются.
func (d *CalDAV) Update(ctx context.Context, ref Ref, it Item) (Ref, error) {
	if d.ReadOnly || strings.Contains(ref.ID, "#") {
		return Ref{}, ErrReadOnly
	}
	target := d.resourceURL(ref.ID)
	c := d.client()
	resp, data, err := d.Net.Do(ctx, http.MethodGet, target, c.header(nil), nil)
	if err != nil {
		return Ref{}, err
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return Ref{}, ErrAuth
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return Ref{}, &StatusError{Status: resp.StatusCode, What: "Событие в календаре"}
	case resp.StatusCode != http.StatusOK:
		return Ref{}, &StatusError{Status: resp.StatusCode, What: "CalDAV"}
	}
	etag := resp.Header.Get("ETag")
	roots, err := Parse(bytes.NewReader(data))
	if err != nil {
		return Ref{}, err
	}
	var master *Component
	for _, r := range roots {
		for _, ch := range r.Children {
			if master == nil && ch.Name == "VEVENT" && ch.Get("RECURRENCE-ID") == nil {
				master = ch
			}
		}
	}
	if master == nil {
		return Ref{}, errors.New("CalDAV: в ресурсе нет события")
	}
	if master.Get("RRULE") != nil {
		return Ref{}, ErrReadOnly
	}
	applyItem(master, it, d.now())
	seq := 0
	if p := master.Get("SEQUENCE"); p != nil {
		seq, _ = strconv.Atoi(strings.TrimSpace(p.Value))
	}
	master.Set(Prop{Name: "SEQUENCE", Value: strconv.Itoa(seq + 1)})
	h := map[string]string{"Content-Type": "text/calendar; charset=utf-8"}
	if etag != "" {
		h["If-Match"] = etag
	}
	var out bytes.Buffer
	for _, r := range roots {
		out.Write(Encode(r))
	}
	resp, _, err = d.Net.Do(ctx, http.MethodPut, target, c.header(h), out.Bytes())
	if err != nil {
		return Ref{}, err
	}
	if err := putStatus(resp); err != nil {
		return Ref{}, err
	}
	return Ref{ID: ref.ID, ETag: resp.Header.Get("ETag")}, nil
}

func putStatus(resp *http.Response) error {
	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusNoContent:
		return nil
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrAuth
	case resp.StatusCode == http.StatusPreconditionFailed:
		return ErrConflict
	}
	return &StatusError{Status: resp.StatusCode, What: "CalDAV"}
}

// Delete удаляет ресурс; уже удалённый — не ошибка.
func (d *CalDAV) Delete(ctx context.Context, ref Ref) error {
	if d.ReadOnly || strings.Contains(ref.ID, "#") {
		return ErrReadOnly
	}
	resp, _, err := d.Net.Do(ctx, http.MethodDelete, d.resourceURL(ref.ID), d.client().header(nil), nil)
	if err != nil {
		return err
	}
	switch {
	case resp.StatusCode < 300, resp.StatusCode == http.StatusNotFound, resp.StatusCode == http.StatusGone:
		return nil
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrAuth
	}
	return &StatusError{Status: resp.StatusCode, What: "CalDAV"}
}
