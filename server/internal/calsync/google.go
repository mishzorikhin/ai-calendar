package calsync

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"
)

// Google — календарь Google через Calendar API v3. Повторы разворачивает сам
// Google (singleEvents=true), поэтому каждое вхождение — отдельное событие со своим id.
type Google struct {
	Tokens     *TokenSource
	CalendarID string
	ReadOnly   bool
}

type googleTime struct {
	Date     string `json:"date,omitempty"`
	DateTime string `json:"dateTime,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}

type googleEvent struct {
	ID       string     `json:"id,omitempty"`
	ETag     string     `json:"etag,omitempty"`
	Status   string     `json:"status,omitempty"`
	Summary  string     `json:"summary"`
	Location string     `json:"location"`
	Start    googleTime `json:"start"`
	End      googleTime `json:"end"`
}

func (g *Google) events() string {
	id := g.CalendarID
	if id == "" {
		id = "primary"
	}
	return g.Tokens.App.APIBase + "/calendars/" + url.PathEscape(id) + "/events"
}

func (g *Google) Fetch(ctx context.Context, from, to time.Time) ([]Occurrence, error) {
	q := url.Values{
		"singleEvents": {"true"},
		"orderBy":      {"startTime"},
		"timeMin":      {from.UTC().Format(time.RFC3339)},
		"timeMax":      {to.UTC().Format(time.RFC3339)},
		"maxResults":   {"2500"},
	}
	var out []Occurrence
	for page := 0; page < 20; page++ {
		var resp struct {
			Items         []googleEvent `json:"items"`
			NextPageToken string        `json:"nextPageToken"`
		}
		if _, err := restDo(ctx, g.Tokens, http.MethodGet, g.events()+"?"+q.Encode(), nil, nil, &resp); err != nil {
			return nil, err
		}
		for _, it := range resp.Items {
			if it.Status == "cancelled" {
				continue
			}
			o, ok := googleOccurrence(it)
			if !ok {
				continue
			}
			o.ReadOnly = g.ReadOnly
			out = append(out, o)
		}
		if resp.NextPageToken == "" {
			break
		}
		q.Set("pageToken", resp.NextPageToken)
	}
	return out, nil
}

func googleOccurrence(it googleEvent) (Occurrence, bool) {
	o := Occurrence{UID: it.ID, ExternalID: it.ID, ETag: it.ETag, Title: it.Summary, Location: it.Location}
	if o.Title == "" {
		o.Title = "Без названия"
	}
	if it.Start.Date != "" {
		s, err1 := time.Parse(time.DateOnly, it.Start.Date)
		e, err2 := time.Parse(time.DateOnly, it.End.Date)
		if err1 != nil || err2 != nil {
			return Occurrence{}, false
		}
		o.Start, o.End, o.AllDay = s, e, true
		return o, true
	}
	s, err1 := time.Parse(time.RFC3339, it.Start.DateTime)
	e, err2 := time.Parse(time.RFC3339, it.End.DateTime)
	if err1 != nil || err2 != nil {
		return Occurrence{}, false
	}
	o.Start, o.End = s, e
	return o, true
}

func googleBody(it Item) googleEvent {
	return googleEvent{
		Summary:  it.Title,
		Location: it.Location,
		Start:    googleTime{DateTime: it.Start.Format(time.RFC3339), TimeZone: it.Start.Location().String()},
		End:      googleTime{DateTime: it.End.Format(time.RFC3339), TimeZone: it.End.Location().String()},
	}
}

func (g *Google) Create(ctx context.Context, it Item) (Ref, error) {
	if g.ReadOnly {
		return Ref{}, ErrReadOnly
	}
	var created googleEvent
	if _, err := restDo(ctx, g.Tokens, http.MethodPost, g.events(), nil, googleBody(it), &created); err != nil {
		return Ref{}, err
	}
	if created.ID == "" {
		return Ref{}, errors.New("Google Календарь не вернул id события")
	}
	return Ref{ID: created.ID, ETag: created.ETag}, nil
}

func (g *Google) Update(ctx context.Context, ref Ref, it Item) (Ref, error) {
	if g.ReadOnly {
		return Ref{}, ErrReadOnly
	}
	h := http.Header{}
	if ref.ETag != "" {
		h.Set("If-Match", ref.ETag)
	}
	var updated googleEvent
	if _, err := restDo(ctx, g.Tokens, http.MethodPatch, g.events()+"/"+url.PathEscape(ref.ID), h, googleBody(it), &updated); err != nil {
		return Ref{}, err
	}
	return Ref{ID: ref.ID, ETag: updated.ETag}, nil
}

func (g *Google) Delete(ctx context.Context, ref Ref) error {
	if g.ReadOnly {
		return ErrReadOnly
	}
	status, err := restDo(ctx, g.Tokens, http.MethodDelete, g.events()+"/"+url.PathEscape(ref.ID), nil, nil, nil)
	if status == http.StatusNotFound || status == http.StatusGone {
		return nil
	}
	return err
}
