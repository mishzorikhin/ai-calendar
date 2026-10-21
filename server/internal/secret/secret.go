// Package secret шифрует то, что нельзя хранить открытым текстом: пароли CalDAV
// и OAuth-токены внешних календарей. AES-256-GCM, ключ — из SECRET_KEY или файла.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// prefix помечает формат шифротекста, чтобы позже можно было сменить алгоритм.
const prefix = "v1:"

// Box шифрует и расшифровывает строки одним ключом.
type Box struct {
	aead cipher.AEAD
	mac  []byte
}

// New собирает Box из ключа произвольной длины: из него выводятся отдельные
// ключи шифрования и подписи (sha256 с разными метками).
func New(key []byte) (*Box, error) {
	if len(key) == 0 {
		return nil, errors.New("пустой ключ шифрования")
	}
	encKey := derive(key, "encrypt")
	block, err := aes.NewCipher(encKey)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead, mac: derive(key, "sign")}, nil
}

func derive(key []byte, label string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(label))
	return h.Sum(nil)
}

// Seal шифрует строку; пустая строка остаётся пустой.
func (b *Box) Seal(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := b.aead.Seal(nonce, nonce, []byte(plain), nil)
	return prefix + base64.RawStdEncoding.EncodeToString(out), nil
}

// Open расшифровывает результат Seal.
func (b *Box) Open(sealed string) (string, error) {
	if sealed == "" {
		return "", nil
	}
	raw, ok := strings.CutPrefix(sealed, prefix)
	if !ok {
		return "", errors.New("неизвестный формат секрета")
	}
	data, err := base64.RawStdEncoding.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("секрет повреждён: %w", err)
	}
	n := b.aead.NonceSize()
	if len(data) < n {
		return "", errors.New("секрет повреждён")
	}
	plain, err := b.aead.Open(nil, data[:n], data[n:], nil)
	if err != nil {
		return "", errors.New("секрет не расшифровывается: сменился SECRET_KEY?")
	}
	return string(plain), nil
}

// Sign — HMAC-подпись строки (для параметра state в OAuth).
func (b *Box) Sign(msg string) string {
	h := hmac.New(sha256.New, b.mac)
	h.Write([]byte(msg))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// Verify проверяет подпись Sign за постоянное время.
func (b *Box) Verify(msg, sig string) bool {
	return hmac.Equal([]byte(b.Sign(msg)), []byte(sig))
}

// LoadKey возвращает ключ сервера: SECRET_KEY из окружения, иначе файл
// secret.key в dataDir (создаётся при первом запуске). Пустой dataDir —
// случайный ключ на время жизни процесса (persistent=false: после перезапуска
// подключённые календари придётся подключить заново).
func LoadKey(fromEnv, dataDir string) (key []byte, persistent bool, err error) {
	if fromEnv != "" {
		return []byte(fromEnv), true, nil
	}
	if dataDir == "" {
		key = make([]byte, 32)
		_, err = rand.Read(key)
		return key, false, err
	}
	path := filepath.Join(dataDir, "secret.key")
	raw, err := os.ReadFile(path)
	if err == nil {
		key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil || len(key) == 0 {
			return nil, false, fmt.Errorf("файл ключа %s повреждён", path)
		}
		return key, true, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, false, fmt.Errorf("чтение ключа: %w", err)
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, false, err
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, false, fmt.Errorf("каталог для ключа: %w", err)
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)+"\n"), 0o600); err != nil {
		return nil, false, fmt.Errorf("запись ключа: %w", err)
	}
	return key, true, nil
}
