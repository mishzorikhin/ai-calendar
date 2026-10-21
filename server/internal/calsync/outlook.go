package calsync

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Outlook — календарь Outlook / Microsoft 365 через Microsoft Graph.
// calendarView сам разворачивает серии во вхождения.
type Outlook struct {
	Tokens     *TokenSource
	CalendarID string
	ReadOnly   bool
}

type graphTime struct {
	DateTime string `json:"dateTime"`
	TimeZone string `json:"timeZone"`
}

type graphEvent struct {
	ID          string    `json:"id,omitempty"`
	ChangeKey   string    `json:"changeKey,omitempty"`
	Subject     string    `json:"subject"`
	IsAllDay    bool      `json:"isAllDay,omitempty"`
	IsCancelled bool      `json:"isCancelled,omitempty"`
	Start       graphTime `json:"start"`
	End         graphTime `json:"end"`
	Location    *graphLoc `json:"location,omitempty"`
}

type graphLoc struct {
	DisplayName string `json:"displayName"`
}

// graphLayout — Graph отдаёт время без пояса и с 7 знаками дробной части.
const graphLayout = "2006-01-02T15:04:05.9999999"

func (o *Outlook) base() string {
	if o.CalendarID == "" || o.CalendarID == "primary" {
		return o.Tokens.App.APIBase + "/me"
	}
	return o.Tokens.App.APIBase + "/me/calendars/" + url.PathEscape(o.CalendarID)
}

func (o *Outlook) Fetch(ctx context.Context, from, to time.Time) ([]Occurrence, error) {
	q := url.Values{
		"startDateTime": {from.UTC().Format(time.RFC3339)},
		"endDateTime":   {to.UTC().Format(time.RFC3339)},
		"$top":          {"200"},
		"$select":       {"id,subject,location,start,end,isAllDay,isCancelled,changeKey"},
	}
	// Время — в UTC, чтобы не разбирать Windows-имена поясов.
	h := http.Header{"Prefer": {`outlook.timezone="UTC"`}}
	target := o.base() + "/calendarView?" + q.Encode()
	var out []Occurrence
	for page := 0; page < 50 && target != ""; page++ {
		var resp struct {
			Value    []graphEvent `json:"value"`
			NextLink string       `json:"@odata.nextLink"`
		}
		if _, err := restDo(ctx, o.Tokens, http.MethodGet, target, h, nil, &resp); err != nil {
			return nil, err
		}
		for _, ev := range resp.Value {
			if ev.IsCancelled {
				continue
			}
			occ, ok := graphOccurrence(ev)
			if !ok {
				continue
			}
			occ.ReadOnly = o.ReadOnly
			out = append(out, occ)
		}
		target = ""
		// Следующая страница — только с того же API: ссылку прислал сервис, но доверять ей вслепую незачем.
		if strings.HasPrefix(resp.NextLink, o.Tokens.App.APIBase+"/") {
			target = resp.NextLink
		}
	}
	return out, nil
}

func graphOccurrence(ev graphEvent) (Occurrence, bool) {
	s, err1 := time.Parse(graphLayout, ev.Start.DateTime)
	e, err2 := time.Parse(graphLayout, ev.End.DateTime)
	if err1 != nil || err2 != nil {
		return Occurrence{}, false
	}
	o := Occurrence{UID: ev.ID, ExternalID: ev.ID, ETag: ev.ChangeKey, Title: ev.Subject, Start: s, End: e, AllDay: ev.IsAllDay}
	if ev.Location != nil {
		o.Location = ev.Location.DisplayName
	}
	if o.Title == "" {
		o.Title = "Без названия"
	}
	return o, true
}

func graphBody(it Item) graphEvent {
	return graphEvent{
		Subject:  it.Title,
		Start:    graphTime{DateTime: it.Start.UTC().Format("2006-01-02T15:04:05"), TimeZone: "UTC"},
		End:      graphTime{DateTime: it.End.UTC().Format("2006-01-02T15:04:05"), TimeZone: "UTC"},
		Location: &graphLoc{DisplayName: it.Location},
	}
}

func (o *Outlook) Create(ctx context.Context, it Item) (Ref, error) {
	if o.ReadOnly {
		return Ref{}, ErrReadOnly
	}
	var created graphEvent
	if _, err := restDo(ctx, o.Tokens, http.MethodPost, o.base()+"/events", nil, graphBody(it), &created); err != nil {
		return Ref{}, err
	}
	if created.ID == "" {
		return Ref{}, errors.New("Outlook не вернул id события")
	}
	return Ref{ID: created.ID, ETag: created.ChangeKey}, nil
}

func (o *Outlook) Update(ctx context.Context, ref Ref, it Item) (Ref, error) {
	if o.ReadOnly {
		return Ref{}, ErrReadOnly
	}
	var updated graphEvent
	target := o.Tokens.App.APIBase + "/me/events/" + url.PathEscape(ref.ID)
	if _, err := restDo(ctx, o.Tokens, http.MethodPatch, target, nil, graphBody(it), &updated); err != nil {
		return Ref{}, err
	}
	return Ref{ID: ref.ID, ETag: updated.ChangeKey}, nil
}

func (o *Outlook) Delete(ctx context.Context, ref Ref) error {
	if o.ReadOnly {
		return ErrReadOnly
	}
	status, err := restDo(ctx, o.Tokens, http.MethodDelete, o.Tokens.App.APIBase+"/me/events/"+url.PathEscape(ref.ID), nil, nil, nil)
	if status == http.StatusNotFound || status == http.StatusGone {
		return nil
	}
	return err
}
