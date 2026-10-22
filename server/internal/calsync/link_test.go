package calsync

import (
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

func TestEventLinkAndNotes(t *testing.T) {
	if got := eventLink("", "Подключайтесь: https://meet.google.com/abc-defg-hij.", "Офис"); got != "https://meet.google.com/abc-defg-hij" {
		t.Errorf("ссылка из описания: %q", got)
	}
	if got := eventLink("", "Сайт https://example.com/about", ""); got != "" {
		t.Errorf("обычная ссылка — не созвон: %q", got)
	}
	if got := eventLink("https://own.example/x", "https://zoom.us/j/1"); got != "https://own.example/x" {
		t.Errorf("своя ссылка важнее: %q", got)
	}
	if got := eventLink("javascript:alert(1)", ""); got != "" {
		t.Errorf("не http: %q", got)
	}
	evs := ToEvents(Occurrence{ExternalID: "1", Title: "Созвон", Notes: "  Повестка\r\nвторая строка ", Location: "https://telemost.yandex.ru/j/42",
		Start: time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC), End: time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)}, time.UTC, "2026-10-01", "2026-10-31")
	if len(evs) != 1 || evs[0].Notes != "Повестка\nвторая строка" || evs[0].URL != "https://telemost.yandex.ru/j/42" {
		t.Fatalf("ToEvents: %+v", evs)
	}
	// Чужие заметки обратно не пишем; свои — пишем.
	ext, _ := ItemOf(model.Event{Date: "2026-10-21", Start: 600, End: 660, Source: "cal-1", Notes: "чужое"}, time.UTC)
	own, _ := ItemOf(model.Event{Date: "2026-10-21", Start: 600, End: 660, Notes: "своё", EndDate: "2026-10-22"}, time.UTC)
	if ext.Notes != "" || own.Notes != "своё" || own.End.Day() != 22 {
		t.Fatalf("ItemOf: %+v %+v", ext, own)
	}
}
