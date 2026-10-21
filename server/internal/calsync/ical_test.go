package calsync

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func mustParse(t *testing.T, src string) []*Component {
	t.Helper()
	roots, err := Parse(strings.NewReader(strings.ReplaceAll(src, "\n", "\r\n")))
	if err != nil {
		t.Fatal(err)
	}
	return roots
}

func TestParseFoldingParamsEscapes(t *testing.T) {
	roots := mustParse(t, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1@x
SUMMARY:Завтрак с Глебом\, в «Уюте»\; потом
  прогулка
LOCATION;LANGUAGE=ru;X-NOTE="a:b;c":Кафе\nна углу
DTSTART;TZID=Europe/Moscow:20261021T090000
END:VEVENT
END:VCALENDAR`)
	ev := roots[0].Children[0]
	if got := ev.Text("SUMMARY"); got != "Завтрак с Глебом, в «Уюте»; потом прогулка" {
		t.Fatalf("SUMMARY: %q", got)
	}
	loc := ev.Get("LOCATION")
	if loc.Params["X-NOTE"] != "a:b;c" || loc.Params["LANGUAGE"] != "ru" {
		t.Fatalf("параметры: %+v", loc.Params)
	}
	if got := ev.Text("LOCATION"); got != "Кафе\nна углу" {
		t.Fatalf("LOCATION: %q", got)
	}
}

func TestParseRejectsNonCalendar(t *testing.T) {
	if _, err := Parse(strings.NewReader("<html>не календарь</html>")); err == nil {
		t.Fatal("ожидали ошибку для HTML")
	}
}

func TestEncodeFoldsAndRoundTrips(t *testing.T) {
	title := strings.Repeat("Очень длинное название встречи, ", 6)
	ev := NewEventComponent("uid-1", Item{
		Title:    title,
		Location: "Офис; 3 этаж",
		Start:    time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC),
		End:      time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC),
	}, time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC))
	out := Encode(NewCalendar("Мой", ev))
	for _, line := range bytes.Split(out, []byte("\r\n")) {
		if len(line) > 75 {
			t.Fatalf("строка длиннее 75 байт: %q", line)
		}
	}
	roots, err := Parse(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	got := roots[0].Children[0]
	if got.Text("SUMMARY") != title || got.Text("LOCATION") != "Офис; 3 этаж" {
		t.Fatalf("после разбора: %q / %q", got.Text("SUMMARY"), got.Text("LOCATION"))
	}
	if got.Get("DTSTART").Value != "20261021T090000Z" {
		t.Fatalf("DTSTART: %s", got.Get("DTSTART").Value)
	}
}

func TestParseDuration(t *testing.T) {
	cases := map[string]time.Duration{
		"PT1H30M": 90 * time.Minute,
		"P1D":     24 * time.Hour,
		"P1W":     7 * 24 * time.Hour,
		"-PT15M":  -15 * time.Minute,
		"P1DT2H":  26 * time.Hour,
	}
	for in, want := range cases {
		if got, ok := parseDuration(in); !ok || got != want {
			t.Errorf("%s: %v %v", in, got, ok)
		}
	}
	if _, ok := parseDuration("1H"); ok {
		t.Error("без P — не длительность")
	}
}

func TestLoadZone(t *testing.T) {
	def := time.UTC
	for tzid, want := range map[string]string{
		"Europe/Moscow":                        "Europe/Moscow",
		"Russian Standard Time":                "Europe/Moscow",
		"/mozilla.org/20050126_1/Europe/Paris": "Europe/Paris",
		"Нет такого":                           "UTC",
	} {
		if got := LoadZone(tzid, def).String(); got != want {
			t.Errorf("%s → %s, ждали %s", tzid, got, want)
		}
	}
}
