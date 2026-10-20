// Package store хранит данные пользователя: события, брони и историю чата.
// Всё лежит в одном JSON-файле, запись атомарная (через временный файл и rename).
// Для прототипа этого достаточно; интерфейс позволяет заменить хранилище на БД.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

var (
	// ErrNotFound — запись не найдена.
	ErrNotFound = errors.New("not found")
	// ErrConflict — время уже занято другой бронью.
	ErrConflict = errors.New("conflict")
)

const firstBookingCode = 4821

type data struct {
	Events   []model.Event   `json:"events"`
	Bookings []model.Booking `json:"bookings"`
	Messages []model.Message `json:"messages"`
	NextID   int             `json:"nextId"`
}

// Store — потокобезопасное хранилище. Пустой path — только в памяти (для тестов).
type Store struct {
	mu   sync.RWMutex
	path string
	d    data
	now  func() time.Time
}

// Open читает файл данных из dir (создаёт при первом запуске). Пустой dir — хранение в памяти.
func Open(dir string) (*Store, error) {
	s := &Store{now: time.Now}
	s.d.NextID = 1
	if dir == "" {
		s.seedGreeting()
		return s, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("создание каталога данных: %w", err)
	}
	s.path = filepath.Join(dir, "data.json")
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		s.seedGreeting()
		return s, s.save()
	case err != nil:
		return nil, fmt.Errorf("чтение данных: %w", err)
	}
	if err := json.Unmarshal(raw, &s.d); err != nil {
		return nil, fmt.Errorf("разбор %s: %w", s.path, err)
	}
	return s, nil
}

func (s *Store) seedGreeting() {
	s.d.Messages = []model.Message{{ID: 0, Role: model.RoleAI, Text: "Чем могу помочь?", CreatedAt: s.now()}}
}

// save вызывается под блокировкой на запись.
func (s *Store) save() error {
	if s.path == "" {
		return nil
	}
	raw, err := json.MarshalIndent(s.d, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("запись данных: %w", err)
	}
	return os.Rename(tmp, s.path)
}

// commit применяет изменение и сохраняет файл; если запись не удалась, состояние откатывается,
// чтобы память не расходилась с диском. Вызывается под блокировкой на запись.
func (s *Store) commit(change func()) error {
	prev := data{
		Events:   slices.Clone(s.d.Events),
		Bookings: slices.Clone(s.d.Bookings),
		Messages: slices.Clone(s.d.Messages),
		NextID:   s.d.NextID,
	}
	change()
	if err := s.save(); err != nil {
		s.d = prev
		return err
	}
	return nil
}

func (s *Store) nextID(prefix string) string {
	id := fmt.Sprintf("%s-%d", prefix, s.d.NextID)
	s.d.NextID++
	return id
}

// EventsOn — события пользователя на дату (YYYY-MM-DD).
func (s *Store) EventsOn(date string) []model.Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		if e.Date == date {
			out = append(out, e)
		}
	}
	return out
}

// EventsInMonth — события пользователя за месяц (префикс YYYY-MM).
func (s *Store) EventsInMonth(prefix string) []model.Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		if len(e.Date) >= len(prefix) && e.Date[:len(prefix)] == prefix {
			out = append(out, e)
		}
	}
	return out
}

func (s *Store) CreateEvent(e model.Event) (model.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.commit(func() {
		e.ID = s.nextID("evt")
		s.d.Events = append(s.d.Events, e)
	}); err != nil {
		return model.Event{}, err
	}
	return e, nil
}

func (s *Store) DeleteEvent(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Events, func(e model.Event) bool { return e.ID == id })
	if i < 0 {
		return ErrNotFound
	}
	return s.commit(func() { s.d.Events = slices.Delete(s.d.Events, i, i+1) })
}

// Bookings — все брони, новые первыми.
func (s *Store) Bookings() []model.Booking {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := slices.Clone(s.d.Bookings)
	slices.Reverse(out)
	return out
}

// CreateBooking сохраняет подтверждённую бронь и присваивает ей номер.
// Если время пересекается с другой подтверждённой бронью, возвращает ErrConflict.
func (s *Store) CreateBooking(b model.Booking) (model.Booking, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, other := range s.d.Bookings {
		if other.Status == model.BookingConfirmed && other.Date == b.Date && b.Start < other.End && other.Start < b.End {
			return model.Booking{}, ErrConflict
		}
	}
	if err := s.commit(func() {
		b.ID = s.nextID("bkg")
		b.Code = fmt.Sprintf("A-%d", firstBookingCode+len(s.d.Bookings))
		b.Status = model.BookingConfirmed
		b.CreatedAt = s.now()
		s.d.Bookings = append(s.d.Bookings, b)
	}); err != nil {
		return model.Booking{}, err
	}
	return b, nil
}

// CancelBooking помечает бронь отменённой (история сохраняется).
func (s *Store) CancelBooking(id string) (model.Booking, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Bookings, func(b model.Booking) bool { return b.ID == id })
	if i < 0 {
		return model.Booking{}, ErrNotFound
	}
	if err := s.commit(func() { s.d.Bookings[i].Status = model.BookingCancelled }); err != nil {
		return model.Booking{}, err
	}
	return s.d.Bookings[i], nil
}

func (s *Store) Messages() []model.Message {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Clone(s.d.Messages)
}

func (s *Store) AddMessage(role model.Role, text string) (model.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := 0
	if n := len(s.d.Messages); n > 0 {
		id = s.d.Messages[n-1].ID + 1
	}
	m := model.Message{ID: id, Role: role, Text: text, CreatedAt: s.now()}
	if err := s.commit(func() { s.d.Messages = append(s.d.Messages, m) }); err != nil {
		return model.Message{}, err
	}
	return m, nil
}
