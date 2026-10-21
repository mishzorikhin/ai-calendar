package calsync

import (
	"net/url"
	"testing"
)

func TestKeepAuthOnRedirect(t *testing.T) {
	for _, c := range []struct {
		from, to string
		want     bool
	}{
		{"https://dav.example.com/a", "https://dav.example.com/b", true},
		{"https://dav.example.com/a", "http://dav.example.com/b", false}, // пароль ушёл бы открытым текстом
		{"https://dav.example.com/a", "https://evil.example/b", false},
		{"http://nas.local:8080/a", "http://nas.local:8080/b", true},
		{"http://nas.local:8080/a", "https://nas.local:8080/b", true},
	} {
		from, _ := url.Parse(c.from)
		to, _ := url.Parse(c.to)
		if got := keepAuth(from, to); got != c.want {
			t.Errorf("%s → %s: %v, ждали %v", c.from, c.to, got, c.want)
		}
	}
}
