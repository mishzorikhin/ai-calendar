package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/calsync"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

const (
	maxIntegrationName = 60
	maxURL             = 2048
	maxLogin           = 200
	maxPassword        = 500
)

func (s *server) listIntegrations(w http.ResponseWriter, r *http.Request) error {
	items := s.store.Integrations(r.Context())
	views := make([]integrationView, 0, len(items))
	for _, in := range items {
		views = append(views, viewOf(in))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": views,
		"providers": map[string]bool{
			"google":  s.cal.opts.Google != nil,
			"outlook": s.cal.opts.Outlook != nil,
		},
	})
	return nil
}

type caldavInput struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func (in *caldavInput) validate() error {
	in.URL = strings.TrimSpace(in.URL)
	in.Username = strings.TrimSpace(in.Username)
	switch {
	case in.URL == "" || len(in.URL) > maxURL:
		return badRequest("Нужен адрес сервера")
	case in.Username == "" || utf8.RuneCountInString(in.Username) > maxLogin:
		return badRequest("Нужен логин")
	case in.Password == "" || utf8.RuneCountInString(in.Password) > maxPassword:
		return badRequest("Нужен пароль (для Яндекса и iCloud — пароль приложения)")
	}
	return nil
}

// calendarError — ошибка внешнего сервиса при подключении: показываем как 400 с понятным текстом.
func calendarError(err error) error {
	if errors.Is(err, calsync.ErrBlockedHost) {
		return badRequest("Этот адрес во внутренней сети — сервер к нему не обращается")
	}
	return badRequest("%s", describeSyncError(err))
}

// discoverCalDAV — календари пользователя на CalDAV-сервере, чтобы выбрать нужный.
func (s *server) discoverCalDAV(w http.ResponseWriter, r *http.Request) error {
	var in caldavInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(r.Context(), syncTimeout)
	defer cancel()
	cals, err := calsync.DiscoverCalDAV(ctx, s.cal.net, in.URL, in.Username, in.Password)
	if err != nil {
		return calendarError(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"calendars": cals})
	return nil
}

type integrationInput struct {
	Kind     model.IntegrationKind `json:"kind"`
	Name     string                `json:"name"`
	URL      string                `json:"url"`
	Username string                `json:"username"`
	Password string                `json:"password"`
	Badge    model.Badge           `json:"badge"`
	Writable bool                  `json:"writable"`
	Primary  bool                  `json:"primary"`
}

// createIntegration подключает подписку .ics или CalDAV-календарь. Сначала
// календарь читается — неверный адрес или пароль не сохраняются.
func (s *server) createIntegration(w http.ResponseWriter, r *http.Request) error {
	var in integrationInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if len(s.store.Integrations(r.Context())) >= maxIntegrations {
		return badRequest("Подключено слишком много календарей — уберите лишние")
	}
	in.Name = strings.TrimSpace(in.Name)
	if utf8.RuneCountInString(in.Name) > maxIntegrationName {
		return badRequest("Название не длиннее %d символов", maxIntegrationName)
	}
	if in.Badge == "" {
		in.Badge = model.BadgeRoutine
	}
	if !in.Badge.Valid() {
		return badRequest("Неизвестный тип события: %q", in.Badge)
	}
	if len(in.URL) > maxURL {
		return badRequest("Слишком длинный адрес")
	}
	integ := model.Integration{Kind: in.Kind, Name: in.Name, Badge: in.Badge}
	switch in.Kind {
	case model.IntegrationICS:
		u, err := calsync.NormalizeURL(in.URL)
		if err != nil {
			return badRequest("%s", err.Error())
		}
		integ.URL = u
		if integ.Name == "" {
			integ.Name = "Календарь " + hostOnly(u)
		}
	case model.IntegrationCalDAV:
		ci := caldavInput{URL: in.URL, Username: in.Username, Password: in.Password}
		if err := ci.validate(); err != nil {
			return err
		}
		u, err := calsync.NormalizeURL(ci.URL)
		if err != nil {
			return badRequest("%s", err.Error())
		}
		sealed, err := s.cal.box.Seal(ci.Password)
		if err != nil {
			return err
		}
		integ.URL, integ.Username, integ.Secret = u, ci.Username, sealed
		integ.Writable = in.Writable
		integ.Primary = in.Primary && in.Writable
		if integ.Name == "" {
			integ.Name = "Календарь " + hostOnly(u)
		}
	default:
		return badRequest("kind должен быть ics или caldav; Google и Outlook подключаются через вход в аккаунт")
	}

	ctx, cancel := context.WithTimeout(r.Context(), syncTimeout)
	defer cancel()
	events, err := s.fetchEvents(ctx, integ)
	if err != nil {
		return calendarError(err)
	}
	integ.LastSync = s.cal.now()
	saved, err := s.store.SaveIntegration(r.Context(), integ)
	if err != nil {
		return err
	}
	if _, err := s.store.SyncEvents(r.Context(), saved.ID, events); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, viewOf(saved))
	return nil
}

