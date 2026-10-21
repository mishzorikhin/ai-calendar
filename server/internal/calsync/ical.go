package calsync

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Component — узел iCalendar (VCALENDAR, VEVENT, VTIMEZONE…). Свойства хранятся
// как есть, поэтому неизвестные (будильники, участники) переживают правку события.
type Component struct {
	Name     string
	Props    []Prop
	Children []*Component
}

// Prop — строка свойства: NAME;PARAM=VALUE:значение.
type Prop struct {
	Name   string
	Params map[string]string
	Value  string
}

// Get — первое свойство с именем или nil.
func (c *Component) Get(name string) *Prop {
	for i := range c.Props {
		if c.Props[i].Name == name {
			return &c.Props[i]
		}
	}
	return nil
}

// All — все свойства с именем (EXDATE, RDATE бывают повторены).
func (c *Component) All(name string) []Prop {
	var out []Prop
	for _, p := range c.Props {
		if p.Name == name {
			out = append(out, p)
		}
	}
	return out
}

// Text — значение текстового свойства без экранирования.
func (c *Component) Text(name string) string {
	if p := c.Get(name); p != nil {
		return unescapeText(p.Value)
	}
	return ""
}

// Set заменяет свойство (или добавляет, если его не было).
func (c *Component) Set(p Prop) {
	c.Del(p.Name)
	c.Props = append(c.Props, p)
}

// Del удаляет все свойства с именем.
func (c *Component) Del(name string) {
	out := c.Props[:0]
	for _, p := range c.Props {
		if p.Name != name {
			out = append(out, p)
		}
	}
	c.Props = out
}

// maxICSBytes — предел размера разбираемого календаря.
const maxICSBytes = 10 << 20

// Parse читает iCalendar и возвращает корневые компоненты (обычно один VCALENDAR).
func Parse(r io.Reader) ([]*Component, error) {
	lines, err := unfold(io.LimitReader(r, maxICSBytes))
	if err != nil {
		return nil, err
	}
	var roots []*Component
	var stack []*Component
	for _, line := range lines {
		p, ok := parseLine(line)
		if !ok {
			continue // битые строки пропускаем: календари в дикой природе неаккуратны
		}
		switch p.Name {
		case "BEGIN":
			c := &Component{Name: strings.ToUpper(p.Value)}
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, c)
			} else {
				roots = append(roots, c)
			}
			stack = append(stack, c)
		case "END":
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		default:
			if len(stack) > 0 {
				top := stack[len(stack)-1]
				top.Props = append(top.Props, p)
			}
		}
	}
	if len(roots) == 0 {
		return nil, errors.New("это не календарь iCalendar")
	}
	return roots, nil
}

// unfold склеивает продолженные строки (CRLF + пробел/таб) и отбрасывает пустые.
func unfold(r io.Reader) ([]string, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	var out []string
	first := true
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if first {
			line = strings.TrimPrefix(line, "\uFEFF")
			first = false
		}
		if line == "" {
			continue
		}
		if (line[0] == ' ' || line[0] == '\t') && len(out) > 0 {
			out[len(out)-1] += line[1:]
			continue
		}
		out = append(out, line)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("чтение календаря: %w", err)
	}
	return out, nil
}

// parseLine разбирает «NAME;P1=a;P2="b:c":value» с учётом кавычек в параметрах.
func parseLine(line string) (Prop, bool) {
	inQuote := false
	nameEnd, valueStart := -1, -1
	for i, ch := range line {
		switch {
		case ch == '"':
			inQuote = !inQuote
		case ch == ';' && !inQuote && nameEnd < 0:
			nameEnd = i
		case ch == ':' && !inQuote:
			valueStart = i
		}
		if valueStart >= 0 {
			break
		}
	}
	if valueStart < 0 {
		return Prop{}, false
	}
	if nameEnd < 0 {
		nameEnd = valueStart
	}
	p := Prop{Name: strings.ToUpper(line[:nameEnd]), Value: line[valueStart+1:]}
	if p.Name == "" {
		return Prop{}, false
	}
	if nameEnd < valueStart {
		p.Params = parseParams(line[nameEnd+1 : valueStart])
	}
	return p, true
}

