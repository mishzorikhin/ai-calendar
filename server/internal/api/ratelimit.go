// Ограничение частоты запросов: перебор паролей, массовая регистрация и
// расход LLM. Ведро токенов на ключ (логин, адрес клиента, id пользователя) в памяти:
// сервер один, переживать перезапуск лимитам не нужно.
package api

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// limiterMaxKeys — после стольких ключей полные (простаивающие) вёдра выбрасываются.
const limiterMaxKeys = 10_000

type bucket struct {
	tokens float64
	at     time.Time
}

// limiter — ведро токенов: burst запросов сразу, дальше по одному раз в every.
type limiter struct {
	mu      sync.Mutex
	burst   float64
	every   time.Duration
	buckets map[string]*bucket
	now     func() time.Time
}

func newLimiter(burst int, every time.Duration) *limiter {
	return &limiter{burst: float64(burst), every: every, buckets: map[string]*bucket{}, now: time.Now}
}

// allow списывает токен для key. Если токенов нет — false и через сколько появится следующий.
func (l *limiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= limiterMaxKeys {
			l.prune(now)
		}
		b = &bucket{tokens: l.burst, at: now}
		l.buckets[key] = b
	}
	b.tokens = math.Min(l.burst, b.tokens+float64(now.Sub(b.at))/float64(l.every))
	b.at = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) * float64(l.every))
}

// prune убирает вёдра, которые успели наполниться: их владельцы давно не приходили.
func (l *limiter) prune(now time.Time) {
	for k, b := range l.buckets {
		if b.tokens+float64(now.Sub(b.at))/float64(l.every) >= l.burst {
			delete(l.buckets, k)
		}
	}
}

// limits — лимиты сервера. Значения подобраны под живого человека, а не под скрипт.
type limits struct {
	loginUser *limiter // попытки входа в один аккаунт
	loginIP   *limiter // попытки входа с одного адреса
	register  *limiter // регистрации с одного адреса
	chat      *limiter // сообщения ассистенту от одного пользователя
	// hashing ограничивает одновременные PBKDF2: каждый хэш — десятки миллисекунд CPU.
	hashing chan struct{}
}

func newLimits() *limits {
	return &limits{
		loginUser: newLimiter(10, 30*time.Second),
		loginIP:   newLimiter(30, 5*time.Second),
		register:  newLimiter(20, time.Minute),
		chat:      newLimiter(10, 6*time.Second),
		hashing:   make(chan struct{}, 4),
	}
}

// tooMany — ответ 429 с Retry-After.
func tooMany(w http.ResponseWriter, wait time.Duration) error {
	w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(wait.Seconds())))))
	return &apiError{Status: http.StatusTooManyRequests, Message: "Слишком много попыток — подождите немного"}
}

// clientIP — адрес клиента. За доверенным прокси (TRUST_PROXY=1) — последний адрес из
// X-Forwarded-For: его дописал сам прокси, а начало списка клиент может подделать.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
