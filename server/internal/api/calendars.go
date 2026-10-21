// Внешние календари: подключение, синхронизация, запись событий туда и обратно.
//
// События внешних календарей хранятся вместе с обычными (Event.Source — id
// подключения), поэтому день, месяц и поиск свободного времени у ассистента
// видят их без отдельной логики. Синхронизация — по окну дат вокруг сегодня:
// при подключении, по кнопке и в фоне раз в CalendarOptions.SyncInterval.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/calsync"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/secret"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// CalendarOptions — настройки внешних календарей.
type CalendarOptions struct {
	// Secrets шифрует пароли и токены; nil — случайный ключ на время жизни процесса.
	Secrets *secret.Box
	// Google и Outlook — OAuth-приложения; nil — провайдер не предлагается.
	Google  *calsync.OAuthApp
	Outlook *calsync.OAuthApp
	// PublicURL — внешний адрес сервера (https://cal.example.com) для redirect_uri OAuth.
	// Пусто — адрес берётся из запроса.
	PublicURL string
	// AllowPrivate разрешает адреса внутренней сети (свой Nextcloud в домашней сети).
	AllowPrivate bool
	// DefaultTimeZone — пояс пользователей, чей пояс ещё неизвестен.
	DefaultTimeZone string
	// SyncInterval — период фоновой синхронизации; 0 — без фоновой.
	SyncInterval time.Duration
	// Background — контекст жизни сервера для фоновой синхронизации.
	Background context.Context
	// HTTPTimeout — предел одного запроса к внешнему сервису.
	HTTPTimeout time.Duration
}

// Окно синхронизации относительно сегодняшнего дня пользователя.
const (
	syncPastDays   = 30
	syncFutureDays = 365
	// maxIntegrations — предел подключений на пользователя.
	maxIntegrations = 20
	// syncTimeout — предел одной синхронизации календаря.
	syncTimeout = 90 * time.Second
)

type calendars struct {
	opts       CalendarOptions
	net        *calsync.Net
	box        *secret.Box
	defaultLoc *time.Location
	now        func() time.Time
	locks      sync.Map // id подключения → *sync.Mutex
}

func newCalendars(opts CalendarOptions) *calendars {
	box := opts.Secrets
	if box == nil {
		key, _, _ := secret.LoadKey("", "")
		box, _ = secret.New(key)
	}
	timeout := opts.HTTPTimeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	loc, err := time.LoadLocation(opts.DefaultTimeZone)
	if err != nil || opts.DefaultTimeZone == "" {
		loc, err = time.LoadLocation("Europe/Moscow")
		if err != nil {
			loc = time.UTC
		}
	}
	return &calendars{
		opts:       opts,
		net:        calsync.NewNet(opts.AllowPrivate, timeout),
		box:        box,
		defaultLoc: loc,
		now:        time.Now,
	}
}

