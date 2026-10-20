// Аутентификация: регистрация, вход по паролю, Bearer-сессии.
// Пароль — PBKDF2-SHA256 (стандартная библиотека, OWASP-итерации);
// токен — 32 случайных байта, в хранилище лежит его SHA-256.
package api

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

const (
	// pbkdf2Iter — рекомендация OWASP для PBKDF2-HMAC-SHA256.
	pbkdf2Iter   = 210_000
	passwordMin  = 6
	passwordMax  = 128
	userNameMax  = 40
	tokenBytes   = 32
	bearerPrefix = "bearer "
)

// usernameRe — логин как в Telegram: латиница, начинается с буквы, 3–24 знака.
var usernameRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{2,23}$`)

// hashPassword → "pbkdf2$iters$salt_hex$hash_hex".
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	dk, err := pbkdf2.Key(sha256.New, password, salt, pbkdf2Iter, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2$%d$%s$%s", pbkdf2Iter, hex.EncodeToString(salt), hex.EncodeToString(dk)), nil
}

// checkPassword сверяет пароль с хранимым хэшем в постоянном времени.
func checkPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	var iter int
	if _, err := fmt.Sscanf(parts[1], "%d", &iter); err != nil || iter <= 0 {
		return false
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[3])
	if err != nil {
		return false
	}
	dk, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(dk, want) == 1
}

// dummyHash вычисляется при первом логине в несуществующий аккаунт — чтобы
// ответ занимал столько же времени, как и для существующего (без оракула «такой логин есть»).
var dummyHash = func() string {
	h, err := hashPassword("dummy")
	if err != nil {
		return ""
	}
	return h
}()

func newToken() (string, error) {
	raw := make([]byte, tokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// tokenHash — ключ сессии: SHA-256 токена, сам токен на сервере не хранится.
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// bearerToken достаёт токен из заголовка Authorization (регистр схемы не важен, токена — важен).
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > len(bearerPrefix) && strings.EqualFold(h[:len(bearerPrefix)], bearerPrefix) {
		return strings.TrimSpace(h[len(bearerPrefix):])
	}
	return ""
}

func unauthorized() error {
	return &apiError{Status: http.StatusUnauthorized, Message: "Нужен вход в аккаунт"}
}

// authed оборачивает обработчик: Bearer-токен → пользователь в контексте запроса.
func (s *server) authed(h handlerFunc) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		token := bearerToken(r)
		if token == "" {
			return unauthorized()
		}
		u, err := s.store.UserBySession(r.Context(), tokenHash(token))
		if err != nil {
			return unauthorized()
		}
		return h(w, r.WithContext(store.WithUser(r.Context(), u)))
	}
}

// publicUser — пользователь для ответа API (без хэша пароля).
func publicUser(u model.User) model.User {
	u.PassHash = ""
	return u
}

type authInput struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (in *authInput) validate(register bool) error {
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	in.Name = strings.TrimSpace(in.Name)
	if !usernameRe.MatchString(in.Username) {
		return badRequest("Логин — латиница: буква, затем буквы, цифры, _ . - (3–24 знака)")
	}
	if register && in.Name == "" {
		in.Name = in.Username
	}
	if utf8.RuneCountInString(in.Name) > userNameMax {
		return badRequest("Имя не длиннее %d символов", userNameMax)
	}
	if n := utf8.RuneCountInString(in.Password); n < passwordMin || n > passwordMax {
		return badRequest("Пароль — от %d до %d символов", passwordMin, passwordMax)
	}
	return nil
}

// issueSession создаёт сессию и отдаёт её клиенту.
func (s *server) issueSession(r *http.Request, u model.User) (map[string]any, error) {
	token, err := newToken()
	if err != nil {
		return nil, err
	}
	if err := s.store.CreateSession(r.Context(), u.ID, tokenHash(token), time.Now().Add(store.SessionTTL)); err != nil {
		return nil, err
	}
	return map[string]any{"user": publicUser(u), "token": token}, nil
}

func (s *server) register(w http.ResponseWriter, r *http.Request) error {
	var in authInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := in.validate(true); err != nil {
		return err
	}
	hash, err := hashPassword(in.Password)
	if err != nil {
		return err
	}
	u, err := s.store.CreateUser(r.Context(), in.Username, in.Name, hash)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			return &apiError{Status: http.StatusConflict, Message: "Имя @" + in.Username + " уже занято"}
		}
		return err
	}
	out, err := s.issueSession(r, u)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *server) login(w http.ResponseWriter, r *http.Request) error {
	var in authInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	u, err := s.store.UserByUsername(r.Context(), in.Username)
	if err != nil {
		// Гоним PBKDF2 и для несуществующего логина: ответ «всегда 401 через ~время хэша».
		checkPassword(in.Password, dummyHash)
		return &apiError{Status: http.StatusUnauthorized, Message: "Неверное имя или пароль"}
	}
	if !checkPassword(in.Password, u.PassHash) {
		return &apiError{Status: http.StatusUnauthorized, Message: "Неверное имя или пароль"}
	}
	out, err := s.issueSession(r, u)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *server) logout(_ http.ResponseWriter, r *http.Request) error {
	if token := bearerToken(r); token != "" {
		_ = s.store.DeleteSession(r.Context(), tokenHash(token))
	}
	return nil
}

func (s *server) me(w http.ResponseWriter, r *http.Request) error {
	u, _ := store.UserFrom(r.Context())
	writeJSON(w, http.StatusOK, publicUser(u))
	return nil
}

type mePatchInput struct {
	Name *string `json:"name"`
}

func (s *server) updateMe(w http.ResponseWriter, r *http.Request) error {
	var in mePatchInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Name != nil {
		*in.Name = strings.TrimSpace(*in.Name)
		if *in.Name == "" || utf8.RuneCountInString(*in.Name) > userNameMax {
			return badRequest("Имя обязательно и не длиннее %d символов", userNameMax)
		}
		u, err := s.store.UpdateUser(r.Context(), *in.Name)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, publicUser(u))
		return nil
	}
	u, _ := store.UserFrom(r.Context())
	writeJSON(w, http.StatusOK, publicUser(u))
	return nil
}

// searchUsers — подсказки для @упоминаний: /api/users?q=анн.
func (s *server) searchUsers(w http.ResponseWriter, r *http.Request) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	users := s.store.SearchUsers(r.Context(), q, 10)
	out := make([]model.User, 0, len(users))
	for _, u := range users {
		out = append(out, publicUser(u))
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}
