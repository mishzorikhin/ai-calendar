package calsync

import (
	"slices"
	"strconv"
	"strings"
	"time"
)

// Occurrence — одно вхождение события внешнего календаря во времени.
type Occurrence struct {
	// UID — идентификатор события в iCalendar (у Google/Outlook — id события).
	UID string
	// Recurrence — ключ вхождения серии («20261021T090000Z»); пусто у одиночного события.
	Recurrence string
	// ExternalID — что хранить в событии: путь ресурса CalDAV, id Google и т. п.
	ExternalID string
	ETag       string
	Title      string
	Location   string
	// Notes — описание события, URL — ссылка (или ссылка на созвон, найденная в описании).
	Notes      string
	URL        string
	Start, End time.Time
	AllDay     bool
	ReadOnly   bool
}

// maxPeriods — предел итераций развёртки одной серии (ежедневное событие с 2000 года — ~10 тыс.).
const maxPeriods = 50_000

// Expand разворачивает события календаря в вхождения, пересекающие [from, to).
// Учитывает RRULE, RDATE, EXDATE, переопределённые вхождения (RECURRENCE-ID)
// и отменённые (STATUS:CANCELLED). def — пояс для «плавающего» времени и дат.
func Expand(roots []*Component, from, to time.Time, def *time.Location) []Occurrence {
	var events []*Component
	var walk func(c *Component)
	walk = func(c *Component) {
		if c.Name == "VEVENT" {
			events = append(events, c)
			return
		}
		for _, ch := range c.Children {
			walk(ch)
		}
	}
	for _, r := range roots {
		walk(r)
	}

	// Переопределения вхождений серии: UID → ключ вхождения → компонент.
	overrides := map[string]map[string]*Component{}
	var masters []*Component
	for _, ev := range events {
		rid := ev.Get("RECURRENCE-ID")
		if rid == nil {
			masters = append(masters, ev)
			continue
		}
		t, allDay, err := parseTime(rid.Value, rid.Params, def)
		if err != nil {
			continue
		}
		uid := ev.Text("UID")
		if overrides[uid] == nil {
			overrides[uid] = map[string]*Component{}
		}
		overrides[uid][instanceKey(t, allDay)] = ev
	}

	var out []Occurrence
	overlaps := func(o Occurrence) bool { return o.End.After(from) && o.Start.Before(to) }
	for _, m := range masters {
		uid := m.Text("UID")
		base, ok := occurrenceOf(m, def)
		if !ok {
			continue
		}
		rule := m.Get("RRULE")
		if rule == nil && len(m.All("RDATE")) == 0 {
			if !isCancelled(m) && overlaps(base) {
				out = append(out, base)
			}
			continue
		}
		starts := []time.Time{base.Start}
		if rule != nil {
			starts = expandRule(rule.Value, base.Start, base.AllDay, to)
		}
		for _, p := range m.All("RDATE") {
			for _, v := range strings.Split(p.Value, ",") {
				if t, _, err := parseTime(v, p.Params, base.Start.Location()); err == nil {
					starts = append(starts, t)
				}
			}
		}
		excluded := map[string]bool{}
		for _, p := range m.All("EXDATE") {
			for _, v := range strings.Split(p.Value, ",") {
				if t, allDay, err := parseTime(v, p.Params, base.Start.Location()); err == nil {
					excluded[instanceKey(t, allDay || base.AllDay)] = true
				}
			}
		}
		slices.SortFunc(starts, func(a, b time.Time) int { return a.Compare(b) })
		starts = slices.CompactFunc(starts, func(a, b time.Time) bool { return a.Equal(b) })
		for _, st := range starts {
			key := instanceKey(st, base.AllDay)
			if excluded[key] {
				continue
			}
			var o Occurrence
			if ov := overrides[uid][key]; ov != nil {
				delete(overrides[uid], key)
				if isCancelled(ov) {
					continue
				}
				var ok bool
				if o, ok = occurrenceOf(ov, def); !ok {
					continue
				}
			} else {
				if isCancelled(m) {
					continue
				}
				o = base
				o.Start = st
				o.End = shiftEnd(base, st)
			}
			o.Recurrence = key
			if overlaps(o) {
				out = append(out, o)
			}
		}
	}
	// Переопределения, у которых нет мастера (сервер прислал только изменённое вхождение)
	// или которые перенесены за пределы правила, показываем как есть.
	for _, byKey := range overrides {
		for key, ov := range byKey {
			if isCancelled(ov) {
				continue
			}
			o, ok := occurrenceOf(ov, def)
			if !ok {
				continue
			}
			o.Recurrence = key
			if overlaps(o) {
				out = append(out, o)
			}
		}
	}
	slices.SortFunc(out, func(a, b Occurrence) int { return a.Start.Compare(b.Start) })
	return out
}