func (c *calendars) lock(id string) func() {
	m, _ := c.locks.LoadOrStore(id, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// location — пояс пользователя; неизвестный — пояс по умолчанию.
func (c *calendars) location(u model.User) *time.Location {
	if u.TimeZone != "" {
		if loc, err := time.LoadLocation(u.TimeZone); err == nil {
			return loc
		}
	}
	return c.defaultLoc
}

func (c *calendars) app(kind model.IntegrationKind) *calsync.OAuthApp {
	switch kind {
	case model.IntegrationGoogle:
		return c.opts.Google
	case model.IntegrationOutlook:
		return c.opts.Outlook
	}
	return nil
}

// provider собирает клиента календаря. Для OAuth обновлённые токены сохраняются в подключение.
func (s *server) provider(ctx context.Context, in model.Integration, loc *time.Location) (calsync.Provider, error) {
	c := s.cal
	switch in.Kind {
	case model.IntegrationICS:
		return &calsync.ICS{Net: c.net, URL: in.URL, Loc: loc}, nil
	case model.IntegrationCalDAV:
		pass, err := c.box.Open(in.Secret)
		if err != nil {
			return nil, err
		}
		return &calsync.CalDAV{Net: c.net, URL: in.URL, Username: in.Username, Password: pass, Loc: loc, ReadOnly: !in.Writable}, nil
	case model.IntegrationGoogle, model.IntegrationOutlook:
		app := c.app(in.Kind)
		if app == nil {
			return nil, errors.New("подключение к этому сервису выключено на сервере")
		}
		raw, err := c.box.Open(in.Secret)
		if err != nil {
			return nil, err
		}
		var tok calsync.Token
		if err := json.Unmarshal([]byte(raw), &tok); err != nil {
			return nil, errors.New("токен доступа повреждён — подключите календарь заново")
		}
		id := in.ID
		ts := calsync.NewTokenSource(app, c.net, tok, func(t calsync.Token) error {
			return s.saveToken(ctx, id, t)
		})
		if in.Kind == model.IntegrationGoogle {
			return &calsync.Google{Tokens: ts, CalendarID: in.CalendarID, ReadOnly: !in.Writable}, nil
		}
		return &calsync.Outlook{Tokens: ts, CalendarID: in.CalendarID, ReadOnly: !in.Writable}, nil
	}
	return nil, fmt.Errorf("неизвестный вид календаря %q", in.Kind)
}

// saveToken сохраняет обновлённые OAuth-токены в подключение.
func (s *server) saveToken(ctx context.Context, id string, t calsync.Token) error {
	if id == "" {
		return nil // подключение ещё не сохранено — токены запишет вызывающий
	}
	raw, err := json.Marshal(t)
	if err != nil {
		return err
	}
	sealed, err := s.cal.box.Seal(string(raw))
	if err != nil {
		return err
	}
	in, err := s.store.Integration(ctx, id)
	if err != nil {
		return err
	}
	in.Secret = sealed
	_, err = s.store.SaveIntegration(ctx, in)
	return err
}

// syncWindow — окно дат синхронизации в поясе пользователя.
func (c *calendars) syncWindow(loc *time.Location) (from, to time.Time) {
	now := c.now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	return today.AddDate(0, 0, -syncPastDays), today.AddDate(0, 0, syncFutureDays+1)
}

// fetchEvents читает внешний календарь и переводит вхождения в события дней пользователя.
func (s *server) fetchEvents(ctx context.Context, in model.Integration) ([]model.Event, error) {
	u, err := store.UserFrom(ctx)
	if err != nil {
		return nil, err
	}
	loc := s.cal.location(u)
	p, err := s.provider(ctx, in, loc)
	if err != nil {
		return nil, err
	}
	from, to := s.cal.syncWindow(loc)
	occ, err := p.Fetch(ctx, from, to)
	if err != nil {
		return nil, err
	}
	fromDate, toDate := from.Format(time.DateOnly), to.AddDate(0, 0, -1).Format(time.DateOnly)
	var events []model.Event
	for _, o := range occ {
		for _, e := range calsync.ToEvents(o, loc, fromDate, toDate) {
			e.Badge = in.Badge
			if !e.Badge.Valid() {
				e.Badge = model.BadgeRoutine
			}
			events = append(events, e)
		}
	}
	return events, nil
}

// syncIntegration обновляет события подключения и его статус (время и ошибку синхронизации).
func (s *server) syncIntegration(ctx context.Context, id string) (model.Integration, error) {
	defer s.cal.lock(id)()
	ctx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	in, err := s.store.Integration(ctx, id)
	if err != nil {
		return model.Integration{}, err
	}
	events, err := s.fetchEvents(ctx, in)
	if err == nil {
		var stats store.SyncStats
		stats, err = s.store.SyncEvents(ctx, in.ID, events)
		if err == nil {
			slog.Info("календарь синхронизирован", "integration", in.ID, "kind", in.Kind,
				"added", stats.Added, "updated", stats.Updated, "removed", stats.Removed)
		}
	}
	// Статус пишем в свежую копию: токены могли обновиться во время запроса.
	cur, rerr := s.store.Integration(ctx, id)
	if rerr != nil {
		return in, errors.Join(err, rerr)
	}
	if err != nil {
		cur.LastError = describeSyncError(err)
		slog.Warn("синхронизация календаря не удалась", "integration", in.ID, "kind", in.Kind, "err", err)
	} else {
		cur.LastError = ""
		cur.LastSync = s.cal.now()
	}
	saved, serr := s.store.SaveIntegration(ctx, cur)
	if serr != nil {
		return cur, errors.Join(err, serr)
	}
	return saved, err
}

// describeSyncError — текст ошибки для пользователя (ошибки calsync уже по-русски).
func describeSyncError(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "Календарь не ответил вовремя"
	case errors.Is(err, calsync.ErrAuth):
		return "Доступ к календарю отозван или пароль не подходит — подключите заново"
	}
	msg := err.Error()
	if len([]rune(msg)) > 300 {
		msg = string([]rune(msg)[:300]) + "…"
	}
	return msg
}

// runSyncLoop — фоновая синхронизация всех подключений.
func (s *server) runSyncLoop(ctx context.Context, every time.Duration) {
	// Первый проход — вскоре после старта, чтобы не грузить сервер в момент запуска.
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.syncAll(ctx)
		timer.Reset(every)
	}
}