type integrationPatchInput struct {
	Name    *string      `json:"name"`
	Badge   *model.Badge `json:"badge"`
	Primary *bool        `json:"primary"`
}

func (s *server) updateIntegration(w http.ResponseWriter, r *http.Request) error {
	var in integrationPatchInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	id := r.PathValue("id")
	unlock := s.cal.lock(id)
	integ, err := s.store.Integration(r.Context(), id)
	if err != nil {
		unlock()
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Календарь")
		}
		return err
	}
	badgeChanged := false
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" || utf8.RuneCountInString(name) > maxIntegrationName {
			unlock()
			return badRequest("Название обязательно и не длиннее %d символов", maxIntegrationName)
		}
		integ.Name = name
	}
	if in.Badge != nil {
		if !in.Badge.Valid() {
			unlock()
			return badRequest("Неизвестный тип события: %q", *in.Badge)
		}
		badgeChanged = *in.Badge != integ.Badge
		integ.Badge = *in.Badge
	}
	if in.Primary != nil {
		if *in.Primary && !integ.Writable {
			unlock()
			return badRequest("В этот календарь нельзя записывать — выберите другой")
		}
		integ.Primary = *in.Primary
	}
	saved, err := s.store.SaveIntegration(r.Context(), integ)
	unlock()
	if err != nil {
		return err
	}
	// Новый тип — пересинхронизируем, чтобы события календаря перекрасились.
	if badgeChanged {
		if synced, err := s.syncIntegration(r.Context(), id); err == nil {
			saved = synced
		}
	}
	writeJSON(w, http.StatusOK, viewOf(saved))
	return nil
}

