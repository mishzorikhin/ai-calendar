// Package web встраивает собранный фронтенд в бинарник сервера.
// Перед сборкой Go содержимое dist/ фронтенда копируется в server/web/dist
// (это делает Dockerfile; локально — `make web` или вручную).
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist — файлы фронтенда (корень — содержимое dist/).
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