func (s *server) syncAll(ctx context.Context) {
	for _, in := range s.store.AllIntegrations(ctx) {
		if ctx.Err() != nil {
			return
		}
		u, err := s.store.UserByID(ctx, in.UserID)
		if err != nil {
			continue
		}
		_, _ = s.syncIntegration(store.WithUser(ctx, u), in.ID)
	}
}

// --- Запись событий во внешние календари -------------------------------------

var errReadOnlyEvent = &apiError{Status: 403, Message: "Это событие из подключённого календаря — изменить его можно только там"}

// remoteError — внешний календарь не принял изменение. 424, а не 5xx: офлайн-очередь
// не должна бесконечно повторять запрос, который отклонил чужой сервис.
func remoteError(in model.Integration, err error) error {
	return &apiError{Status: 424, Message: fmt.Sprintf("%s: %s", in.Name, describeSyncError(err))}
}

// primaryTarget — календарь, куда уходят новые события, если он назначен.
func (s *server) primaryTarget(ctx context.Context) (model.Integration, bool) {
	for _, in := range s.store.Integrations(ctx) {
		if in.Primary && in.Writable {
			return in, true
		}
	}
	return model.Integration{}, false
}

func (s *server) itemOf(ctx context.Context, e model.Event) (calsync.Item, *time.Location, error) {
	u, err := store.UserFrom(ctx)
	if err != nil {
		return calsync.Item{}, nil, err
	}
	loc := s.cal.location(u)
	it, ok := calsync.ItemOf(e, loc)
	if !ok {
		return calsync.Item{}, nil, badRequest("Дата должна быть в формате ГГГГ-ММ-ДД: %q", e.Date)
	}
	return it, loc, nil
}

// createEventSynced сохраняет новое событие; если назначен основной внешний
// календарь — сначала создаёт событие там. Не получилось — событие остаётся
// в приложении, а ошибка видна в настройках календаря.
func (s *server) createEventSynced(ctx context.Context, e model.Event) (model.Event, error) {
	// Серия остаётся в приложении: у внешних календарей свои правила повторов.
	if target, ok := s.primaryTarget(ctx); ok && e.Repeat == model.RepeatNone {
		it, loc, err := s.itemOf(ctx, e)
		if err != nil {
			return model.Event{}, err
		}
		p, err := s.provider(ctx, target, loc)
		if err == nil {
			var ref calsync.Ref
			if ref, err = p.Create(ctx, it); err == nil {
				e.Source, e.ExternalID, e.ETag = target.ID, ref.ID, ref.ETag
			}
		}
		if err != nil {
			slog.Warn("событие не ушло во внешний календарь", "integration", target.ID, "err", err)
			s.markIntegrationError(ctx, target.ID, "Новое событие «"+e.Title+"» не сохранилось в календаре: "+describeSyncError(err))
		}
	}
	return s.store.CreateEvent(ctx, e)
}

func (s *server) markIntegrationError(ctx context.Context, id, msg string) {
	defer s.cal.lock(id)()
	in, err := s.store.Integration(ctx, id)
	if err != nil {
		return
	}
	in.LastError = msg
	_, _ = s.store.SaveIntegration(ctx, in)
}

