// Package api — HTTP API календаря и раздача веб-интерфейса.
package api

import (
	"errors"
	"io/fs"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/seed"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

const (
	maxTitle    = 120
	maxSubtitle = 200
	maxMessage  = 2000
	minGuests   = 1
	maxGuests   = 8
	dayMinutes  = 24 * 60
)

// Options — зависимости сервера.
type Options struct {
	Store *store.Store
	// Web — собранный фронтенд (dist). nil — UI не раздаётся.
	Web fs.FS
	// CORSOrigins — источники, которым разрешены запросы к API (для vite dev).
	CORSOrigins []string
	Version     string
}

type server struct {
	store   *store.Store
	version string
}

// New собирает обработчик: /api/* — JSON API, остальное — SPA.
func New(opts Options) http.Handler {
	s := &server{store: opts.Store, version: opts.Version}
	mux := http.NewServeMux()

	mux.Handle("GET /api/health", handlerFunc(s.health))
	mux.Handle("GET /api/events", handlerFunc(s.listEvents))
	mux.Handle("POST /api/events", handlerFunc(s.createEvent))
	mux.Handle("DELETE /api/events/{id}", handlerFunc(s.deleteEvent))
	mux.Handle("GET /api/month", handlerFunc(s.monthDots))
	mux.Handle("GET /api/places", handlerFunc(s.listPlaces))
	mux.Handle("GET /api/places/{id}/reviews", handlerFunc(s.listReviews))
	mux.Handle("GET /api/bookings", handlerFunc(s.listBookings))
	mux.Handle("POST /api/bookings", handlerFunc(s.createBooking))
	mux.Handle("DELETE /api/bookings/{id}", handlerFunc(s.cancelBooking))
	mux.Handle("GET /api/messages", handlerFunc(s.listMessages))
	mux.Handle("POST /api/messages", handlerFunc(s.createMessage))
	mux.Handle("/api/", handlerFunc(func(http.ResponseWriter, *http.Request) error {
		return notFound("Метод API")
	}))

	if opts.Web != nil {
		mux.Handle("/", spaHandler(opts.Web))
	}

	return withRecover(withLogging(withSecurityHeaders(withCORS(opts.CORSOrigins, mux))))
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": s.version})
	return nil
}

func parseDate(v string) (time.Time, error) {
	d, err := time.Parse(time.DateOnly, v)
	if err != nil {
		return time.Time{}, badRequest("Дата должна быть в формате ГГГГ-ММ-ДД: %q", v)
	}
	return d, nil
}

// eventsOn — расписание дня, события пользователя и подтверждённые брони.
func (s *server) eventsOn(date time.Time) []model.Event {
	day := date.Format(time.DateOnly)
	events := seed.DaySchedule(date)
	events = append(events, s.store.EventsOn(day)...)
	for _, b := range s.store.Bookings() {
		if b.Status == model.BookingConfirmed && b.Date == day {
			events = append(events, bookingEvent(b))
		}
	}
	slices.SortStableFunc(events, func(a, b model.Event) int { return a.Start - b.Start })
	return events
}

func bookingEvent(b model.Booking) model.Event {
	return model.Event{
		ID:        "booking-" + b.ID,
		Date:      b.Date,
		Title:     "Завтрак · " + b.Place.Name,
		Subtitle:  b.Place.Address + " · бронь " + b.Code,
		Start:     b.Start,
		End:       b.End,
		Badge:     model.BadgeFood,
		Highlight: true,
	}
}

func (s *server) listEvents(w http.ResponseWriter, r *http.Request) error {
	date, err := parseDate(r.URL.Query().Get("date"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, s.eventsOn(date))
	return nil
}

type eventInput struct {
	Date     string      `json:"date"`
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle"`
	Start    int         `json:"start"`
	End      int         `json:"end"`
	Badge    model.Badge `json:"badge"`
}

func validateRange(start, end int) error {
	if start < 0 || end > dayMinutes || end <= start {
		return badRequest("Время задано неверно: начало %d, конец %d (минуты от полуночи)", start, end)
	}
	return nil
}

func (s *server) createEvent(w http.ResponseWriter, r *http.Request) error {
	var in eventInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if _, err := parseDate(in.Date); err != nil {
		return err
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > maxTitle {
		return badRequest("Название обязательно и не длиннее %d символов", maxTitle)
	}
	in.Subtitle = strings.TrimSpace(in.Subtitle)
	if utf8.RuneCountInString(in.Subtitle) > maxSubtitle {
		return badRequest("Подзаголовок не длиннее %d символов", maxSubtitle)
	}
	if err := validateRange(in.Start, in.End); err != nil {
		return err
	}
	if in.Badge == "" {
		in.Badge = model.BadgeRoutine
	}
	if !in.Badge.Valid() {
		return badRequest("Неизвестный тип события: %q", in.Badge)
	}
	ev, err := s.store.CreateEvent(model.Event{
		Date: in.Date, Title: in.Title, Subtitle: in.Subtitle, Start: in.Start, End: in.End, Badge: in.Badge, Highlight: true,
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, ev)
	return nil
}

func (s *server) deleteEvent(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteEvent(r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Событие")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// monthDots — значки событий по дням месяца: ?year=2026&month=10 (месяц с 1).
func (s *server) monthDots(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	year, errY := strconv.Atoi(q.Get("year"))
	month, errM := strconv.Atoi(q.Get("month"))
	if errY != nil || errM != nil || month < 1 || month > 12 || year < 1970 || year > 2100 {
		return badRequest("Нужны year и month (1–12)")
	}
	days := time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
	dots := seed.MonthDots(days)
	prefix := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC).Format("2006-01")
	add := func(date string, b model.Badge) {
		if d, err := time.Parse(time.DateOnly, date); err == nil && strings.HasPrefix(date, prefix) {
			dots[d.Day()] = append(dots[d.Day()], b)
		}
	}
	for _, e := range s.store.EventsInMonth(prefix) {
		add(e.Date, e.Badge)
	}
	for _, b := range s.store.Bookings() {
		if b.Status == model.BookingConfirmed {
			add(b.Date, model.BadgeFood)
		}
	}
	// Ключи JSON — строки: {"8": ["work", "food"]}.
	out := make(map[string][]model.Badge, len(dots))
	for day, badges := range dots {
		out[strconv.Itoa(day)] = badges
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *server) listPlaces(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, seed.Places)
	return nil
}

func (s *server) listReviews(w http.ResponseWriter, r *http.Request) error {
	if _, ok := seed.FindPlace(r.PathValue("id")); !ok {
		return notFound("Место")
	}
	writeJSON(w, http.StatusOK, seed.Reviews)
	return nil
}

func (s *server) listBookings(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, s.store.Bookings())
	return nil
}

type bookingInput struct {
	PlaceID string `json:"placeId"`
	Date    string `json:"date"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Guests  int    `json:"guests"`
	Invite  bool   `json:"invite"`
}

func (s *server) createBooking(w http.ResponseWriter, r *http.Request) error {
	var in bookingInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	place, ok := seed.FindPlace(in.PlaceID)
	if !ok {
		return notFound("Место")
	}
	if _, err := parseDate(in.Date); err != nil {
		return err
	}
	if err := validateRange(in.Start, in.End); err != nil {
		return err
	}
	if in.Guests < minGuests || in.Guests > maxGuests {
		return badRequest("Гостей должно быть от %d до %d", minGuests, maxGuests)
	}
	if !place.OpenAt(in.Start) {
		return &apiError{Status: http.StatusConflict, Message: place.Name + " закрыто в это время"}
	}
	b, err := s.store.CreateBooking(model.Booking{
		Place: place, Date: in.Date, Start: in.Start, End: in.End, Guests: in.Guests, Invite: in.Invite,
	})
	if errors.Is(err, store.ErrConflict) {
		return &apiError{Status: http.StatusConflict, Message: "Это время уже занято другой бронью"}
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, b)
	return nil
}

func (s *server) cancelBooking(w http.ResponseWriter, r *http.Request) error {
	b, err := s.store.CancelBooking(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Бронь")
		}
		return err
	}
	writeJSON(w, http.StatusOK, b)
	return nil
}

func (s *server) listMessages(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, s.store.Messages())
	return nil
}

type messageInput struct {
	Role model.Role `json:"role"`
	Text string     `json:"text"`
}

func (s *server) createMessage(w http.ResponseWriter, r *http.Request) error {
	var in messageInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Role != model.RoleUser && in.Role != model.RoleAI {
		return badRequest("role должен быть user или ai")
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" || utf8.RuneCountInString(in.Text) > maxMessage {
		return badRequest("Текст обязателен и не длиннее %d символов", maxMessage)
	}
	m, err := s.store.AddMessage(in.Role, in.Text)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, m)
	return nil
}
