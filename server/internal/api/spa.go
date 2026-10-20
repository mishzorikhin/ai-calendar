package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spaHandler раздаёт собранный фронтенд. Неизвестные пути без расширения отдают index.html
// (маршрутизация на клиенте). Файлы с хешем в имени кэшируются навсегда, а index.html,
// service worker и манифест — всегда перепроверяются, чтобы обновления PWA приходили сразу.
func spaHandler(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Метод не поддерживается", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(web, name); err != nil {
			if path.Ext(name) != "" {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
		}
		if _, err := fs.Stat(web, "index.html"); err != nil {
			http.Error(w, "Веб-интерфейс не собран: выполните npm run build", http.StatusServiceUnavailable)
			return
		}

		switch {
		case strings.HasPrefix(name, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case name == "index.html" || name == "sw.js" || strings.HasPrefix(name, "workbox-") || strings.HasSuffix(name, ".webmanifest"):
			w.Header().Set("Cache-Control", "no-cache")
		default:
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		if strings.HasSuffix(name, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}

		if name == "index.html" {
			// Отдаём по исходному пути: путь, оканчивающийся на /index.html, ServeFileFS перенаправил бы.
			http.ServeFileFS(w, r, web, "index.html")
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + name
		files.ServeHTTP(w, r2)
	})
}