func isCancelled(c *Component) bool {
	return strings.EqualFold(c.Text("STATUS"), "CANCELLED")
}

// instanceKey — ключ вхождения: UTC для времени, дата — для событий на весь день.
func instanceKey(t time.Time, allDay bool) string {
	if allDay {
		return t.Format(icalDate)
	}
	return t.UTC().Format(icalUTC)
}

// occurrenceOf читает одно событие: начало, конец, текст.
func occurrenceOf(c *Component, def *time.Location) (Occurrence, bool) {
	ds := c.Get("DTSTART")
	if ds == nil {
		return Occurrence{}, false
	}
	start, allDay, err := parseTime(ds.Value, ds.Params, def)
	if err != nil {
		return Occurrence{}, false
	}
	o := Occurrence{
		UID:      c.Text("UID"),
		Title:    strings.TrimSpace(c.Text("SUMMARY")),
		Location: strings.TrimSpace(c.Text("LOCATION")),
		Notes:    strings.TrimSpace(c.Text("DESCRIPTION")),
		URL:      strings.TrimSpace(c.Text("URL")),
		Start:    start,
		AllDay:   allDay,
	}
	switch {
	case c.Get("DTEND") != nil:
		de := c.Get("DTEND")
		if end, _, err := parseTime(de.Value, de.Params, start.Location()); err == nil {
			o.End = end
		}
	case c.Get("DURATION") != nil:
		if d, ok := parseDuration(c.Get("DURATION").Value); ok {
			if allDay && d%(24*time.Hour) == 0 {
				o.End = start.AddDate(0, 0, int(d/(24*time.Hour)))
			} else {
				o.End = start.Add(d)
			}
		}
	}
	if o.End.IsZero() || o.End.Before(start) {
		o.End = start
		if allDay {
			o.End = start.AddDate(0, 0, 1)
		}
	}
	if o.Title == "" {
		o.Title = "Без названия"
	}
	return o, true
}

// shiftEnd — конец вхождения серии с той же длительностью, что у первого.
// Для событий на весь день считаем в днях, чтобы переход на летнее время не сдвигал даты.
func shiftEnd(base Occurrence, start time.Time) time.Time {
	if base.AllDay {
		days := int(base.End.Sub(base.Start).Round(24*time.Hour) / (24 * time.Hour))
		return start.AddDate(0, 0, max(days, 1))
	}
	return start.Add(base.End.Sub(base.Start))
}

type byDay struct {
	n  int // порядковый номер: 1 — первый, -1 — последний, 0 — каждый
	wd time.Weekday
}

type rrule struct {
	freq       string
	interval   int
	count      int
	until      time.Time
	byDay      []byDay
	byMonthDay []int
	byMonth    []time.Month
	bySetPos   []int
	// unsupported — правила с BYYEARDAY/BYWEEKNO/BYHOUR: показываем только первое вхождение.
	unsupported bool
}

var weekdays = map[string]time.Weekday{
	"SU": time.Sunday, "MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday,
	"TH": time.Thursday, "FR": time.Friday, "SA": time.Saturday,
}

