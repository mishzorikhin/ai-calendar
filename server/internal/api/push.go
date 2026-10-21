// Уведомления Web Push: подписки устройств, настройки напоминаний, проверка,
// «отложить» из уведомления и фоновая рассылка напоминаний (reminders.go).
//
// Своя пара ключей VAPID создаётся при первом запуске и хранится в хранилище
// (или задаётся VAPID_PRIVATE_KEY): никаких аккаунтов во внешних сервисах.
// Содержимое шифруется для устройства, сервис доставки браузера его не видит.
package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

// PushOptions — настройки уведомлений.
type PushOptions struct {
	// PrivateKey — закрытый ключ VAPID (base64url); пусто — создаётся и хранится в хранилище.
	PrivateKey string
	// Subject — контакт для сервисов доставки (mailto: или https:); пусто — PublicURL или страница проекта.
	Subject string
	// Interval — период проверки напоминаний; 0 — без фоновой рассылки.
	Interval time.Duration
	// Background — контекст жизни сервера для фоновой рассылки.
	Background context.Context
	// Doer — HTTP-клиент для сервисов доставки; nil — с запретом внутренней сети, как у календарей.
	Doer webpush.Doer
}

const (
	vapidKeyName = "vapid"
	// defaultSubject — контакт, если владелец сервера свой не указал.
	defaultSubject = "https://github.com/mishzorikhin/ai-calendar"
	// sendTimeout — предел одной отправки в сервис доставки.
	sendTimeout = 15 * time.Second
	maxEndpoint = 2048
)

type pushService struct {
	opts PushOptions
	doer webpush.Doer

	mu     sync.Mutex
	sender *webpush.Sender
}

func newPushService(opts PushOptions, cal *calendars) *pushService {
	if opts.Subject == "" {
		opts.Subject = defaultSubject
		if pub := cal.opts.PublicURL; strings.HasPrefix(pub, "https://") {
			opts.Subject = strings.TrimSuffix(pub, "/")
		}
	}
	doer := opts.Doer
	if doer == nil {
		doer = cal.net
	}
	return &pushService{opts: opts, doer: doer}
}

// pushSender — отправитель с ключом VAPID; ключ читается (или создаётся) один раз.
func (s *server) pushSender(ctx context.Context) (*webpush.Sender, error) {
	p := s.push
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.sender != nil {
		return p.sender, nil
	}
	priv := p.opts.PrivateKey
	if priv == "" {
		var err error
		priv, err = s.store.ServerKey(ctx, vapidKeyName, webpush.GenerateKey)
		if err != nil {
			return nil, err
		}
	}
	keys, err := webpush.ParseKeys(priv)
	if err != nil {
		return nil, err
	}
	p.sender = webpush.NewSender(keys, p.opts.Subject, p.doer)
	return p.sender, nil
}

// pushView — состояние уведомлений для приложения.
type pushView struct {
	// PublicKey — applicationServerKey для pushManager.subscribe.
	PublicKey string               `json:"publicKey"`
	Settings  model.NotifySettings `json:"settings"`
	// Devices — сколько устройств пользователя подписано.
	Devices int `json:"devices"`
}

func (s *server) getPush(w http.ResponseWriter, r *http.Request) error {
	sender, err := s.pushSender(r.Context())
	if err != nil {
		return err
	}
	ns, err := s.store.NotifySettings(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, pushView{
		PublicKey: sender.Keys().PublicKey(),
		Settings:  ns,
		Devices:   len(s.store.PushSubscriptions(r.Context())),
	})
	return nil
}

type notifySettingsInput struct {
	EventReminder *int `json:"eventReminder"`
	TaskTime      *int `json:"taskTime"`
	Digest        *int `json:"digest"`
}

