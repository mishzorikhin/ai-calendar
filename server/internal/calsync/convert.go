package calsync

import (
	"fmt"
	"regexp"
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
	// AllDay — на весь день: в iCalendar пишется датой (VALUE=DATE), а не временем.
	AllDay bool
	// Notes и URL — заметки и ссылка события приложения (DESCRIPTION, URL).
	Notes string
	URL   string
}

// Ref — ссылка на событие во внешнем календаре и его версия.
type Ref struct {
	ID   string
	ETag string
}

// ItemOf переводит событие приложения (дата + минуты в поясе loc) во время.
// У многодневного события конец — в его последний день (EndDate).
func ItemOf(e model.Event, loc *time.Location) (Item, bool) {
	d, err := time.ParseInLocation(time.DateOnly, e.Date, loc)
	if err != nil {
		return Item{}, false
	}
	last := d
	if e.EndDate != "" {
		if last, err = time.ParseInLocation(time.DateOnly, e.EndDate, loc); err != nil {
			return Item{}, false
		}
	}
	y, m, day := d.Date()
	ly, lm, lday := last.Date()
	it := Item{
		Title:    e.Title,
		Location: e.Subtitle,
		Start:    time.Date(y, m, day, 0, e.Start, 0, 0, loc),
		End:      time.Date(ly, lm, lday, 0, e.End, 0, 0, loc),
		AllDay:   e.AllDay,
	}
	// Заметки и ссылку пишем только у своих событий: у события подключённого календаря они пришли
	// оттуда (часто урезанные), и запись обратно испортила бы исходное описание.
	if e.Source == "" {
		it.Notes, it.URL = e.Notes, e.URL
	}
	return it, true
}

// maxNotes и maxURL — сколько описания и ссылки берём из внешнего события.
const (
	maxNotes = 2000
	maxURL   = 500
)

// meetingHosts — сервисы видеозвонков: ссылку на них ищем в описании и месте, если URL нет.
var meetingHosts = []string{"meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "telemost.yandex.ru",
	"telemost.360.yandex.ru", "jazz.sber.ru", "salutejazz.ru", "meet.jit.si", "webex.com", "whereby.com", "ktalk.ru"}

var linkRe = regexp.MustCompile(`https?://[^\s<>"']+`)

// eventLink — ссылка события: своя (URL) или первая ссылка на созвон из описания и места.
func eventLink(url string, texts ...string) string {
	if valid := strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://"); valid && len(url) <= maxURL {
		return url
	}
	for _, t := range texts {
		for _, l := range linkRe.FindAllString(t, -1) {
			l = strings.TrimRight(l, ".,);")
			for _, h := range meetingHosts {
				if strings.Contains(l, h) && len(l) <= maxURL {
					return l
				}
			}
		}
	}
	return ""
}

// clipNotes — описание без лишних пробелов по краям, с переводами строк, не длиннее n символов.
func clipNotes(s string, n int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// ToEvents переводит вхождение в события дней пользователя (пояс loc) в окне
// дат [from, to]. Многодневное событие режется по дням; такие части, как и
// события на весь день, доступны только для чтения.
func ToEvents(o Occurrence, loc *time.Location, from, to string) []model.Event {
	base := model.Event{
		Title:      clip(o.Title, maxTitle),
		Subtitle:   clip(o.Location, maxSubtitle),
		Notes:      clipNotes(o.Notes, maxNotes),
		URL:        eventLink(o.URL, o.Notes, o.Location),
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
	if it.AllDay {
		// Дата без времени и пояса: день один и тот же у всех, кто подписан на ленту.
		ev.Set(Prop{Name: "DTSTART", Params: map[string]string{"VALUE": "DATE"}, Value: it.Start.Format("20060102")})
		// Конец — следующий день после последнего (DTEND у дат не включается).
		end := it.End
		if !end.After(it.Start) {
			end = it.Start.AddDate(0, 0, 1)
		}
		ev.Set(Prop{Name: "DTEND", Params: map[string]string{"VALUE": "DATE"}, Value: end.Format("20060102")})
	} else {
		ev.Set(Prop{Name: "DTSTART", Value: it.Start.UTC().Format(icalUTC)})
		ev.Set(Prop{Name: "DTEND", Value: it.End.UTC().Format(icalUTC)})
	}
	// Заметки и ссылку только добавляем: у события чужого календаря своё описание, его не стираем.
	if it.Notes != "" {
		ev.Set(Prop{Name: "DESCRIPTION", Value: EscapeText(it.Notes)})
	}
	if it.URL != "" {
		ev.Set(Prop{Name: "URL", Value: it.URL})
	}
	ev.Set(Prop{Name: "DTSTAMP", Value: now.UTC().Format(icalUTC)})
	ev.Set(Prop{Name: "LAST-MODIFIED", Value: now.UTC().Format(icalUTC)})
}

// NewAlarm — напоминание VALARM за minutes минут до начала: календарь телефона,
// подписанный на ленту, может напомнить сам, без уведомлений приложения.
func NewAlarm(minutes int, title string) *Component {
	trigger := "PT0S"
	if minutes > 0 {
		trigger = fmt.Sprintf("-PT%dM", minutes)
	}
	return &Component{Name: "VALARM", Props: []Prop{
		{Name: "ACTION", Value: "DISPLAY"},
		{Name: "TRIGGER", Value: trigger},
		{Name: "DESCRIPTION", Value: EscapeText(title)},
	}}
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
