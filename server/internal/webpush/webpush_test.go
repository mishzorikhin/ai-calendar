package webpush

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := decodeB64(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Пример из приложения A RFC 8291.
func TestEncryptRFC8291Vector(t *testing.T) {
	as, err := ecdh.P256().NewPrivateKey(mustB64(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	keys, err := parseSubscriptionKeys(Subscription{
		P256DH: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
		Auth:   "BTBZMqHH6r4Tts7J_aSIgg",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := encrypt(keys, []byte("When I grow up, I want to be a watermelon"), as, mustB64(t, "DGv6ra1nlYgDCS1FRnbzlw"))
	if err != nil {
		t.Fatal(err)
	}
	want := "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if b64.EncodeToString(got) != want {
		t.Fatalf("шифротекст не совпал с RFC 8291:\n got %s\nwant %s", b64.EncodeToString(got), want)
	}
}

// decrypt — сторона браузера: расшифровывает сообщение закрытым ключом подписки.
func decrypt(t *testing.T, ua *ecdh.PrivateKey, auth, body []byte) []byte {
	t.Helper()
	salt := body[:16]
	if rs := binary.BigEndian.Uint32(body[16:20]); rs != recordSize {
		t.Fatalf("rs = %d", rs)
	}
	idlen := int(body[20])
	asPub, err := ecdh.P256().NewPublicKey(body[21 : 21+idlen])
	if err != nil {
		t.Fatal(err)
	}
	shared, err := ua.ECDH(asPub)
	if err != nil {
		t.Fatal(err)
	}
	info := append(append([]byte("WebPush: info\x00"), ua.PublicKey().Bytes()...), asPub.Bytes()...)
	ikm, _ := hkdf.Key(sha256.New, shared, auth, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[21+idlen:], nil)
	if err != nil {
		t.Fatalf("не расшифровалось: %v", err)
	}
	if plain[len(plain)-1] != 0x02 {
		t.Fatalf("нет разделителя последней записи: %x", plain[len(plain)-1])
	}
	return plain[:len(plain)-1]
}

// browser — поддельный браузер: ключи подписки.
func browser(t *testing.T) (*ecdh.PrivateKey, []byte, Subscription) {
	t.Helper()
	ua, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := []byte("0123456789abcdef")
	return ua, auth, Subscription{P256DH: b64.EncodeToString(ua.PublicKey().Bytes()), Auth: b64.EncodeToString(auth)}
}

func TestEncryptRoundTrip(t *testing.T) {
	ua, auth, sub := browser(t)
	msg := []byte(`{"title":"Встреча с Глебом","body":"через 10 минут"}`)
	body, err := Encrypt(sub, msg)
	if err != nil {
		t.Fatal(err)
	}
	if got := decrypt(t, ua, auth, body); string(got) != string(msg) {
		t.Fatalf("got %q", got)
	}
	if _, err := Encrypt(sub, make([]byte, MaxPayload+1)); err == nil {
		t.Fatal("слишком длинное сообщение должно отклоняться")
	}
	if body, err := Encrypt(sub, make([]byte, MaxPayload)); err != nil || len(body) > 4096 {
		t.Fatalf("предельное сообщение: %d байт, %v", len(body), err)
	}
}

func TestSubscriptionValidate(t *testing.T) {
	_, _, sub := browser(t)
	if err := sub.Validate(); err != nil {
		t.Fatal(err)
	}
	bad := []Subscription{
		{P256DH: "", Auth: sub.Auth},
		{P256DH: b64.EncodeToString(make([]byte, 65)), Auth: sub.Auth}, // не точка кривой
		{P256DH: sub.P256DH, Auth: "c2hvcnQ"},
		{P256DH: sub.P256DH, Auth: "!!!"},
	}
	for i, s := range bad {
		if s.Validate() == nil {
			t.Errorf("случай %d: ожидали ошибку", i)
		}
	}
}

func TestKeys(t *testing.T) {
	priv, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	k1, err := ParseKeys(priv)
	if err != nil {
		t.Fatal(err)
	}
	k2, _ := ParseKeys(priv)
	if k1.PublicKey() != k2.PublicKey() || len(mustB64(t, k1.PublicKey())) != 65 {
		t.Fatal("открытый ключ должен однозначно выводиться из закрытого")
	}
	if _, err := ParseKeys("bad"); err == nil {
		t.Fatal("ожидали ошибку для неверного ключа")
	}
}

func TestSend(t *testing.T) {
	priv, _ := GenerateKey()
	keys, _ := ParseKeys(priv)
	ua, auth, sub := browser(t)

	var got struct {
		header http.Header
		body   []byte
	}
	status := http.StatusCreated
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.header = r.Header.Clone()
		got.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	sub.Endpoint = srv.URL + "/push/abc"

	s := NewSender(keys, "mailto:admin@example.com", HTTPDoer{})
	now := time.Unix(1_800_000_000, 0)
	s.now = func() time.Time { return now }
	err := s.Send(context.Background(), sub, Message{Payload: []byte("привет"), TTL: 90 * time.Second, Urgency: UrgencyHigh, Topic: "evt-1"})
	if err != nil {
		t.Fatal(err)
	}
	h := got.header
	if h.Get("Content-Encoding") != "aes128gcm" || h.Get("TTL") != "90" || h.Get("Urgency") != "high" || h.Get("Topic") != "evt-1" {
		t.Fatalf("заголовки: %v", h)
	}
	if plain := decrypt(t, ua, auth, got.body); string(plain) != "привет" {
		t.Fatalf("тело: %q", plain)
	}

	// Подпись VAPID: k — наш ключ, JWT подписан им, aud — origin сервиса доставки.
	authz := h.Get("Authorization")
	tok, k, ok := strings.Cut(strings.TrimPrefix(authz, "vapid t="), ", k=")
	if !ok || k != keys.PublicKey() {
		t.Fatalf("Authorization: %q", authz)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("JWT: %q", tok)
	}
	var claims struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(mustB64(t, parts[1]), &claims); err != nil {
		t.Fatal(err)
	}
	if claims.Aud != srv.URL || claims.Sub != "mailto:admin@example.com" || claims.Exp != now.Add(tokenTTL).Unix() {
		t.Fatalf("claims: %+v", claims)
	}
	sig := mustB64(t, parts[2])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(&keys.priv.PublicKey, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("подпись JWT не проверяется")
	}

	status = http.StatusGone
	if err := s.Send(context.Background(), sub, Message{Payload: []byte("x")}); !errors.Is(err, ErrGone) {
		t.Fatalf("410: %v", err)
	}
	status = http.StatusNotFound
	if err := s.Send(context.Background(), sub, Message{Payload: []byte("x")}); !errors.Is(err, ErrGone) {
		t.Fatalf("404: %v", err)
	}
	status = http.StatusTooManyRequests
	var se *StatusError
	if err := s.Send(context.Background(), sub, Message{Payload: []byte("x")}); !errors.As(err, &se) || se.Status != 429 {
		t.Fatalf("429: %v", err)
	}
}