// updateEventSynced применяет патч; у события внешнего календаря — сначала там.
// Напоминания — настройка приложения: их можно менять и у событий только для чтения,
// а во внешний календарь такая правка не уходит.
func (s *server) updateEventSynced(ctx context.Context, cur model.Event, patch model.EventPatch) (model.Event, error) {
	onlyReminders := patch.OnlyReminders()
	if cur.ReadOnly && !onlyReminders {
		return model.Event{}, errReadOnlyEvent
	}
	if cur.Source != "" && (patch.Repeat != nil && *patch.Repeat != model.RepeatNone || patch.SkipDate != nil) {
		return model.Event{}, badRequest("Повтор можно задать только событию приложения — у подключённого календаря он задаётся там")
	}
	newETag, pushed := "", false
	if cur.Source != "" && !onlyReminders {
		in, err := s.store.Integration(ctx, cur.Source)
		if err == nil {
			merged := cur
			merged.Apply(patch)
			it, loc, err := s.itemOf(ctx, merged)
			if err != nil {
				return model.Event{}, err
			}
			p, err := s.provider(ctx, in, loc)
			if err != nil {
				return model.Event{}, remoteError(in, err)
			}
			ref, err := p.Update(ctx, calsync.Ref{ID: cur.ExternalID, ETag: cur.ETag}, it)
			if err != nil {
				if errors.Is(err, calsync.ErrReadOnly) {
					return model.Event{}, errReadOnlyEvent
				}
				return model.Event{}, remoteError(in, err)
			}
			newETag, pushed = ref.ETag, true
		}
	}
	ev, err := s.store.UpdateEvent(ctx, cur.ID, patch)
	if err != nil {
		return model.Event{}, err
	}
	if pushed {
		if err := s.store.SetEventETag(ctx, ev.ID, newETag); err == nil {
			ev.ETag = newETag
		}
	}
	return ev, nil
}

// deleteEventSynced удаляет событие; у события внешнего календаря — сначала там.
func (s *server) deleteEventSynced(ctx context.Context, cur model.Event) error {
	if cur.ReadOnly {
		return errReadOnlyEvent
	}
	if cur.Source != "" {
		if in, err := s.store.Integration(ctx, cur.Source); err == nil {
			_, loc, err := s.itemOf(ctx, cur)
			if err != nil {
				return err
			}
			p, err := s.provider(ctx, in, loc)
			if err != nil {
				return remoteError(in, err)
			}
			if err := p.Delete(ctx, calsync.Ref{ID: cur.ExternalID, ETag: cur.ETag}); err != nil {
				if errors.Is(err, calsync.ErrReadOnly) {
					return errReadOnlyEvent
				}
				return remoteError(in, err)
			}
		}
	}
	return s.store.DeleteEvent(ctx, cur.ID)
}

// --- Представление для API ---------------------------------------------------

type integrationView struct {
	ID        string                `json:"id"`
	Kind      model.IntegrationKind `json:"kind"`
	Name      string                `json:"name"`
	Account   string                `json:"account,omitempty"`
	Badge     model.Badge           `json:"badge"`
	Writable  bool                  `json:"writable"`
	Primary   bool                  `json:"primary"`
	LastSync  *time.Time            `json:"lastSync,omitempty"`
	LastError string                `json:"lastError,omitempty"`
}

func viewOf(in model.Integration) integrationView {
	v := integrationView{
		ID: in.ID, Kind: in.Kind, Name: in.Name, Badge: in.Badge,
		Writable: in.Writable, Primary: in.Primary, LastError: in.LastError,
	}
	if !in.LastSync.IsZero() {
		t := in.LastSync
		v.LastSync = &t
	}
	switch in.Kind {
	case model.IntegrationICS:
		// Ссылка .ics часто содержит секрет — показываем только хост.
		v.Account = hostOnly(in.URL)
	case model.IntegrationCalDAV:
		v.Account = in.Username
		if h := hostOnly(in.URL); h != "" {
			v.Account += " · " + h
		}
	default:
		v.Account = in.Username
	}
	return v
}

func hostOnly(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}
