// Сервер AI-календаря: JSON API и раздача PWA из одного бинарника.
//
// Переменные окружения:
//
//	PORT          порт HTTP (по умолчанию 8080)
//	DATABASE_URL  подключение к PostgreSQL; если задано, данные в БД
//	DATA_DIR      каталог с data.json (по умолчанию ./data; пусто — хранить в памяти;
//	              с DATABASE_URL — источник однократного импорта в базу)
//	LLM_API_KEY   ключ OpenAI-совместимого API для разбора запросов ассистента
//	LLM_BASE_URL  адрес API (по умолчанию https://api.neuraldeep.ru/v1)
//	LLM_MODEL     модель (по умолчанию qwen3.6-unlim-noreason)
//	STATIC_DIR    раздавать фронтенд с диска вместо встроенного (для разработки)
//	CORS_ORIGINS  источники через запятую, которым разрешён доступ к API
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

	"github.com/mishzorikhin/ai-calendar/server/internal/api"
	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
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

	srv := &http.Server{
		Addr: ":" + port,
		Handler: api.New(api.Options{
			Store:       st,
			LLM:         newLLM(),
			Web:         webFS,
			CORSOrigins: splitList(os.Getenv("CORS_ORIGINS")),
			Version:     version,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
	}, 20*time.Second)
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
