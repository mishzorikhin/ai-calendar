// Package api — HTTP API календаря и раздача веб-интерфейса.
package api

import (
	"context"
	"encoding/json"
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
	maxTitle    = 120
	maxSubtitle = 200
	maxMessage  = 2000
	dayMinutes  = 24 * 60
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
	// Calendars — подключение внешних календарей (Google, Outlook, CalDAV, .ics).
	Calendars CalendarOptions
	// ClosedRegistration — новые аккаунты не создаются; первый (владелец сервера) — можно.
	ClosedRegistration bool
	// Proxy — откуда брать адрес клиента для лимитов (TRUST_PROXY).
	Proxy ProxyMode
	// Push — уведомления Web Push и напоминания.
	Push PushOptions
}

type server struct {
	store   store.Store
	llm     *llm.Client
	cal     *calendars
	push    *pushService
	version string
	limits  *limits
	// confirms — удаления, которые ассистент предложил и ждут согласия пользователя.
	confirms *confirmations

	closedRegistration bool
	proxy              ProxyMode
}

// New собирает обработчик: /api/* — JSON API, остальное — SPA.
// Публичны только health и вход/регистрация; данные — за Bearer-токеном.
func New(opts Options) http.Handler {
	return newServer(opts).handler(opts)
}

// newServer собирает сервер и запускает фоновые циклы (синхронизация календарей, напоминания).
func newServer(opts Options) *server {
	s := &server{
		store: opts.Store, llm: opts.LLM, cal: newCalendars(opts.Calendars), version: opts.Version,
		limits: newLimits(), confirms: newConfirmations(),
		closedRegistration: opts.ClosedRegistration, proxy: opts.Proxy,
	}
	s.push = newPushService(opts.Push, s.cal)
	if bg := opts.Calendars.Background; bg != nil && opts.Calendars.SyncInterval > 0 {
		go s.runSyncLoop(bg, opts.Calendars.SyncInterval)
	}
	if bg := opts.Push.Background; bg != nil && opts.Push.Interval > 0 {
		go s.runPushLoop(bg, opts.Push.Interval)
	}
	return s
}

func (s *server) handler(opts Options) http.Handler {
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
	mux.Handle("GET /api/push", s.authed(s.getPush))
	mux.Handle("PATCH /api/push/settings", s.authed(s.updateNotifySettings))
	mux.Handle("POST /api/push/subscriptions", s.authed(s.subscribePush))
	mux.Handle("DELETE /api/push/subscriptions", s.authed(s.unsubscribePush))
	mux.Handle("POST /api/push/test", s.authed(s.testPush))
	mux.Handle("POST /api/push/snooze", s.authed(s.snoozePush))
	mux.Handle("GET /api/messages", s.authed(s.listMessages))
	mux.Handle("POST /api/chat", s.authed(s.chat))
	mux.Handle("GET /api/integrations", s.authed(s.listIntegrations))
	mux.Handle("POST /api/integrations", s.authed(s.createIntegration))
	mux.Handle("POST /api/integrations/caldav/discover", s.authed(s.discoverCalDAV))
	mux.Handle("PATCH /api/integrations/{id}", s.authed(s.updateIntegration))
	mux.Handle("DELETE /api/integrations/{id}", s.authed(s.deleteIntegration))
	mux.Handle("POST /api/integrations/{id}/sync", s.authed(s.syncIntegrationNow))
	mux.Handle("POST /api/integrations/oauth/{provider}/start", s.authed(s.oauthStart))
	mux.Handle("GET /api/integrations/oauth/{provider}/callback", handlerFunc(s.oauthCallback))
	mux.Handle("GET /api/feed", s.authed(s.getFeed))
	mux.Handle("POST /api/feed", s.authed(s.resetFeed))
	mux.Handle("DELETE /api/feed", s.authed(s.disableFeed))
	mux.Handle("GET /api/feed/{file}", handlerFunc(s.serveFeed))
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
	// Reminders — за сколько минут напомнить; нет поля или null — как в настройках, [] — не напоминать.
	Reminders []int `json:"reminders"`
}

// validateReminders проверяет напоминания и упорядочивает их: раньше — первее.
func validateReminders(r []int) ([]int, error) {
	if r == nil {
		return nil, nil
	}
	out := slices.Clone(r)
	slices.Sort(out)
	out = slices.Compact(out)
	if len(out) > model.MaxReminders {
		return nil, badRequest("Не больше %d напоминаний у события", model.MaxReminders)
	}
	for _, m := range out {
		if m < 0 || m > model.MaxReminderMinutes {
			return nil, badRequest("Напоминание — от 0 до %d минут до начала", model.MaxReminderMinutes)
		}
	}
	slices.Reverse(out)
	return out, nil
}

func validateSubtitle(v string) error {
	if utf8.RuneCountInString(v) > maxSubtitle {
		return badRequest("Подзаголовок не длиннее %d символов", maxSubtitle)
	}
	return nil
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
	if err := validateSubtitle(in.Subtitle); err != nil {
		return err
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
	reminders, err := validateReminders(in.Reminders)
	if err != nil {
		return err
	}
	ev, err := s.createEventSynced(r.Context(), model.Event{
		Date: in.Date, Title: in.Title, Subtitle: in.Subtitle, Start: in.Start, End: in.End, Badge: in.Badge, Highlight: true,
		Reminders: reminders,
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
	// Reminders: null — вернуть напоминание по умолчанию, [] — не напоминать.
	Reminders json.RawMessage `json:"reminders"`
}

// remindersPatch разбирает поле reminders PATCH-запроса: нет поля — не менять.
func remindersPatch(raw json.RawMessage) (*[]int, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var r []int
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, badRequest("reminders — список минут до начала")
	}
	r, err := validateReminders(r)
	if err != nil {
		return nil, err
	}
	return &r, nil
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
	if in.Subtitle != nil {
		*in.Subtitle = strings.TrimSpace(*in.Subtitle)
		if err := validateSubtitle(*in.Subtitle); err != nil {
			return err
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
	reminders, err := remindersPatch(in.Reminders)
	if err != nil {
		return err
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
	patched, err := s.updateEventSynced(r.Context(), current, model.EventPatch{
		Title: in.Title, Subtitle: in.Subtitle, Date: in.Date, Start: in.Start, End: in.End, Badge: in.Badge,
		Reminders: reminders,
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
	current, err := s.store.Event(r.Context(), r.PathValue("id"))
	if err == nil {
		err = s.deleteEventSynced(r.Context(), current)
	}
	if err != nil {
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
	in.Subtitle = strings.TrimSpace(in.Subtitle)
	if err := validateSubtitle(in.Subtitle); err != nil {
		return err
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
	users = mergeUsers(users, s.mentionedUsers(r.Context(), t))
	if len(users) > 0 {
		if t, err = s.shareTaskWith(r.Context(), t, users); err != nil {
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
	if in.Subtitle != nil {
		*in.Subtitle = strings.TrimSpace(*in.Subtitle)
		if err := validateSubtitle(*in.Subtitle); err != nil {
			return err
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
	// Текст до правки — чтобы делиться только по новым упоминаниям (галочке он не нужен).
	textChanged := in.Title != nil || in.Subtitle != nil
	var before model.Task
	if textChanged {
		var err error
		if before, err = s.store.Task(r.Context(), r.PathValue("id")); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return notFound("Задача")
			}
			return err
		}
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
	if textChanged {
		users = mergeUsers(users, s.newMentions(r.Context(), before, t))
	}
	if len(users) > 0 {
		if t, err = s.shareTaskWith(r.Context(), t, users); err != nil {
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
