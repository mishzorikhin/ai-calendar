// Package webpush отправляет уведомления Web Push без сторонних сервисов и
// библиотек: подпись VAPID (RFC 8292) и шифрование содержимого aes128gcm (RFC 8291).
//
// Ключ VAPID — своя пара P-256, ни у кого не регистрируется. Сервис доставки
// (FCM у Chrome, autopush у Firefox, APNs у Safari) выбирает браузер: он выдаёт
// адрес подписки, а сервер шлёт туда зашифрованное сообщение, которое сервис
// доставки прочитать не может.
package webpush

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ErrGone — подписки больше нет (браузер отписался, приложение удалено): её надо забыть.
var ErrGone = errors.New("подписка больше не действует")

// MaxPayload — предел открытого текста: сервисы доставки принимают до 4096 байт
// зашифрованного тела, из них 103 уходят на заголовок, разделитель и тег AES-GCM.
const MaxPayload = 3993

// recordSize — размер записи aes128gcm в заголовке; сообщение всегда в одной записи.
const recordSize = 4096

var b64 = base64.RawURLEncoding

// Keys — пара ключей VAPID.
type Keys struct {
	priv *ecdsa.PrivateKey
	// public — открытый ключ в несжатом виде (65 байт): его получает браузер как applicationServerKey.
	public []byte
}

// GenerateKey создаёт новый закрытый ключ VAPID (base64url, 32 байта).
func GenerateKey() (string, error) {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	return b64.EncodeToString(k.Bytes()), nil
}

// ParseKeys восстанавливает пару из закрытого ключа в base64url (как у GenerateKey и web-push).
func ParseKeys(private string) (*Keys, error) {
	raw, err := decodeB64(private)
	if err != nil {
		return nil, fmt.Errorf("ключ VAPID: %w", err)
	}
	k, err := ecdh.P256().NewPrivateKey(raw)
	if err != nil {
		return nil, fmt.Errorf("ключ VAPID: %w", err)
	}
	pub := k.PublicKey().Bytes()
	return &Keys{
		priv: &ecdsa.PrivateKey{
			PublicKey: ecdsa.PublicKey{
				Curve: elliptic.P256(),
				X:     new(big.Int).SetBytes(pub[1:33]),
				Y:     new(big.Int).SetBytes(pub[33:65]),
			},
			D: new(big.Int).SetBytes(raw),
		},
		public: pub,
	}, nil
}

// PublicKey — открытый ключ в base64url для pushManager.subscribe.
func (k *Keys) PublicKey() string { return b64.EncodeToString(k.public) }

// decodeB64 принимает base64url и обычный base64, с выравниванием и без: браузеры и
// библиотеки отдают ключи подписки по-разному.
func decodeB64(s string) ([]byte, error) {
	for _, enc := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return b, nil
		}
	}
	return nil, errors.New("неверный base64")
}

// Subscription — подписка браузера (PushSubscription.toJSON()).
type Subscription struct {
	Endpoint string
	// P256DH — открытый ключ браузера (65 байт), Auth — общий секрет (16 байт); оба в base64url.
	P256DH string
	Auth   string
}

// Validate проверяет ключи подписки, не отправляя ничего.
func (s Subscription) Validate() error {
	if _, err := parseSubscriptionKeys(s); err != nil {
		return err
	}
	return nil
}

type subscriptionKeys struct {
	ua   *ecdh.PublicKey
	auth []byte
}

func parseSubscriptionKeys(s Subscription) (subscriptionKeys, error) {
	pub, err := decodeB64(s.P256DH)
	if err != nil || len(pub) != 65 {
		return subscriptionKeys{}, errors.New("ключ p256dh подписки неверный")
	}
	ua, err := ecdh.P256().NewPublicKey(pub)
	if err != nil {
		return subscriptionKeys{}, errors.New("ключ p256dh подписки неверный")
	}
	auth, err := decodeB64(s.Auth)
	if err != nil || len(auth) != 16 {
		return subscriptionKeys{}, errors.New("секрет auth подписки неверный")
	}
	return subscriptionKeys{ua: ua, auth: auth}, nil
}