func (s *server) deleteIntegration(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	defer s.cal.lock(id)()
	if err := s.store.DeleteIntegration(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Календарь")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// syncIntegrationNow — синхронизация по кнопке; ошибка сервиса — в lastError, а не 5xx.
func (s *server) syncIntegrationNow(w http.ResponseWriter, r *http.Request) error {
	in, err := s.syncIntegration(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		return notFound("Календарь")
	}
	if in.ID == "" {
		return err
	}
	writeJSON(w, http.StatusOK, viewOf(in))
	return nil
}

// --- OAuth: Google и Outlook --------------------------------------------------

// oauthStateTTL — сколько живёт ссылка на страницу согласия.
const oauthStateTTL = 15 * time.Minute

// oauthCookie — одноразовый nonce в HttpOnly-cookie: колбэк принимается только в том
// браузере, который начал вход. Без этого можно начать вход для своего аккаунта и
// подсунуть ссылку жертве — её Google-календарь оказался бы в чужом аккаунте.
const oauthCookie = "aical_oauth"

type oauthState struct {
	User     int64  `json:"u"`
	Provider string `json:"p"`
	Expires  int64  `json:"e"`
	Nonce    string `json:"n"`
}

func (s *server) signState(st oauthState) (string, error) {
	raw, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	return payload + "." + s.cal.box.Sign(payload), nil
}

func (s *server) parseState(v string) (oauthState, bool) {
	payload, sig, ok := strings.Cut(v, ".")
	if !ok || !s.cal.box.Verify(payload, sig) {
		return oauthState{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return oauthState{}, false
	}
	var st oauthState
	if json.Unmarshal(raw, &st) != nil || time.Now().Unix() > st.Expires {
		return oauthState{}, false
	}
	return st, true
}

// redirectURL — адрес возврата со страницы согласия; должен совпадать с указанным у провайдера.
func (s *server) redirectURL(r *http.Request, provider string) string {
	base := strings.TrimRight(s.cal.opts.PublicURL, "/")
	if base == "" {
		scheme := "http"
		if isHTTPS(r) {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return base + "/api/integrations/oauth/" + provider + "/callback"
}

func providerKind(name string) (model.IntegrationKind, bool) {
	switch name {
	case "google":
		return model.IntegrationGoogle, true
	case "outlook":
		return model.IntegrationOutlook, true
	}
	return "", false
}

// oauthStart отдаёт ссылку на страницу согласия; браузер уходит туда сам.
func (s *server) oauthStart(w http.ResponseWriter, r *http.Request) error {
	name := r.PathValue("provider")
	kind, ok := providerKind(name)
	app := s.cal.app(kind)
	if !ok || app == nil {
		return notFound("Сервис календаря")
	}
	u, _ := store.UserFrom(r.Context())
	nonce := make([]byte, 12)
	_, _ = rand.Read(nonce)
	state, err := s.signState(oauthState{
		User: u.ID, Provider: name, Expires: time.Now().Add(oauthStateTTL).Unix(),
		Nonce: base64.RawURLEncoding.EncodeToString(nonce),
	})
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: oauthCookie, Value: base64.RawURLEncoding.EncodeToString(nonce),
		Path: "/api/integrations/oauth/", MaxAge: int(oauthStateTTL / time.Second),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r),
	})
	writeJSON(w, http.StatusOK, map[string]string{"url": app.AuthCodeURL(state, s.redirectURL(r, name))})
	return nil
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// oauthCallback — возврат со страницы согласия: меняем код на токены, сохраняем
// подключение, сразу синхронизируем и возвращаем пользователя в приложение.
// Маршрут публичный (браузер приходит без Bearer) — пользователя определяет подписанный state.
func (s *server) oauthCallback(w http.ResponseWriter, r *http.Request) error {
	name := r.PathValue("provider")
	back := func(status, msg string) error {
		q := url.Values{"calendars": {status}}
		if msg != "" {
			q.Set("message", msg)
		}
		http.Redirect(w, r, "/?"+q.Encode(), http.StatusSeeOther)
		return nil
	}
	kind, ok := providerKind(name)
	app := s.cal.app(kind)
	if !ok || app == nil {
		return back("error", "Подключение к этому сервису выключено на сервере")
	}
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		if e == "access_denied" {
			return back("error", "Доступ к календарю не выдан")
		}
		return back("error", "Сервис отказал во входе: "+e)
	}
	st, ok := s.parseState(q.Get("state"))
	cookie, cerr := r.Cookie(oauthCookie)
	// Cookie одноразовая: стираем сразу, чем бы ни закончился колбэк.
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Path: "/api/integrations/oauth/", MaxAge: -1, HttpOnly: true})
	if !ok || st.Provider != name {
		return back("error", "Ссылка входа устарела — начните подключение заново")
	}
	if cerr != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(st.Nonce)) != 1 {
		return back("error", "Начните подключение заново в этом же браузере")
	}
	u, err := s.store.UserByID(r.Context(), st.User)
	if err != nil {
		return back("error", "Аккаунт не найден")
	}
	ctx := store.WithUser(r.Context(), u)
	tctx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	tok, email, err := app.Exchange(tctx, s.cal.net, q.Get("code"), s.redirectURL(r, name))
	if err != nil {
		return back("error", describeSyncError(err))
	}
	raw, err := json.Marshal(tok)
	if err != nil {
		return err
	}
	sealed, err := s.cal.box.Seal(string(raw))
	if err != nil {
		return err
	}

	existing := s.store.Integrations(ctx)
	// Тот же аккаунт подключают повторно — обновляем токены, а не плодим дубли.
	i := slices.IndexFunc(existing, func(x model.Integration) bool {
		return x.Kind == kind && email != "" && strings.EqualFold(x.Username, email)
	})
	var integ model.Integration
	if i >= 0 {
		integ = existing[i]
	} else {
		if len(existing) >= maxIntegrations {
			return back("error", "Подключено слишком много календарей — уберите лишние")
		}
		integ = model.Integration{
			Kind: kind, Name: map[model.IntegrationKind]string{model.IntegrationGoogle: "Google Календарь", model.IntegrationOutlook: "Outlook"}[kind],
			Username: email, CalendarID: "primary", Badge: model.BadgeRoutine, Writable: true,
			// Первый записываемый календарь становится основным: новые события сразу уходят туда.
			Primary: !slices.ContainsFunc(existing, func(x model.Integration) bool { return x.Primary }),
		}
	}
	integ.Secret = sealed
	integ.LastError = ""
	saved, err := s.store.SaveIntegration(ctx, integ)
	if err != nil {
		return err
	}
	if _, err := s.syncIntegration(ctx, saved.ID); err != nil {
		return back("error", "Подключили, но события не загрузились: "+describeSyncError(err))
	}
	return back("connected", "")
}

