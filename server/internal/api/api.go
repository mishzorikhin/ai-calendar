// Package api — HTTP API календаря и раздача веб-интерфейса.
package api

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

const (
	maxTitle   = 120
	maxMessage = 2000
	dayMinutes = 24 * 60
)

// Options — зависимости сервера.
type Options struct {
	// Store — хранилище данных (JSON-файл или PostgreSQL).
	Store store.Store
	// LLM — клиент языковой модели для разбора запросов; nil — ассистент работает с дефолтными параметрами.
	LLM *llm.Client
	// Web — собранный фронтенд (dist). nil — UI не раздаётся.
	Web fs.FS
	// CORSOrigins — источники, которым разрешены запросы к API (для vite dev).
	CORSOrigins []string
	Version     string
}

type server struct {
	store   store.Store
	llm     *llm.Client
	version string
}

// New собирает обработчик: /api/* — JSON API, остальное — SPA.
// Публичны только health и вход/регистрация; данные — за Bearer-токеном.
func New(opts Options) http.Handler {
	s := &server{store: opts.Store, llm: opts.LLM, version: opts.Version}
	mux := http.NewServeMux()

	mux.Handle("GET /api/health", handlerFunc(s.health))
	mux.Handle("POST /api/auth/register", handlerFunc(s.register))
	mux.Handle("POST /api/auth/login", handlerFunc(s.login))
	mux.Handle("POST /api/auth/logout", s.authed(s.logout))
	mux.Handle("GET /api/me", s.authed(s.me))
	mux.Handle("PATCH /api/me", s.authed(s.updateMe))
	mux.Handle("GET /api/users", s.authed(s.searchUsers))
	mux.Handle("GET /api/events", s.authed(s.listEvents))
	mux.Handle("POST /api/events", s.authed(s.createEvent))
	mux.Handle("PATCH /api/events/{id}", s.authed(s.updateEvent))
	mux.Handle("DELETE /api/events/{id}", s.authed(s.deleteEvent))
	mux.Handle("GET /api/month", s.authed(s.monthDots))
	mux.Handle("GET /api/tasks", s.authed(s.listTasks))
	mux.Handle("POST /api/tasks", s.authed(s.createTask))
	mux.Handle("PATCH /api/tasks/{id}", s.authed(s.updateTask))
	mux.Handle("DELETE /api/tasks/{id}", s.authed(s.deleteTask))
	mux.Handle("POST /api/tasks/{id}/members", s.authed(s.addTaskMember))
	mux.Handle("DELETE /api/tasks/{id}/members/{username}", s.authed(s.removeTaskMember))
	mux.Handle("GET /api/notifications", s.authed(s.listNotifications))
	mux.Handle("POST /api/notifications/read", s.authed(s.readNotifications))
	mux.Handle("GET /api/messages", s.authed(s.listMessages))
	mux.Handle("POST /api/messages", s.authed(s.createMessage))
	mux.Handle("POST /api/chat", s.authed(s.chat))
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

// highlightFresh — пометка «Новое» живёт сутки после создания.
const highlightFresh = 24 * time.Hour

// eventsOn — события пользователя на дату, по времени начала.
func (s *server) eventsOn(ctx context.Context, date time.Time) []model.Event {
	events := s.store.EventsOn(ctx, date.Format(time.DateOnly))
	slices.SortStableFunc(events, func(a, b model.Event) int { return a.Start - b.Start })
	for i := range events {
		events[i].Highlight = events[i].Highlight && time.Since(events[i].CreatedAt) < highlightFresh
	}
	return events
}

func (s *server) listEvents(w http.ResponseWriter, r *http.Request) error {
	date, err := parseDate(r.URL.Query().Get("date"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, nonNil(s.eventsOn(r.Context(), date)))
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
	if err := validateRange(in.Start, in.End); err != nil {
		return err
	}
	if in.Badge == "" {
		in.Badge = model.BadgeRoutine
	}
	if !in.Badge.Valid() {
		return badRequest("Неизвестный тип события: %q", in.Badge)
	}
	ev, err := s.store.CreateEvent(r.Context(), model.Event{
		Date: in.Date, Title: in.Title, Subtitle: in.Subtitle, Start: in.Start, End: in.End, Badge: in.Badge, Highlight: true,
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, ev)
	return nil
}

// eventPatchInput — поля PATCH-запроса; nil значит «не передано».
type eventPatchInput struct {
	Title    *string      `json:"title"`
	Subtitle *string      `json:"subtitle"`
	Date     *string      `json:"date"`
	Start    *int         `json:"start"`
	End      *int         `json:"end"`
	Badge    *model.Badge `json:"badge"`
}

func (s *server) updateEvent(w http.ResponseWriter, r *http.Request) error {
	var in eventPatchInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Title != nil {
		*in.Title = strings.TrimSpace(*in.Title)
		if *in.Title == "" || utf8.RuneCountInString(*in.Title) > maxTitle {
			return badRequest("Название обязательно и не длиннее %d символов", maxTitle)
		}
	}
	if in.Date != nil {
		if _, err := parseDate(*in.Date); err != nil {
			return err
		}
	}
	if in.Badge != nil && !in.Badge.Valid() {
		return badRequest("Неизвестный тип события: %q", *in.Badge)
	}
	id := r.PathValue("id")
	current, err := s.store.Event(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Событие")
		}
		return err
	}
	// Интервал проверяем по итоговым значениям до записи.
	merged := current
	merged.Apply(model.EventPatch{Title: in.Title, Subtitle: in.Subtitle, Date: in.Date, Start: in.Start, End: in.End, Badge: in.Badge})
	if err := validateRange(merged.Start, merged.End); err != nil {
		return err
	}
	patched, err := s.store.UpdateEvent(r.Context(), id, model.EventPatch{
		Title: in.Title, Subtitle: in.Subtitle, Date: in.Date, Start: in.Start, End: in.End, Badge: in.Badge,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Событие")
		}
		return err
	}
	writeJSON(w, http.StatusOK, patched)
	return nil
}

func (s *server) deleteEvent(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteEvent(r.Context(), r.PathValue("id")); err != nil {
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
	dots := map[int][]model.Badge{}
	prefix := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC).Format("2006-01")
	add := func(date string, b model.Badge) {
		if d, err := time.Parse(time.DateOnly, date); err == nil && strings.HasPrefix(date, prefix) {
			dots[d.Day()] = append(dots[d.Day()], b)
		}
	}
	for _, e := range s.store.EventsInMonth(r.Context(), prefix) {
		add(e.Date, e.Badge)
	}
	// Ключи JSON — строки: {"8": ["work", "food"]}.
	out := make(map[string][]model.Badge, len(dots))
	for day, badges := range dots {
		out[strconv.Itoa(day)] = badges
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *server) listTasks(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, nonNil(s.store.Tasks(r.Context())))
	return nil
}

type taskInput struct {
	Title    string             `json:"title"`
	Subtitle string             `json:"subtitle"`
	Kind     model.TaskKind     `json:"kind"`
	Category model.TaskCategory `json:"category"`
	Due      string             `json:"due"`
	// Members — логины, с кем поделиться (@имя в title/subtitle работает так же).
	Members []string `json:"members"`
}

// validTaskDue проверяет дату дедлайна цели (пустая — без дедлайна).
func validTaskDue(v string) bool {
	if v == "" {
		return true
	}
	_, err := time.Parse(time.DateOnly, v)
	return err == nil
}

func (s *server) createTask(w http.ResponseWriter, r *http.Request) error {
	var in taskInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > maxTitle {
		return badRequest("Название обязательно и не длиннее %d символов", maxTitle)
	}
	if in.Kind == "" {
		in.Kind = model.TaskKindTask
	}
	if !in.Kind.Valid() {
		return badRequest("kind должен быть task или goal")
	}
	if in.Category != "" && !in.Category.Valid() {
		return badRequest("category не длиннее 24 символов")
	}
	if !validTaskDue(in.Due) {
		return badRequest("due должен быть в формате ГГГГ-ММ-ДД")
	}
	// Явный members — строго: незнакомые логины отклоняем до создания.
	users, unknown := s.resolveUsernames(r.Context(), in.Members)
	if len(unknown) > 0 {
		return badRequest("Нет пользователей: @%s", strings.Join(unknown, ", @"))
	}
	t, err := s.store.CreateTask(r.Context(), model.Task{
		Title: in.Title, Subtitle: in.Subtitle, Kind: in.Kind, Category: in.Category, Due: in.Due,
	})
	if err != nil {
		return err
	}
	// Упоминания @логин в названии/заметке делят задачу с упомянутыми.
	mentioned, _ := s.resolveUsernames(r.Context(), mentionUsernames(t))
	users = mergeUsers(users, mentioned)
	if len(users) > 0 {
		if t, err = s.shareTaskWith(r.Context(), t.ID, users); err != nil {
			return shareErr(err)
		}
	}
	writeJSON(w, http.StatusCreated, t)
	return nil
}

// mergeUsers — объединение списков пользователей без повторов по id.
func mergeUsers(lists ...[]model.User) []model.User {
	seen := map[int64]bool{}
	var out []model.User
	for _, l := range lists {
		for _, u := range l {
			if !seen[u.ID] {
				seen[u.ID] = true
				out = append(out, u)
			}
		}
	}
	return out
}

// taskPatchInput — поля PATCH-запроса; nil значит «не передано».
// Members — добавить участников (не замена списка: убрать — DELETE members/{username}).
type taskPatchInput struct {
	Title    *string             `json:"title"`
	Subtitle *string             `json:"subtitle"`
	Kind     *model.TaskKind     `json:"kind"`
	Category *model.TaskCategory `json:"category"`
	Done     *bool               `json:"done"`
	Due      *string             `json:"due"`
	Members  []string            `json:"members"`
}

func (s *server) updateTask(w http.ResponseWriter, r *http.Request) error {
	var in taskPatchInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Title != nil {
		*in.Title = strings.TrimSpace(*in.Title)
		if *in.Title == "" || utf8.RuneCountInString(*in.Title) > maxTitle {
			return badRequest("Название обязательно и не длиннее %d символов", maxTitle)
		}
	}
	if in.Kind != nil && !in.Kind.Valid() {
		return badRequest("kind должен быть task или goal")
	}
	if in.Category != nil && *in.Category != "" && !in.Category.Valid() {
		return badRequest("category не длиннее 24 символов")
	}
	if in.Due != nil && !validTaskDue(*in.Due) {
		return badRequest("due должен быть в формате ГГГГ-ММ-ДД")
	}
	users, unknown := s.resolveUsernames(r.Context(), in.Members)
	if len(unknown) > 0 {
		return badRequest("Нет пользователей: @%s", strings.Join(unknown, ", @"))
	}
	t, err := s.store.UpdateTask(r.Context(), r.PathValue("id"), model.TaskPatch{
		Title: in.Title, Subtitle: in.Subtitle, Kind: in.Kind,
		Category: in.Category, Done: in.Done, Due: in.Due,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Задача")
		}
		return err
	}
	// Новые @упоминания в изменённом тексте добавляют участников (убрать — только вручную).
	if in.Title != nil || in.Subtitle != nil {
		mentioned, _ := s.resolveUsernames(r.Context(), mentionUsernames(t))
		users = mergeUsers(users, mentioned)
	}
	if len(users) > 0 {
		if t, err = s.shareTaskWith(r.Context(), t.ID, users); err != nil {
			return shareErr(err)
		}
	}
	writeJSON(w, http.StatusOK, t)
	return nil
}

func (s *server) deleteTask(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteTask(r.Context(), r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Задача")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *server) listMessages(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, nonNil(s.store.Messages(r.Context())))
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
	m, err := s.store.AddMessage(r.Context(), in.Role, in.Text)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, m)
	return nil
}
