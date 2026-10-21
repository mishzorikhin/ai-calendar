package secret

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSealOpen(t *testing.T) {
	b, err := New([]byte("ключ"))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := b.Seal("пароль приложения")
	if err != nil || !strings.HasPrefix(sealed, "v1:") || strings.Contains(sealed, "пароль") {
		t.Fatalf("шифротекст: %q %v", sealed, err)
	}
	if again, _ := b.Seal("пароль приложения"); again == sealed {
		t.Fatal("одинаковый шифротекст для одинаковых строк — нет случайного nonce")
	}
	if plain, err := b.Open(sealed); err != nil || plain != "пароль приложения" {
		t.Fatalf("расшифровка: %q %v", plain, err)
	}
	other, _ := New([]byte("другой ключ"))
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("чужой ключ не должен расшифровывать")
	}
	if s, _ := b.Seal(""); s != "" {
		t.Fatal("пустая строка остаётся пустой")
	}
}

func TestSignVerify(t *testing.T) {
	b, _ := New([]byte("k"))
	sig := b.Sign("payload")
	if !b.Verify("payload", sig) || b.Verify("payload2", sig) {
		t.Fatal("подпись")
	}
}

func TestLoadKeyPersistsInDataDir(t *testing.T) {
	dir := t.TempDir()
	k1, persistent, err := LoadKey("", dir)
	if err != nil || !persistent || len(k1) != 32 {
		t.Fatalf("первый запуск: %v %v", persistent, err)
	}
	info, err := os.Stat(filepath.Join(dir, "secret.key"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("файл ключа: %v %v", info, err)
	}
	k2, _, _ := LoadKey("", dir)
	if string(k1) != string(k2) {
		t.Fatal("ключ должен переживать перезапуск")
	}
	if k, _, _ := LoadKey("из окружения", dir); string(k) != "из окружения" {
		t.Fatal("SECRET_KEY важнее файла")
	}
	if _, persistent, _ := LoadKey("", ""); persistent {
		t.Fatal("без каталога ключ временный")
	}
}