func parseRule(v string, start time.Time, allDay bool) rrule {
	r := rrule{interval: 1}
	for _, part := range strings.Split(v, ";") {
		k, val, _ := strings.Cut(part, "=")
		switch strings.ToUpper(k) {
		case "FREQ":
			r.freq = strings.ToUpper(val)
		case "INTERVAL":
			if n, err := strconv.Atoi(val); err == nil && n > 0 {
				r.interval = n
			}
		case "COUNT":
			if n, err := strconv.Atoi(val); err == nil && n > 0 {
				r.count = n
			}
		case "UNTIL":
			if t, isDate, err := parseTime(val, nil, start.Location()); err == nil {
				if isDate || allDay {
					// UNTIL-дата включительно: до конца этих суток.
					y, m, d := t.Date()
					t = time.Date(y, m, d, 23, 59, 59, 0, start.Location())
				}
				r.until = t
			}
		case "BYDAY":
			for _, d := range strings.Split(val, ",") {
				d = strings.ToUpper(strings.TrimSpace(d))
				if len(d) < 2 {
					continue
				}
				wd, ok := weekdays[d[len(d)-2:]]
				if !ok {
					continue
				}
				n := 0
				if num := strings.TrimPrefix(d[:len(d)-2], "+"); num != "" {
					n, _ = strconv.Atoi(num)
				}
				r.byDay = append(r.byDay, byDay{n: n, wd: wd})
			}
		case "BYMONTHDAY":
			for _, d := range strings.Split(val, ",") {
				if n, err := strconv.Atoi(d); err == nil && n != 0 && n >= -31 && n <= 31 {
					r.byMonthDay = append(r.byMonthDay, n)
				}
			}
		case "BYMONTH":
			for _, d := range strings.Split(val, ",") {
				if n, err := strconv.Atoi(d); err == nil && n >= 1 && n <= 12 {
					r.byMonth = append(r.byMonth, time.Month(n))
				}
			}
		case "BYSETPOS":
			for _, d := range strings.Split(val, ",") {
				if n, err := strconv.Atoi(d); err == nil && n != 0 {
					r.bySetPos = append(r.bySetPos, n)
				}
			}
		case "BYYEARDAY", "BYWEEKNO", "BYHOUR", "BYMINUTE", "BYSECOND":
			r.unsupported = true
		}
	}
	return r
}

// expandRule — начала вхождений серии от DTSTART до windowEnd (или UNTIL/COUNT).
// Первое вхождение — всегда сам DTSTART (RFC 5545, 3.8.5.3).
func expandRule(value string, start time.Time, allDay bool, windowEnd time.Time) []time.Time {
	r := parseRule(value, start, allDay)
	out := []time.Time{start}
	switch r.freq {
	case "DAILY", "WEEKLY", "MONTHLY", "YEARLY":
	default:
		return out
	}
	if r.unsupported {
		return out
	}
	loc := start.Location()
	h, mi, s := start.Clock()
	y0, m0, d0 := start.Date()
	mk := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, h, mi, s, 0, loc) }

	count := 1
	done := false
	emit := func(t time.Time) {
		if done || !t.After(start) {
			return
		}
		if (!r.until.IsZero() && t.After(r.until)) || t.After(windowEnd) {
			done = true
			return
		}
		if r.count > 0 && count >= r.count {
			done = true
			return
		}
		count++
		out = append(out, t)
	}
	inMonths := func(t time.Time) bool { return len(r.byMonth) == 0 || slices.Contains(r.byMonth, t.Month()) }

	for i := 0; i < maxPeriods && !done; i++ {
		var cands []time.Time
		var periodStart time.Time
		switch r.freq {
		case "DAILY":
			t := mk(y0, m0, d0+i*r.interval)
			periodStart = t
			if inMonths(t) && matchMonthDay(t, r.byMonthDay) && matchWeekday(t, r.byDay) {
				cands = []time.Time{t}
			}
		case "WEEKLY":
			// Неделя начинается с понедельника (WKST=MO по умолчанию у большинства клиентов).
			offset := (int(start.Weekday()) + 6) % 7
			ws := mk(y0, m0, d0-offset+7*i*r.interval)
			periodStart = ws
			days := r.byDay
			if len(days) == 0 {
				days = []byDay{{wd: start.Weekday()}}
			}
			for _, bd := range days {
				t := mk(ws.Year(), ws.Month(), ws.Day()+(int(bd.wd)+6)%7)
				if inMonths(t) {
					cands = append(cands, t)
				}
			}
		case "MONTHLY":
			first := mk(y0, m0+time.Month(i*r.interval), 1)
			periodStart = first
			if inMonths(first) {
				cands = monthCandidates(first, r, d0, mk)
			}
		case "YEARLY":
			year := y0 + i*r.interval
			periodStart = mk(year, 1, 1)
			switch {
			case len(r.byMonth) == 0 && len(r.byDay) > 0 && len(r.byMonthDay) == 0:
				// BYDAY без BYMONTH — номер дня недели в году («20MO»).
				cands = nthWeekdays(mk(year, 1, 1), mk(year+1, 1, 1), r.byDay, mk)
			default:
				months := r.byMonth
				if len(months) == 0 {
					months = []time.Month{m0}
				}
				for _, m := range months {
					cands = append(cands, monthCandidates(mk(year, m, 1), r, d0, mk)...)
				}
			}
		}
		if periodStart.After(windowEnd) || (!r.until.IsZero() && periodStart.After(r.until)) {
			break
		}
		slices.SortFunc(cands, func(a, b time.Time) int { return a.Compare(b) })
		cands = slices.CompactFunc(cands, func(a, b time.Time) bool { return a.Equal(b) })
		for _, t := range applySetPos(cands, r.bySetPos) {
			emit(t)
		}
	}
	return out
}