func parseParams(s string) map[string]string {
	out := map[string]string{}
	inQuote := false
	start := 0
	add := func(part string) {
		k, v, ok := strings.Cut(part, "=")
		if ok {
			out[strings.ToUpper(k)] = strings.Trim(v, `"`)
		}
	}
	for i, ch := range s {
		switch {
		case ch == '"':
			inQuote = !inQuote
		case ch == ';' && !inQuote:
			add(s[start:i])
			start = i + 1
		}
	}
	add(s[start:])
	return out
}

func unescapeText(v string) string {
	if !strings.Contains(v, `\`) {
		return v
	}
	var b strings.Builder
	for i := 0; i < len(v); i++ {
		if v[i] == '\\' && i+1 < len(v) {
			i++
			switch v[i] {
			case 'n', 'N':
				b.WriteByte('\n')
			default:
				b.WriteByte(v[i])
			}
			continue
		}
		b.WriteByte(v[i])
	}
	return b.String()
}

// EscapeText экранирует текст для SUMMARY/LOCATION/DESCRIPTION.
func EscapeText(v string) string {
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`)
	return r.Replace(v)
}

// Encode пишет компонент в формате iCalendar: CRLF, строки не длиннее 75 байт.
func Encode(c *Component) []byte {
	var buf bytes.Buffer
	encode(&buf, c)
	return buf.Bytes()
}

func encode(buf *bytes.Buffer, c *Component) {
	writeFolded(buf, "BEGIN:"+c.Name)
	for _, p := range c.Props {
		writeFolded(buf, propLine(p))
	}
	for _, ch := range c.Children {
		encode(buf, ch)
	}
	writeFolded(buf, "END:"+c.Name)
}

func propLine(p Prop) string {
	var b strings.Builder
	b.WriteString(p.Name)
	// Параметры — в стабильном порядке, чтобы вывод не прыгал между запусками.
	keys := make([]string, 0, len(p.Params))
	for k := range p.Params {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		v := p.Params[k]
		if strings.ContainsAny(v, ":;,") {
			v = `"` + v + `"`
		}
		b.WriteString(";" + k + "=" + v)
	}
	b.WriteString(":" + p.Value)
	return b.String()
}

// writeFolded переносит длинные строки, не разрывая символы UTF-8.
func writeFolded(buf *bytes.Buffer, line string) {
	const limit = 75
	first := true
	for len(line) > 0 {
		max := limit
		if !first {
			max = limit - 1 // пробел продолжения тоже считается
		}
		if len(line) <= max {
			if !first {
				buf.WriteByte(' ')
			}
			buf.WriteString(line)
			break
		}
		cut := max
		for cut > 0 && !utf8.RuneStart(line[cut]) {
			cut--
		}
		if !first {
			buf.WriteByte(' ')
		}
		buf.WriteString(line[:cut])
		buf.WriteString("\r\n")
		line = line[cut:]
		first = false
	}
	buf.WriteString("\r\n")
}

// Формы даты-времени iCalendar.
const (
	icalUTC   = "20060102T150405Z"
	icalLocal = "20060102T150405"
	icalDate  = "20060102"
)

// parseTime читает DTSTART/DTEND/EXDATE: дату (весь день), UTC, время с TZID
// или «плавающее» время (в поясе пользователя). allDay — значение было датой.
func parseTime(value string, params map[string]string, def *time.Location) (t time.Time, allDay bool, err error) {
	value = strings.TrimSpace(value)
	if params["VALUE"] == "DATE" || (len(value) == 8 && !strings.Contains(value, "T")) {
		d, err := time.ParseInLocation(icalDate, value, def)
		return d, true, err
	}
	if strings.HasSuffix(value, "Z") {
		t, err := time.Parse(icalUTC, value)
		return t, false, err
	}
	loc := def
	if tzid := params["TZID"]; tzid != "" {
		loc = LoadZone(tzid, def)
	}
	t, err = time.ParseInLocation(icalLocal, value, loc)
	return t, false, err
}