func (s *server) updateNotifySettings(w http.ResponseWriter, r *http.Request) error {
	var in notifySettingsInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	ns, err := s.store.NotifySettings(r.Context())
	if err != nil {
		return err
	}
	if in.EventReminder != nil {
		if v := *in.EventReminder; v != -1 && (v < 0 || v > model.MaxReminderMinutes) {
			return badRequest("Напоминание о событии — от 0 до %d минут или -1", model.MaxReminderMinutes)
		}
		ns.EventReminder = *in.EventReminder
	}
	for _, f := range []struct {
		v    *int
		dst  *int
		name string
	}{{in.TaskTime, &ns.TaskTime, "Время напоминания о задачах"}, {in.Digest, &ns.Digest, "Время сводки"}} {
		if f.v == nil {
			continue
		}
		if *f.v != -1 && (*f.v < 0 || *f.v >= dayMinutes) {
			return badRequest("%s — минуты от полуночи (0–1439) или -1", f.name)
		}
		*f.dst = *f.v
	}
	if err := s.store.SetNotifySettings(r.Context(), ns); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, ns)
	return nil
}

type subscriptionInput struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	// ExpirationTime — поле PushSubscription.toJSON(); не используется.
	ExpirationTime *float64 `json:"expirationTime"`
}