// monthCandidates — дни месяца по BYMONTHDAY/BYDAY; без них — тот же день месяца, что у DTSTART.
func monthCandidates(first time.Time, r rrule, day int, mk func(int, time.Month, int) time.Time) []time.Time {
	y, m := first.Year(), first.Month()
	dim := daysIn(y, m)
	var out []time.Time
	switch {
	case len(r.byMonthDay) > 0:
		for _, md := range r.byMonthDay {
			d := md
			if d < 0 {
				d = dim + md + 1
			}
			if d < 1 || d > dim {
				continue
			}
			t := mk(y, m, d)
			if matchWeekday(t, r.byDay) {
				out = append(out, t)
			}
		}
	case len(r.byDay) > 0:
		out = nthWeekdays(first, mk(y, m+1, 1), r.byDay, mk)
	default:
		if day <= dim {
			out = append(out, mk(y, m, day))
		}
	}
	return out
}

// nthWeekdays — дни недели в [from, to): все («MO») или с номером («2TU», «-1FR»).
func nthWeekdays(from, to time.Time, days []byDay, mk func(int, time.Month, int) time.Time) []time.Time {
	var out []time.Time
	for _, bd := range days {
		var all []time.Time
		for t := from; t.Before(to); t = mk(t.Year(), t.Month(), t.Day()+1) {
			if t.Weekday() == bd.wd {
				all = append(all, t)
			}
		}
		switch {
		case bd.n == 0:
			out = append(out, all...)
		case bd.n > 0 && bd.n <= len(all):
			out = append(out, all[bd.n-1])
		case bd.n < 0 && -bd.n <= len(all):
			out = append(out, all[len(all)+bd.n])
		}
	}
	return out
}

func matchWeekday(t time.Time, days []byDay) bool {
	if len(days) == 0 {
		return true
	}
	return slices.ContainsFunc(days, func(bd byDay) bool { return bd.wd == t.Weekday() })
}

func matchMonthDay(t time.Time, days []int) bool {
	if len(days) == 0 {
		return true
	}
	dim := daysIn(t.Year(), t.Month())
	return slices.ContainsFunc(days, func(md int) bool {
		if md < 0 {
			md = dim + md + 1
		}
		return md == t.Day()
	})
}

func applySetPos(cands []time.Time, pos []int) []time.Time {
	if len(pos) == 0 {
		return cands
	}
	var out []time.Time
	for _, p := range pos {
		switch {
		case p > 0 && p <= len(cands):
			out = append(out, cands[p-1])
		case p < 0 && -p <= len(cands):
			out = append(out, cands[len(cands)+p])
		}
	}
	slices.SortFunc(out, func(a, b time.Time) int { return a.Compare(b) })
	return out
}

func daysIn(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}
