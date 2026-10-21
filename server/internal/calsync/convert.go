package calsync

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Ограничения полей события — те же, что проверяет API (server/internal/api/api.go).
const (
	maxTitle    = 120
	maxSubtitle = 200
	dayMinutes  = 24 * 60
	// minMinutes — событие без длительности показываем получасовым, чтобы его было видно.
	minMinutes = 30
)

// Item — событие для записи во внешний календарь.
type Item struct {
	Title    string
	Location string
	Start    time.Time
	End      time.Time
}

// Ref — ссылка на событие во внешнем календаре и его версия.
type Ref struct {
	ID   string
	ETag string
}

// ItemOf переводит событие приложения (дата + минуты в поясе loc) во время.
func ItemOf(e model.Event, loc *time.Location) (Item, bool) {
	d, err := time.ParseInLocation(time.DateOnly, e.Date, loc)
	if err != nil {
		return Item{}, false
	}
	y, m, day := d.Date()
	return Item{
		Title:    e.Title,
		Location: e.Subtitle,
		Start:    time.Date(y, m, day, 0, e.Start, 0, 0, loc),
		End:      time.Date(y, m, day, 0, e.End, 0, 0, loc),
	}, true
}

// ToEvents переводит вхождение в события дней пользователя (пояс loc) в окне
// дат [from, to]. Многодневное событие режется по дням; такие части, как и
// события на весь день, доступны только для чтения.
func ToEvents(o Occurrence, loc *time.Location, from, to string) []model.Event {
	base := model.Event{
		Title:      clip(o.Title, maxTitle),
		Subtitle:   clip(o.Location, maxSubtitle),
		Badge:      model.BadgeRoutine,
		ExternalID: o.ExternalID,
		ETag:       o.ETag,
		ReadOnly:   o.ReadOnly,
	}
	var out []model.Event
	add := func(e model.Event) {
		if e.Date >= from && e.Date <= to {
			out = append(out, e)
		}
	}
	if o.AllDay {
		// Даты события на весь день — «настенные», без пояса: берём их как есть.
		sy, sm, sd := o.Start.Date()
		ey, em, ed := o.End.Date()
		day := time.Date(sy, sm, sd, 0, 0, 0, 0, time.UTC)
		end := time.Date(ey, em, ed, 0, 0, 0, 0, time.UTC)
		if !end.After(day) {
			end = day.AddDate(0, 0, 1)
		}
		multi := end.Sub(day) > 24*time.Hour
		for d := day; d.Before(end); d = d.AddDate(0, 0, 1) {
			e := base
			e.Date = d.Format(time.DateOnly)
			e.Start, e.End = 0, dayMinutes
			e.AllDay, e.ReadOnly = true, true
			if multi {
				e.ExternalID = o.ExternalID + "@" + e.Date
			}
			add(e)
		}
		return out
	}

	start, end := o.Start.In(loc), o.End.In(loc)
	if end.Sub(start) < minMinutes*time.Minute {
		end = start.Add(minMinutes * time.Minute)
	}
	sDay := dayStart(start)
	eDay := dayStart(end)
	if end.Equal(eDay) {
		eDay = eDay.AddDate(0, 0, -1) // конец ровно в полночь — событие заканчивается в предыдущий день
	}
	if sDay.Equal(eDay) {
		e := base
		e.Date = sDay.Format(time.DateOnly)
		e.Start = minutesOf(start)
		e.End = min(minutesOf(start)+int(end.Sub(start)/time.Minute), dayMinutes)
		add(e)
		return out
	}
	// Через полночь: первый день до конца суток, средние целиком, последний — с полуночи.
	for d := sDay; !d.After(eDay); d = d.AddDate(0, 0, 1) {
		e := base
		e.Date = d.Format(time.DateOnly)
		e.ReadOnly = true
		e.ExternalID = o.ExternalID + "@" + e.Date
		e.Start, e.End = 0, dayMinutes
		if d.Equal(sDay) {
			e.Start = minutesOf(start)
		}
		if d.Equal(eDay) && !end.Equal(dayStart(end)) {
			e.End = minutesOf(end)
		}
		if e.End > e.Start {
			add(e)
		}
	}
	return out
}

func dayStart(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func minutesOf(t time.Time) int {
	return t.Hour()*60 + t.Minute()
}

// clip обрезает строку до n символов (рун) с многоточием и убирает переводы строк.
func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// NewEventComponent собирает VEVENT для записи в CalDAV или экспорта в ленту.
// Время — в UTC: так его одинаково понимают все клиенты без VTIMEZONE.
func NewEventComponent(uid string, it Item, now time.Time) *Component {
	ev := &Component{Name: "VEVENT"}
	ev.Props = append(ev.Props,
		Prop{Name: "UID", Value: uid},
		Prop{Name: "DTSTAMP", Value: now.UTC().Format(icalUTC)},
	)
	applyItem(ev, it, now)
	return ev
}

// applyItem записывает в VEVENT название, место и время, не трогая остальные свойства.
func applyItem(ev *Component, it Item, now time.Time) {
	ev.Set(Prop{Name: "SUMMARY", Value: EscapeText(it.Title)})
	if it.Location != "" {
		ev.Set(Prop{Name: "LOCATION", Value: EscapeText(it.Location)})
	} else {
		ev.Del("LOCATION")
	}
	ev.Del("DURATION")
	ev.Set(Prop{Name: "DTSTART", Value: it.Start.UTC().Format(icalUTC)})
	ev.Set(Prop{Name: "DTEND", Value: it.End.UTC().Format(icalUTC)})
	ev.Set(Prop{Name: "DTSTAMP", Value: now.UTC().Format(icalUTC)})
	ev.Set(Prop{Name: "LAST-MODIFIED", Value: now.UTC().Format(icalUTC)})
}

// NewCalendar оборачивает события в VCALENDAR.
func NewCalendar(name string, events ...*Component) *Component {
	cal := &Component{Name: "VCALENDAR", Props: []Prop{
		{Name: "VERSION", Value: "2.0"},
		{Name: "PRODID", Value: "-//AI Calendar//RU"},
		{Name: "CALSCALE", Value: "GREGORIAN"},
	}}
	if name != "" {
		cal.Props = append(cal.Props,
			Prop{Name: "X-WR-CALNAME", Value: EscapeText(name)},
			Prop{Name: "REFRESH-INTERVAL", Params: map[string]string{"VALUE": "DURATION"}, Value: "PT1H"},
			Prop{Name: "X-PUBLISHED-TTL", Value: "PT1H"},
		)
	}
	cal.Children = events
	return cal
}
