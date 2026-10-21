// Сервер AI-календаря: JSON API и раздача PWA из одного бинарника.
//
// Переменные окружения:
//
//	PORT          порт HTTP (по умолчанию 8080)
//	DATABASE_URL  подключение к PostgreSQL; если задано, данные в БД
//	DATA_DIR      каталог с data.json (по умолчанию ./data; пусто — хранить в памяти;
//	              с DATABASE_URL — источник однократного импорта в базу)
//	LLM_API_KEY   ключ OpenAI-совместимого API для ассистента
//	LLM_BASE_URL  адрес API (по умолчанию https://api.neuraldeep.ru/v1)
//	LLM_MODEL     модель (по умолчанию qwen3.6-unlim-noreason)
//	STATIC_DIR    раздавать фронтенд с диска вместо встроенного (для разработки)
//	CORS_ORIGINS  источники через запятую, которым разрешён доступ к API
//	REGISTRATION  closed — новые аккаунты не создаются (первый, владелец, — можно); по умолчанию open
//	TRUST_PROXY   1 — сервер за своим прокси: адрес клиента для лимитов берём из X-Forwarded-For
//
// Внешние календари:
//
//	SECRET_KEY               ключ шифрования паролей и токенов (по умолчанию — файл DATA_DIR/secret.key)
//	PUBLIC_URL               внешний адрес сервера для входа через Google/Microsoft (https://…)
//	GOOGLE_CLIENT_ID/SECRET  OAuth-приложение Google; без них Google не предлагается
//	MICROSOFT_CLIENT_ID/SECRET OAuth-приложение Microsoft (Outlook); без них Outlook не предлагается
//	CALENDAR_SYNC_INTERVAL   период фоновой синхронизации (по умолчанию 15m; 0 — выключить)
//	CALENDAR_ALLOW_PRIVATE   1 — разрешить адреса внутренней сети (свой Nextcloud дома)
//	DEFAULT_TIMEZONE         пояс пользователей, пока браузер не сообщил свой (Europe/Moscow)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // база поясов внутри бинарника: в distroless-образе её может не быть

	"github.com/mishzorikhin/ai-calendar/server/internal/api"
	"github.com/mishzorikhin/ai-calendar/server/internal/calsync"
	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/secret"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/web"
)

// version подставляется при сборке: -ldflags "-X main.version=..."
var version = "dev"

func main() {
	healthcheck := flag.Bool("healthcheck", false, "проверить, что сервер отвечает, и выйти (для HEALTHCHECK в Docker)")
	flag.Parse()

	port := env("PORT", "8080")
	if *healthcheck {
		os.Exit(checkHealth(port))
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(port); err != nil {
		slog.Error("сервер остановлен с ошибкой", "err", err)
		os.Exit(1)
	}
}

func run(port string) error {
	st, err := openStore()
	if err != nil {
		return err
	}

	var webFS fs.FS = web.Dist()
	if dir := os.Getenv("STATIC_DIR"); dir != "" {
		webFS = os.DirFS(dir)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	calOpts, err := calendarOptions(ctx)
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: ":" + port,
		Handler: api.New(api.Options{
			Store:       st,
			LLM:         newLLM(),
			Web:         webFS,
			CORSOrigins: splitList(os.Getenv("CORS_ORIGINS")),
			Version:     version,
			Calendars:   calOpts,

			ClosedRegistration: os.Getenv("REGISTRATION") == "closed",
			TrustProxy:         os.Getenv("TRUST_PROXY") == "1",
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("сервер запущен", "addr", srv.Addr, "version", version)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	slog.Info("остановка сервера")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// newLLM собирает клиента языковой модели; без LLM_API_KEY ассистент работает без неё.
func newLLM() *llm.Client {
	key := os.Getenv("LLM_API_KEY")
	if key == "" {
		return nil
	}
	return llm.New(llm.Config{
		BaseURL: env("LLM_BASE_URL", "https://api.neuraldeep.ru/v1"),
		APIKey:  key,
		Model:   env("LLM_MODEL", "qwen3.6-unlim-noreason"),
	}, 90*time.Second)
}

// calendarOptions — настройки внешних календарей из окружения.
func calendarOptions(ctx context.Context) (api.CalendarOptions, error) {
	key, persistent, err := secret.LoadKey(os.Getenv("SECRET_KEY"), env("DATA_DIR", "./data"))
	if err != nil {
		return api.CalendarOptions{}, err
	}
	if !persistent {
		slog.Warn("SECRET_KEY не задан и DATA_DIR пуст: после перезапуска календари с паролем придётся подключить заново")
	}
	box, err := secret.New(key)
	if err != nil {
		return api.CalendarOptions{}, err
	}
	interval, err := time.ParseDuration(env("CALENDAR_SYNC_INTERVAL", "15m"))
	if err != nil {
		return api.CalendarOptions{}, fmt.Errorf("CALENDAR_SYNC_INTERVAL: %w", err)
	}
	opts := api.CalendarOptions{
		Secrets:         box,
		PublicURL:       os.Getenv("PUBLIC_URL"),
		AllowPrivate:    os.Getenv("CALENDAR_ALLOW_PRIVATE") == "1",
		DefaultTimeZone: env("DEFAULT_TIMEZONE", "Europe/Moscow"),
		SyncInterval:    interval,
		Background:      ctx,
	}
	if id, sec := os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("GOOGLE_CLIENT_SECRET"); id != "" && sec != "" {
		opts.Google = calsync.GoogleApp(id, sec)
	}
	if id, sec := os.Getenv("MICROSOFT_CLIENT_ID"), os.Getenv("MICROSOFT_CLIENT_SECRET"); id != "" && sec != "" {
		opts.Outlook = calsync.OutlookApp(id, sec)
	}
	if (opts.Google != nil || opts.Outlook != nil) && opts.PublicURL == "" {
		slog.Warn("PUBLIC_URL не задан: адрес возврата для входа через Google/Microsoft возьмём из запроса")
	}
	return opts, nil
}

// openStore выбирает хранилище: PostgreSQL по DATABASE_URL, иначе JSON-файл из DATA_DIR.
func openStore() (store.Store, error) {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		st, err := store.OpenPostgres(ctx, dsn, env("DATA_DIR", "./data"))
		if err != nil {
			return nil, err
		}
		slog.Info("хранилище: PostgreSQL")
		return st, nil
	}
	st, err := store.Open(env("DATA_DIR", "./data"))
	if err != nil {
		return nil, err
	}
	slog.Info("хранилище: JSON-файл")
	return st, nil
}

func checkHealth(port string) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%s/api/health", port))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func splitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
