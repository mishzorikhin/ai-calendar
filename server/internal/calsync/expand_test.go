package calsync

import (
	"strings"
	"testing"
	"time"
)

var moscow = mustZone("Europe/Moscow")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// expandOne разворачивает один VEVENT (тело без BEGIN/END) в окне.
func expandOne(t *testing.T, body string, from, to time.Time) []Occurrence {
	t.Helper()
	src := "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:e1\nSUMMARY:Тест\n" + body + "\nEND:VEVENT\nEND:VCALENDAR"
	return Expand(mustParse(t, src), from, to, moscow)
}

func starts(occ []Occurrence, layout string) string {
	var out []string
	for _, o := range occ {
		out = append(out, o.Start.Format(layout))
	}
	return strings.Join(out, " ")
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, moscow) }

func TestExpandSingleAndWindow(t *testing.T) {
	occ := expandOne(t, "DTSTART:20261021T060000Z\nDTEND:20261021T070000Z", day(2026, 10, 1), day(2026, 11, 1))
	if len(occ) != 1 || occ[0].Recurrence != "" || occ[0].Start.In(moscow).Hour() != 9 {
		t.Fatalf("одиночное: %+v", occ)
	}
	if got := expandOne(t, "DTSTART:20261021T060000Z", day(2026, 11, 1), day(2026, 12, 1)); len(got) != 0 {
		t.Fatalf("вне окна: %+v", got)
	}
}

func TestExpandDailyCountAndExdate(t *testing.T) {
	occ := expandOne(t, `DTSTART;TZID=Europe/Moscow:20261019T090000
DTEND;TZID=Europe/Moscow:20261019T093000
RRULE:FREQ=DAILY;COUNT=5
EXDATE;TZID=Europe/Moscow:20261021T090000`, day(2026, 10, 1), day(2026, 12, 1))
	if got := starts(occ, "02"); got != "19 20 22 23" {
		t.Fatalf("COUNT=5 минус EXDATE: %s", got)
	}
	if occ[1].End.Sub(occ[1].Start) != 30*time.Minute || occ[1].Recurrence != "20261020T060000Z" {
		t.Fatalf("длительность/ключ: %+v", occ[1])
	}
}

func TestExpandWeeklyByDayUntil(t *testing.T) {
	occ := expandOne(t, `DTSTART;TZID=Europe/Moscow:20261019T190000
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261115T000000Z`, day(2026, 10, 1), day(2026, 12, 31))
	if got := starts(occ, "01-02"); got != "10-19 10-22 11-02 11-05" {
		t.Fatalf("раз в две недели по пн и чт: %s", got)
	}
}

func TestExpandMonthlyLastFridayAndSetPos(t *testing.T) {
	occ := expandOne(t, "DTSTART;VALUE=DATE:20261030\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3", day(2026, 10, 1), day(2027, 6, 1))
	if got := starts(occ, "2006-01-02"); got != "2026-10-30 2026-11-27 2026-12-25" {
		t.Fatalf("последняя пятница: %s", got)
	}
	if !occ[0].AllDay || occ[0].End.Sub(occ[0].Start) != 24*time.Hour {
		t.Fatalf("весь день: %+v", occ[0])
	}
	// Последний рабочий день месяца.
	occ = expandOne(t, "DTSTART;TZID=Europe/Moscow:20261030T180000\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3",
		day(2026, 10, 1), day(2027, 6, 1))
	if got := starts(occ, "01-02"); got != "10-30 11-30 12-31" {
		t.Fatalf("BYSETPOS=-1: %s", got)
	}
}

func TestExpandMonthlyDaySkipsShortMonths(t *testing.T) {
	occ := expandOne(t, "DTSTART;TZID=Europe/Moscow:20270131T100000\nRRULE:FREQ=MONTHLY;COUNT=3", day(2027, 1, 1), day(2027, 12, 1))
	if got := starts(occ, "01-02"); got != "01-31 03-31 05-31" {
		t.Fatalf("31-е число: %s", got)
	}
}

func TestExpandYearlyBirthday(t *testing.T) {
	occ := expandOne(t, "DTSTART;VALUE=DATE:19900315\nDTEND;VALUE=DATE:19900316\nRRULE:FREQ=YEARLY", day(2026, 10, 1), day(2028, 1, 1))
	if got := starts(occ, "2006-01-02"); got != "2027-03-15" {
		t.Fatalf("день рождения: %s", got)
	}
}

func TestExpandOverridesAndCancelled(t *testing.T) {
	src := `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:s1
SUMMARY:Планёрка
DTSTART;TZID=Europe/Moscow:20261019T100000
DTEND;TZID=Europe/Moscow:20261019T103000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:s1
RECURRENCE-ID;TZID=Europe/Moscow:20261020T100000
SUMMARY:Планёрка (перенесли)
DTSTART;TZID=Europe/Moscow:20261020T150000
DTEND;TZID=Europe/Moscow:20261020T153000
END:VEVENT
BEGIN:VEVENT
UID:s1
RECURRENCE-ID;TZID=Europe/Moscow:20261021T100000
STATUS:CANCELLED
DTSTART;TZID=Europe/Moscow:20261021T100000
END:VEVENT
END:VCALENDAR`
	occ := Expand(mustParse(t, src), day(2026, 10, 1), day(2026, 11, 1), moscow)
	if len(occ) != 2 {
		t.Fatalf("ждали 2 вхождения: %+v", occ)
	}
	if occ[1].Title != "Планёрка (перенесли)" || occ[1].Start.In(moscow).Hour() != 15 {
		t.Fatalf("перенесённое вхождение: %+v", occ[1])
	}
}

func TestExpandKeepsWallClockAcrossDST(t *testing.T) {
	berlin := mustZone("Europe/Berlin")
	src := "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:d\nDTSTART;TZID=Europe/Berlin:20270326T090000\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR"
	occ := Expand(mustParse(t, src), time.Date(2027, 3, 1, 0, 0, 0, 0, berlin), time.Date(2027, 4, 1, 0, 0, 0, 0, berlin), berlin)
	for _, o := range occ {
		if o.Start.In(berlin).Hour() != 9 {
			t.Fatalf("после перехода на летнее время встреча уехала: %v", o.Start.In(berlin))
		}
	}
	if len(occ) != 3 {
		t.Fatalf("вхождений: %d", len(occ))
	}
}

func TestExpandUnsupportedRuleShowsFirst(t *testing.T) {
	occ := expandOne(t, "DTSTART:20261021T060000Z\nRRULE:FREQ=YEARLY;BYWEEKNO=20", day(2026, 10, 1), day(2028, 1, 1))
	if len(occ) != 1 {
		t.Fatalf("неподдержанное правило: %+v", occ)
	}
}