// validEndpoint — адрес сервиса доставки: только https (http — в тестах с AllowPrivate).
func (s *server) validEndpoint(raw string) error {
	if raw == "" || len(raw) > maxEndpoint {
		return badRequest("Адрес подписки пустой или слишком длинный")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil ||
		(u.Scheme != "https" && !(u.Scheme == "http" && s.cal.opts.AllowPrivate)) {
		return badRequest("Адрес подписки должен быть https")
	}
	return nil
}

func (s *server) subscribePush(w http.ResponseWriter, r *http.Request) error {
	var in subscriptionInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := s.validEndpoint(in.Endpoint); err != nil {
		return err
	}
	sub := webpush.Subscription{Endpoint: in.Endpoint, P256DH: in.Keys.P256DH, Auth: in.Keys.Auth}
	if err := sub.Validate(); err != nil {
		return badRequest("Подписка браузера неверная: %v", err)
	}
	err := s.store.SavePushSubscription(r.Context(), model.PushSubscription{
		Endpoint: in.Endpoint, P256DH: in.Keys.P256DH, Auth: in.Keys.Auth,
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type unsubscribeInput struct {
	Endpoint string `json:"endpoint"`
}

func (s *server) unsubscribePush(w http.ResponseWriter, r *http.Request) error {
	var in unsubscribeInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Endpoint == "" {
		return badRequest("Нужен адрес подписки")
	}
	if err := s.store.DeletePushSubscription(r.Context(), in.Endpoint); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *server) testPush(w http.ResponseWriter, r *http.Request) error {
	sent, err := s.pushTo(r.Context(), model.PushMessage{
		Kind:  model.PushTest,
		Title: "Уведомления работают",
		Body:  "Так будут выглядеть напоминания о встречах и задачах",
		URL:   "/",
		Tag:   "test",
	}, pushOpts{ttl: 5 * time.Minute, urgency: webpush.UrgencyHigh})
	if err != nil {
		return err
	}
	if sent == 0 {
		return &apiError{Status: http.StatusConflict, Message: "Уведомления не включены ни на одном устройстве"}
	}
	writeJSON(w, http.StatusOK, map[string]int{"sent": sent})
	return nil
}

// Пределы полей уведомления, которое приложение просит отложить.
const (
	maxPushTitle = 200
	maxPushBody  = 500
	maxPushTag   = 120
	maxSnoozeMin = 24 * 60
)

type snoozeInput struct {
	Message model.PushMessage `json:"message"`
	Minutes int               `json:"minutes"`
}

// validPushMessage — уведомление от клиента: свои виды, разумные длины, только адреса приложения.
func validPushMessage(m model.PushMessage) error {
	switch m.Kind {
	case model.PushEvent, model.PushTask, model.PushDigest, model.PushShare, model.PushTest:
	default:
		return badRequest("Неизвестный вид уведомления: %q", m.Kind)
	}
	if strings.TrimSpace(m.Title) == "" || utf8.RuneCountInString(m.Title) > maxPushTitle {
		return badRequest("Заголовок уведомления обязателен и не длиннее %d символов", maxPushTitle)
	}
	if utf8.RuneCountInString(m.Body) > maxPushBody || len(m.Tag) > maxPushTag || len(m.TaskID) > maxPushTag {
		return badRequest("Уведомление слишком длинное")
	}
	// Открываем только страницы приложения: «/», «/#day/…», без чужих доменов.
	if m.URL != "" && (!strings.HasPrefix(m.URL, "/") || strings.HasPrefix(m.URL, "//") || strings.Contains(m.URL, `\`)) {
		return badRequest("Адрес уведомления должен вести в приложение")
	}
	return nil
}

func (s *server) snoozePush(w http.ResponseWriter, r *http.Request) error {
	var in snoozeInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Minutes < 1 || in.Minutes > maxSnoozeMin {
		return badRequest("Отложить можно на 1–%d минут", maxSnoozeMin)
	}
	if err := validPushMessage(in.Message); err != nil {
		return err
	}
	err := s.store.AddSnooze(r.Context(), s.cal.now().Add(time.Duration(in.Minutes)*time.Minute), in.Message)
	if errors.Is(err, store.ErrLimit) {
		return &apiError{Status: http.StatusConflict, Message: "Слишком много отложенных напоминаний"}
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// pushOpts — как доставлять: сколько хранить для выключенного устройства и насколько срочно.
type pushOpts struct {
	ttl     time.Duration
	urgency webpush.Urgency
}

// pushTo отправляет уведомление на все устройства пользователя из контекста.
// Возвращает, на сколько устройств сервис доставки его принял. Подписки,
// которых больше нет, удаляются; прочие ошибки — в лог (без адреса подписки).
func (s *server) pushTo(ctx context.Context, msg model.PushMessage, o pushOpts) (int, error) {
	subs := s.store.PushSubscriptions(ctx)
	if len(subs) == 0 {
		return 0, nil
	}
	sender, err := s.pushSender(ctx)
	if err != nil {
		return 0, err
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return 0, err
	}
	topic := ""
	if msg.Tag != "" {
		// Тема — до 32 символов base64url: новое уведомление о том же событии заменяет недоставленное.
		sum := sha256.Sum256([]byte(msg.Tag))
		topic = base64.RawURLEncoding.EncodeToString(sum[:])[:32]
	}
	sent := 0
	for _, sub := range subs {
		sctx, cancel := context.WithTimeout(ctx, sendTimeout)
		err := sender.Send(sctx, webpush.Subscription{Endpoint: sub.Endpoint, P256DH: sub.P256DH, Auth: sub.Auth},
			webpush.Message{Payload: payload, TTL: o.ttl, Urgency: o.urgency, Topic: topic})
		cancel()
		switch {
		case err == nil:
			sent++
		case errors.Is(err, webpush.ErrGone):
			_ = s.store.DeletePushSubscription(ctx, sub.Endpoint)
		default:
			slog.Warn("уведомление не отправлено", "service", hostOnly(sub.Endpoint), "err", err)
		}
	}
	return sent, nil
}

// pushToUser — уведомление другому пользователю (например, о задаче, которой с ним поделились).
// Отправка идёт в фоне: ответ на запрос не ждёт сервиса доставки.
func (s *server) pushToUser(to model.User, msg model.PushMessage, o pushOpts) {
	ctx := s.push.opts.Background
	if ctx == nil {
		ctx = context.Background()
	}
	go func() {
		ctx, cancel := context.WithTimeout(store.WithUser(ctx, to), time.Minute)
		defer cancel()
		_, _ = s.pushTo(ctx, msg, o)
	}()
}
