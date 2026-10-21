// Package calsync — связь с внешними календарями: подписки .ics, CalDAV
// (Яндекс, iCloud, Nextcloud), Google Календарь и Outlook. Разбор и запись
// iCalendar, развёртка повторов, перевод событий в дни пользователя.
//
// Только стандартная библиотека: XML для CalDAV — encoding/xml, OAuth и REST — net/http.
package calsync

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// Provider — внешний календарь: чтение вхождений в окне и запись событий.
type Provider interface {
	// Fetch — вхождения, пересекающие [from, to).
	Fetch(ctx context.Context, from, to time.Time) ([]Occurrence, error)
	// Create, Update, Delete — запись; у календарей только для чтения — ErrReadOnly.
	Create(ctx context.Context, it Item) (Ref, error)
	Update(ctx context.Context, ref Ref, it Item) (Ref, error)
	Delete(ctx context.Context, ref Ref) error
}

var (
	// ErrReadOnly — календарь не принимает изменения (подписка .ics).
	ErrReadOnly = errors.New("календарь только для чтения")
	// ErrAuth — логин, пароль или токен не подошли.
	ErrAuth = errors.New("сервис не принял логин или пароль")
	// ErrConflict — событие успели изменить в исходном календаре.
	ErrConflict = errors.New("событие изменили в исходном календаре — обновите и попробуйте снова")
	// ErrBlockedHost — адрес во внутренней сети, а такие запрещены настройками сервера.
	ErrBlockedHost = errors.New("адрес во внутренней сети недоступен")
)

// StatusError — неожиданный ответ сервиса.
type StatusError struct {
	Status int
	What   string
}

func (e *StatusError) Error() string {
	switch {
	case e.Status == http.StatusNotFound:
		return fmt.Sprintf("%s: не найдено (404) — проверьте адрес", e.What)
	case e.Status >= 500:
		return fmt.Sprintf("%s: сервис временно недоступен (%d)", e.What, e.Status)
	}
	return fmt.Sprintf("%s: ответ %d", e.What, e.Status)
}

// Net — общий HTTP-клиент для внешних календарей.
type Net struct {
	client *http.Client
}

// maxBody — предел ответа внешнего сервиса.
const maxBody = 10 << 20

// NewNet собирает клиент. allowPrivate=false запрещает адреса внутренней сети
// (loopback, 10/8, 192.168/16, link-local…): пользователь вводит адреса сам, и
// без этого сервер можно попросить сходить, например, к соседней LLM на :8080.
// Проверка — при установке соединения, поэтому обходы через DNS и редиректы не работают.
func NewNet(allowPrivate bool, timeout time.Duration) *Net {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	if !allowPrivate {
		dialer.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil || blockedIP(ip) {
				return ErrBlockedHost
			}
			return nil
		}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = dialer.DialContext
	if !allowPrivate {
		transport.Proxy = nil // через прокси проверка адреса назначения не сработала бы
	}
	return &Net{client: &http.Client{
		Transport: transport,
		Timeout:   timeout,
		// Редиректы обрабатываем сами: PROPFIND и REPORT нельзя превращать в GET.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func blockedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast() ||
		// 100.64.0.0/10 — CGNAT, тоже «внутренняя» сеть.
		(ip.To4() != nil && ip.To4()[0] == 100 && ip.To4()[1]&0xc0 == 64)
}

// Do выполняет запрос, сам проходя редиректы с тем же методом и телом (до 5 раз).
func (n *Net) Do(ctx context.Context, method, rawURL string, header http.Header, body []byte) (*http.Response, []byte, error) {
	target := rawURL
	for range 5 {
		req, err := http.NewRequestWithContext(ctx, method, target, bytesReader(body))
		if err != nil {
			return nil, nil, fmt.Errorf("неверный адрес: %w", err)
		}
		for k, v := range header {
			req.Header[k] = v
		}
		if req.Header.Get("User-Agent") == "" {
			req.Header.Set("User-Agent", "ai-calendar/1.0")
		}
		resp, err := n.client.Do(req)
		if err != nil {
			if errors.Is(err, ErrBlockedHost) {
				return nil, nil, ErrBlockedHost
			}
			return nil, nil, fmt.Errorf("нет связи с %s: %w", hostOf(target), unwrapNetErr(err))
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
		resp.Body.Close()
		if err != nil {
			return nil, nil, fmt.Errorf("чтение ответа: %w", err)
		}
		if len(data) > maxBody {
			return nil, nil, errors.New("ответ сервиса слишком большой")
		}
		switch resp.StatusCode {
		case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
			http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
			loc, err := resp.Location()
			if err != nil {
				return resp, data, nil
			}
			// Переход на другой хост не должен уносить пароль.
			if loc.Host != req.URL.Host {
				header = header.Clone()
				header.Del("Authorization")
			}
			if resp.StatusCode == http.StatusSeeOther {
				method, body = http.MethodGet, nil
			}
			target = loc.String()
			continue
		}
		return resp, data, nil
	}
	return nil, nil, errors.New("слишком много перенаправлений")
}

func unwrapNetErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		if ue.Timeout() {
			return errors.New("сервис не ответил вовремя")
		}
		return ue.Err
	}
	return err
}

func hostOf(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		return u.Host
	}
	return "сервисом"
}

func bytesReader(b []byte) io.Reader {
	if b == nil {
		return nil
	}
	return bytes.NewReader(b)
}

// NormalizeURL приводит адрес к https://…: webcal:// → https://, без схемы — https://.
func NormalizeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(raw, "webcal://"):
		raw = "https://" + strings.TrimPrefix(raw, "webcal://")
	case strings.HasPrefix(raw, "webcals://"):
		raw = "https://" + strings.TrimPrefix(raw, "webcals://")
	case !strings.Contains(raw, "://"):
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return "", errors.New("нужен адрес вида https://…")
	}
	return u.String(), nil
}