// --- Лента .ics: наш календарь в других приложениях --------------------------

func feedPath(token string) string {
	if token == "" {
		return ""
	}
	return "/api/feed/" + token + ".ics"
}

func (s *server) getFeed(w http.ResponseWriter, r *http.Request) error {
	token, err := s.store.FeedToken(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": feedPath(token)})
	return nil
}

// resetFeed включает ленту или меняет секрет ссылки (старая перестаёт работать).
func (s *server) resetFeed(w http.ResponseWriter, r *http.Request) error {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	if err := s.store.SetFeedToken(r.Context(), token); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": feedPath(token)})
	return nil
}

func (s *server) disableFeed(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.SetFeedToken(r.Context(), ""); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// feedPastDays — сколько прошлых дней попадает в ленту.
const feedPastDays = 90

// serveFeed отдаёт события пользователя в iCalendar. Публичный маршрут: доступ — по секрету в ссылке.
// В ленте только события, созданные в приложении: события подключённых календарей
// и так есть в исходных, а их повтор дал бы дубли.
func (s *server) serveFeed(w http.ResponseWriter, r *http.Request) error {
	token, ok := strings.CutSuffix(r.PathValue("file"), ".ics")
	if !ok || token == "" {
		return notFound("Календарь")
	}
	u, err := s.store.UserByFeedToken(r.Context(), token)
	if err != nil {
		return notFound("Календарь")
	}
	ctx := store.WithUser(r.Context(), u)
	loc := s.cal.location(u)
	now := s.cal.now()
	from := now.In(loc).AddDate(0, 0, -feedPastDays).Format(time.DateOnly)
	to := now.In(loc).AddDate(0, 0, syncFutureDays).Format(time.DateOnly)
	var comps []*calsync.Component
	for _, e := range s.store.EventsBetween(ctx, from, to) {
		if e.Source != "" {
			continue
		}
		it, ok := calsync.ItemOf(e, loc)
		if !ok {
			continue
		}
		stamp := e.CreatedAt
		if stamp.IsZero() {
			stamp = now
		}
		comps = append(comps, calsync.NewEventComponent(e.ID+"@ai-calendar", it, stamp))
	}
	name := "AI Календарь"
	if u.Name != "" {
		name += " · " + u.Name
	}
	body := calsync.Encode(calsync.NewCalendar(name, comps...))
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", `inline; filename="calendar.ics"`)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	_, _ = w.Write(body)
	return nil
}