// Encrypt шифрует сообщение для подписки (RFC 8291, aes128gcm): свежий
// одноразовый ключ сервера и случайная соль на каждое сообщение.
func Encrypt(s Subscription, payload []byte) ([]byte, error) {
	keys, err := parseSubscriptionKeys(s)
	if err != nil {
		return nil, err
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return encrypt(keys, payload, as, salt)
}

func encrypt(keys subscriptionKeys, payload []byte, as *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(payload) > MaxPayload {
		return nil, fmt.Errorf("сообщение длиннее %d байт", MaxPayload)
	}
	shared, err := as.ECDH(keys.ua)
	if err != nil {
		return nil, err
	}
	asPub := as.PublicKey().Bytes()
	uaPub := keys.ua.Bytes()

	// IKM = HKDF(auth, ecdh, "WebPush: info" || 0 || ua_public || as_public, 32)
	info := append(append([]byte("WebPush: info\x00"), uaPub...), asPub...)
	ikm, err := hkdf.Key(sha256.New, shared, keys.auth, string(info), 32)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// Одна запись: текст и разделитель последней записи 0x02, без дополнения.
	plain := append(append(make([]byte, 0, len(payload)+1), payload...), 0x02)

	var out bytes.Buffer
	out.Write(salt)
	_ = binary.Write(&out, binary.BigEndian, uint32(recordSize))
	out.WriteByte(byte(len(asPub)))
	out.Write(asPub)
	out.Write(gcm.Seal(nil, nonce, plain, nil))
	return out.Bytes(), nil
}

// Urgency — срочность доставки (RFC 8030): сервис может придержать несрочное ради батареи.
type Urgency string

const (
	UrgencyNormal Urgency = "normal"
	UrgencyHigh   Urgency = "high"
)

// Message — что и как отправить.
type Message struct {
	Payload []byte
	// TTL — сколько сервис доставки хранит сообщение для выключенного устройства; 0 — не хранить.
	TTL     time.Duration
	Urgency Urgency
	// Topic — новое сообщение с той же темой заменяет недоставленное (до 32 символов base64url).
	Topic string
}

// Doer выполняет HTTP-запрос и читает тело ответа (calsync.Net — с запретом внутренней сети).
type Doer interface {
	Do(ctx context.Context, method, rawURL string, header http.Header, body []byte) (*http.Response, []byte, error)
}

// Sender подписывает и отправляет сообщения.
type Sender struct {
	keys *Keys
	// subject — контакт владельца сервера для сервиса доставки (mailto: или https:).
	subject string
	doer    Doer
	now     func() time.Time
}

// NewSender собирает отправителя.
func NewSender(keys *Keys, subject string, doer Doer) *Sender {
	return &Sender{keys: keys, subject: subject, doer: doer, now: time.Now}
}

// Keys — ключи отправителя.
func (s *Sender) Keys() *Keys { return s.keys }

// StatusError — сервис доставки не принял сообщение.
type StatusError struct {
	Status int
	Body   string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("сервис доставки ответил %d: %s", e.Status, e.Body)
}

// Send шифрует и отправляет сообщение. ErrGone — подписку надо удалить.
func (s *Sender) Send(ctx context.Context, sub Subscription, msg Message) error {
	endpoint, err := url.Parse(sub.Endpoint)
	if err != nil || endpoint.Host == "" {
		return errors.New("неверный адрес подписки")
	}
	body, err := Encrypt(sub, msg.Payload)
	if err != nil {
		return err
	}
	jwt, err := s.token(endpoint.Scheme + "://" + endpoint.Host)
	if err != nil {
		return err
	}
	header := http.Header{}
	header.Set("Authorization", "vapid t="+jwt+", k="+s.keys.PublicKey())
	header.Set("Content-Encoding", "aes128gcm")
	header.Set("Content-Type", "application/octet-stream")
	header.Set("TTL", strconv.Itoa(int(msg.TTL/time.Second)))
	if msg.Urgency != "" {
		header.Set("Urgency", string(msg.Urgency))
	}
	if msg.Topic != "" {
		header.Set("Topic", msg.Topic)
	}
	resp, data, err := s.doer.Do(ctx, http.MethodPost, sub.Endpoint, header, body)
	if err != nil {
		return err
	}
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrGone
	}
	text := string(data)
	if len(text) > 200 {
		text = text[:200]
	}
	return &StatusError{Status: resp.StatusCode, Body: text}
}

// tokenTTL — срок подписи VAPID; сервисы принимают не больше суток.
const tokenTTL = 12 * time.Hour

// token — JWT ES256 для origin сервиса доставки.
func (s *Sender) token(audience string) (string, error) {
	header := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, err := json.Marshal(map[string]any{
		"aud": audience,
		"exp": s.now().Add(tokenTTL).Unix(),
		"sub": s.subject,
	})
	if err != nil {
		return "", err
	}
	unsigned := header + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	r, sv, err := ecdsa.Sign(rand.Reader, s.keys.priv, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	sv.FillBytes(sig[32:])
	return unsigned + "." + b64.EncodeToString(sig), nil
}

// HTTPDoer — простой Doer поверх http.Client (для тестов и доверенной сети).
type HTTPDoer struct{ Client *http.Client }

func (d HTTPDoer) Do(ctx context.Context, method, rawURL string, header http.Header, body []byte) (*http.Response, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header = header
	client := d.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return resp, data, err
}
