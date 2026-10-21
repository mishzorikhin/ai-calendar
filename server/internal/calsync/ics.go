package calsync

import (
	"bytes"
	"context"
	"net/http"
	"time"
)

// ICS — подписка на календарь по ссылке .ics: только чтение.
type ICS struct {
	Net *Net
	URL string
	// Loc — пояс пользователя для «плавающего» времени.
	Loc *time.Location
}

func (c *ICS) Fetch(ctx context.Context, from, to time.Time) ([]Occurrence, error) {
	h := http.Header{"Accept": {"text/calendar, */*;q=0.5"}}
	resp, data, err := c.Net.Do(ctx, http.MethodGet, c.URL, h, nil)
	if err != nil {
		return nil, err
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, ErrAuth
	case resp.StatusCode != http.StatusOK:
		return nil, &StatusError{Status: resp.StatusCode, What: "Календарь по ссылке"}
	}
	roots, err := Parse(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	occ := Expand(roots, from, to, c.Loc)
	for i := range occ {
		occ[i].ExternalID = occ[i].UID
		if occ[i].Recurrence != "" {
			occ[i].ExternalID += "/" + occ[i].Recurrence
		}
		occ[i].ReadOnly = true
	}
	return occ, nil
}

func (c *ICS) Create(context.Context, Item) (Ref, error)      { return Ref{}, ErrReadOnly }
func (c *ICS) Update(context.Context, Ref, Item) (Ref, error) { return Ref{}, ErrReadOnly }
func (c *ICS) Delete(context.Context, Ref) error              { return ErrReadOnly }
