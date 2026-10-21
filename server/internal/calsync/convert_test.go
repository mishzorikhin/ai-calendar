package calsync

import (
	"strings"
	"testing"
	"time"
)

func TestToEventsSingleDay(t *testing.T) {
	o := Occurrence{ExternalID: "x", Title: "Завтрак", Location: "Кафе",
		Start: time.Date(2026, 10, 21, 6, 0, 0, 0, time.UTC), End: time.Date(2026, 10, 21, 7, 30, 0, 0, time.UTC)}
	evs := ToEvents(o, moscow, "2026-10-01", "2026-12-31")
	if len(evs) != 1 {
		t.Fatalf("%+v", evs)
	}
	e := evs[0]
	if e.Date != "2026-10-21" || e.Start != 9*60 || e.End != 10*60+30 || e.ExternalID != "x" || e.ReadOnly || e.Subtitle != "Кафе" {
		t.Fatalf("событие: %+v", e)
	}
}

func TestToEventsMidnightAndZeroLength(t *testing.T) {
	// 23:00–01:00 по Москве: две части, обе только для чтения.
	o := Occurrence{ExternalID: "n", Title: "Ночь", Start: time.Date(2026, 10, 21, 20, 0, 0, 0, time.UTC), End: time.Date(2026, 10, 21, 22, 0, 0, 0, time.UTC)}
	evs := ToEvents(o, moscow, "2026-10-01", "2026-12-31")
	if len(evs) != 2 || evs[0].Date != "2026-10-21" || evs[0].Start != 23*60 || evs[0].End != 1440 ||
		evs[1].Date != "2026-10-22" || evs[1].Start != 0 || evs[1].End != 60 || !evs[0].ReadOnly || evs[1].ExternalID != "n@2026-10-22" {
		t.Fatalf("через полночь: %+v", evs)
	}
	// До ровно полуночи — одна часть до 24:00.
	o = Occurrence{ExternalID: "m", Start: time.Date(2026, 10, 21, 19, 0, 0, 0, time.UTC), End: time.Date(2026, 10, 21, 21, 0, 0, 0, time.UTC)}
	evs = ToEvents(o, moscow, "2026-10-01", "2026-12-31")
	if len(evs) != 1 || evs[0].End != 1440 || evs[0].ReadOnly {
		t.Fatalf("до полуночи: %+v", evs)
	}
	// Нулевая длительность — получасовое событие.
	o = Occurrence{ExternalID: "z", Start: time.Date(2026, 10, 21, 6, 0, 0, 0, time.UTC), End: time.Date(2026, 10, 21, 6, 0, 0, 0, time.UTC)}
	if evs = ToEvents(o, moscow, "2026-10-01", "2026-12-31"); evs[0].End-evs[0].Start != 30 {
		t.Fatalf("нулевая длительность: %+v", evs)
	}
}

func TestToEventsAllDay(t *testing.T) {
	o := Occurrence{ExternalID: "v", Title: "Отпуск", AllDay: true,
		Start: time.Date(2026, 10, 30, 0, 0, 0, 0, moscow), End: time.Date(2026, 11, 2, 0, 0, 0, 0, moscow)}
	evs := ToEvents(o, moscow, "2026-10-01", "2026-10-31")
	// Окно до 31-го: из трёх дней остаются два.
	if len(evs) != 2 || !evs[0].AllDay || !evs[0].ReadOnly || evs[0].End != 1440 || evs[1].Date != "2026-10-31" || evs[1].ExternalID != "v@2026-10-31" {
		t.Fatalf("весь день: %+v", evs)
	}
}

func TestToEventsClipsLongText(t *testing.T) {
	o := Occurrence{ExternalID: "l", Title: strings.Repeat("я", 300), Start: time.Date(2026, 10, 21, 6, 0, 0, 0, time.UTC), End: time.Date(2026, 10, 21, 7, 0, 0, 0, time.UTC)}
	evs := ToEvents(o, moscow, "2026-10-01", "2026-12-31")
	if n := len([]rune(evs[0].Title)); n != maxTitle {
		t.Fatalf("длина названия %d", n)
	}
}

func TestNormalizeURL(t *testing.T) {
	for in, want := range map[string]string{
		"webcal://example.com/a.ics": "https://example.com/a.ics",
		"caldav.yandex.ru":           "https://caldav.yandex.ru",
		"http://x.org/cal":           "http://x.org/cal",
	} {
		if got, err := NormalizeURL(in); err != nil || got != want {
			t.Errorf("%s → %s %v", in, got, err)
		}
	}
	if _, err := NormalizeURL("ftp://x"); err == nil {
		t.Error("ftp — не календарь")
	}
}