// parseDuration — DURATION вида P1D, PT1H30M, P2W, -PT15M.
func parseDuration(v string) (time.Duration, bool) {
	v = strings.TrimSpace(v)
	neg := false
	switch {
	case strings.HasPrefix(v, "-"):
		neg = true
		v = v[1:]
	case strings.HasPrefix(v, "+"):
		v = v[1:]
	}
	if !strings.HasPrefix(v, "P") {
		return 0, false
	}
	v = v[1:]
	var total time.Duration
	inTime := false
	num := 0
	seen := false
	for _, ch := range v {
		switch {
		case ch == 'T':
			inTime = true
		case ch >= '0' && ch <= '9':
			num = num*10 + int(ch-'0')
			seen = true
		default:
			if !seen {
				return 0, false
			}
			var unit time.Duration
			switch {
			case ch == 'W':
				unit = 7 * 24 * time.Hour
			case ch == 'D':
				unit = 24 * time.Hour
			case ch == 'H' && inTime:
				unit = time.Hour
			case ch == 'M' && inTime:
				unit = time.Minute
			case ch == 'S' && inTime:
				unit = time.Second
			default:
				return 0, false
			}
			total += time.Duration(num) * unit
			num, seen = 0, false
		}
	}
	if neg {
		total = -total
	}
	return total, true
}

// windowsZones — частые Windows-имена поясов, которые Outlook пишет в TZID.
var windowsZones = map[string]string{
	"Russian Standard Time":         "Europe/Moscow",
	"Russia Time Zone 3":            "Europe/Samara",
	"Ekaterinburg Standard Time":    "Asia/Yekaterinburg",
	"N. Central Asia Standard Time": "Asia/Novosibirsk",
	"North Asia Standard Time":      "Asia/Krasnoyarsk",
	"North Asia East Standard Time": "Asia/Irkutsk",
	"Yakutsk Standard Time":         "Asia/Yakutsk",
	"Vladivostok Standard Time":     "Asia/Vladivostok",
	"Kaliningrad Standard Time":     "Europe/Kaliningrad",
	"Belarus Standard Time":         "Europe/Minsk",
	"FLE Standard Time":             "Europe/Kiev",
	"GTB Standard Time":             "Europe/Bucharest",
	"W. Europe Standard Time":       "Europe/Berlin",
	"Central Europe Standard Time":  "Europe/Budapest",
	"Romance Standard Time":         "Europe/Paris",
	"GMT Standard Time":             "Europe/London",
	"UTC":                           "UTC",
	"Coordinated Universal Time":    "UTC",
	"Eastern Standard Time":         "America/New_York",
	"Central Standard Time":         "America/Chicago",
	"Mountain Standard Time":        "America/Denver",
	"Pacific Standard Time":         "America/Los_Angeles",
	"Caucasus Standard Time":        "Asia/Yerevan",
	"Georgian Standard Time":        "Asia/Tbilisi",
	"Azerbaijan Standard Time":      "Asia/Baku",
	"West Asia Standard Time":       "Asia/Tashkent",
	"Central Asia Standard Time":    "Asia/Almaty",
	"Arabian Standard Time":         "Asia/Dubai",
	"Turkey Standard Time":          "Europe/Istanbul",
	"Israel Standard Time":          "Asia/Jerusalem",
	"China Standard Time":           "Asia/Shanghai",
	"Tokyo Standard Time":           "Asia/Tokyo",
	"India Standard Time":           "Asia/Kolkata",
}

// LoadZone — пояс по TZID: IANA-имя, Windows-имя или «/Europe/Moscow»
// (так пишут некоторые серверы); неизвестный — пояс по умолчанию.
func LoadZone(tzid string, def *time.Location) *time.Location {
	tzid = strings.Trim(strings.TrimSpace(tzid), "/")
	if tzid == "" {
		return def
	}
	if name, ok := windowsZones[tzid]; ok {
		tzid = name
	}
	if loc, err := time.LoadLocation(tzid); err == nil {
		return loc
	}
	// «/mozilla.org/20050126_1/Europe/Moscow» — берём хвост из двух частей.
	if parts := strings.Split(tzid, "/"); len(parts) >= 2 {
		if loc, err := time.LoadLocation(strings.Join(parts[len(parts)-2:], "/")); err == nil {
			return loc
		}
	}
	return def
}
