package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/seed"
)

func TestPersistence(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ev, err := s.CreateEvent(model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660, Badge: model.BadgeRoutine})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreateBooking(model.Booking{Place: seed.Places[0], Date: "2026-10-21", Start: 540, End: 630, Guests: 2})
	if err != nil {
		t.Fatal(err)
	}
	if b.Code != "A-4821" || b.Status != model.BookingConfirmed {
		t.Fatalf("бронь: %+v", b)
	}
	if _, err := s.AddMessage(model.RoleUser, "Привет"); err != nil {
		t.Fatal(err)
	}

	// Новое открытие читает то же самое с диска.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s2.EventsOn("2026-10-20"); len(got) != 1 || got[0].ID != ev.ID {
		t.Fatalf("события после перезапуска: %+v", got)
	}
	if got := s2.Messages(); len(got) != 2 || got[1].ID != 1 {
		t.Fatalf("сообщения после перезапуска: %+v", got)
	}
	if _, err := s2.CancelBooking(b.ID); err != nil {
		t.Fatal(err)
	}
	if got := s2.Bookings()[0].Status; got != model.BookingCancelled {
		t.Fatalf("статус: %s", got)
	}
}

func TestNotFound(t *testing.T) {
	s, _ := Open("")
	if err := s.DeleteEvent("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидали ErrNotFound, получили %v", err)
	}
	if _, err := s.CancelBooking("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидали ErrNotFound, получили %v", err)
	}
}

// Если запись на диск не удалась, изменение не остаётся в памяти.
func TestRollbackOnSaveError(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Каталог на месте временного файла делает запись невозможной.
	if err := os.Mkdir(filepath.Join(dir, "data.json.tmp"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateEvent(model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660}); err == nil {
		t.Fatal("ожидали ошибку записи")
	}
	if _, err := s.AddMessage(model.RoleUser, "Привет"); err == nil {
		t.Fatal("ожидали ошибку записи")
	}
	if got := s.EventsOn("2026-10-20"); len(got) != 0 {
		t.Fatalf("событие осталось в памяти: %+v", got)
	}
	if got := s.Messages(); len(got) != 1 {
		t.Fatalf("сообщение осталось в памяти: %+v", got)
	}
}

func TestBookingOverlap(t *testing.T) {
	s, _ := Open("")
	book := func(start, end int) error {
		_, err := s.CreateBooking(model.Booking{Place: seed.Places[0], Date: "2026-10-21", Start: start, End: end, Guests: 2})
		return err
	}
	if err := book(540, 630); err != nil {
		t.Fatal(err)
	}
	if err := book(600, 700); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидали ErrConflict, получили %v", err)
	}
	if err := book(630, 700); err != nil {
		t.Fatalf("смежная бронь: %v", err)
	}
	// Отменённая бронь время не занимает.
	first := s.Bookings()[1]
	if _, err := s.CancelBooking(first.ID); err != nil {
		t.Fatal(err)
	}
	if err := book(540, 630); err != nil {
		t.Fatalf("после отмены: %v", err)
	}
}
