// Аккаунт: сессии устройств, смена пароля, выгрузка всех своих данных и удаление аккаунта.
package api

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// currentHash — хэш токена этого запроса.
func currentHash(r *http.Request) string { return tokenHash(bearerToken(r)) }

func (s *server) listSessions(w http.ResponseWriter, r *http.Request) error {
	current := currentHash(r)
	list := nonNil(s.store.Sessions(r.Context()))
	for i := range list {
		list[i].Current = strings.HasPrefix(current, list[i].ID)
	}
	writeJSON(w, http.StatusOK, list)
	return nil
}

func (s *server) deleteSession(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteSessionByID(r.Context(), r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Сеанс")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *server) logoutOthers(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteOtherSessions(r.Context(), currentHash(r)); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// checkOwnPassword — пароль текущего пользователя верный. Попытки ограничены, как у входа:
// украденным токеном нельзя подобрать пароль, чтобы сменить его или удалить аккаунт.
func (s *server) checkOwnPassword(w http.ResponseWriter, r *http.Request, password string) error {
	u, _ := store.UserFrom(r.Context())
	if ok, wait := s.limits.loginUser.allow(u.Username + "|" + s.clientIP(r)); !ok {
		return tooMany(w, wait)
	}
	full, err := s.store.UserByUsername(r.Context(), u.Username)
	if err != nil {
		return err
	}
	var match bool
	if slotErr := s.withHashSlot(r, func() { match = checkPassword(password, full.PassHash) }); slotErr != nil {
		return slotErr
	}
	if !match {
		return &apiError{Status: http.StatusForbidden, Message: "Неверный пароль"}
	}
	return nil
}

func (s *server) changePassword(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if n := utf8.RuneCountInString(in.Next); n < passwordMin || n > passwordMax {
		return badRequest("Новый пароль — от %d до %d символов", passwordMin, passwordMax)
	}
	if err := s.checkOwnPassword(w, r, in.Current); err != nil {
		return err
	}
	var hash string
	var err error
	if slotErr := s.withHashSlot(r, func() { hash, err = hashPassword(in.Next) }); slotErr != nil {
		return slotErr
	}
	if err != nil {
		return err
	}
	if err := s.store.SetPassword(r.Context(), hash); err != nil {
		return err
	}
	// Пароль меняют, когда боятся утечки: все остальные устройства выходят.
	if err := s.store.DeleteOtherSessions(r.Context(), currentHash(r)); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *server) deleteAccount(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Password string `json:"password"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := s.checkOwnPassword(w, r, in.Password); err != nil {
		return err
	}
	if err := s.store.DeleteUser(r.Context()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// exportIntegration — подключение без секретов: ни паролей и токенов, ни секретной части ссылки.
type exportIntegration struct {
	Kind      model.IntegrationKind `json:"kind"`
	Name      string                `json:"name"`
	URL       string                `json:"url,omitempty"`
	Username  string                `json:"username,omitempty"`
	Badge     model.Badge           `json:"badge"`
	CreatedAt time.Time             `json:"createdAt"`
}

// stripURL — ссылка без запроса и фрагмента (в них у частных .ics лежит ключ доступа).
func stripURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	u.RawQuery, u.Fragment, u.User = "", "", nil
	return u.String()
}

// exportData — все свои данные одним JSON: то, что можно забрать с сервера.
func (s *server) exportData(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	u, _ := store.UserFrom(ctx)
	profile, err := s.store.Profile(ctx)
	if err != nil {
		return err
	}
	notify, err := s.store.NotifySettings(ctx)
	if err != nil {
		return err
	}
	integrations := []exportIntegration{}
	for _, it := range s.store.Integrations(ctx) {
		integrations = append(integrations, exportIntegration{Kind: it.Kind, Name: it.Name, URL: stripURL(it.URL),
			Username: it.Username, Badge: it.Badge, CreatedAt: it.CreatedAt})
	}
	devices := []map[string]any{}
	for _, p := range s.store.PushSubscriptions(ctx) {
		devices = append(devices, map[string]any{"label": p.Label, "createdAt": p.CreatedAt})
	}
	events := s.withAttendees(ctx, s.store.EventsBetween(ctx, "0001-01-01", "9999-12-31"))
	for i := range events {
		events[i].ETag, events[i].ExternalID = "", ""
	}
	out := map[string]any{
		"exportedAt":    time.Now().UTC(),
		"user":          publicUser(u),
		"profile":       profile,
		"notify":        notify,
		"events":        nonNil(events),
		"tasks":         nonNil(s.store.Tasks(ctx)),
		"messages":      nonNil(s.store.Messages(ctx)),
		"memories":      nonNil(s.store.Memories(ctx)),
		"people":        nonNil(s.store.People(ctx)),
		"reminders":     nonNil(s.store.Snoozes(ctx)),
		"integrations":  integrations,
		"pushDevices":   devices,
		"notifications": nonNil(s.store.Notifications(ctx)),
	}
	w.Header().Set("Content-Disposition", `attachment; filename="ai-calendar-`+u.Username+`.json"`)
	writeJSON(w, http.StatusOK, out)
	return nil
}
