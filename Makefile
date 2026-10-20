.PHONY: dev web api test check docker up

# Фронтенд с горячей перезагрузкой; /api проксируется на сервер (make api).
dev:
	npm run dev

# Go-сервер на :8080 (UI раздаётся из dist/, если он собран).
api:
	cd server && STATIC_DIR=../dist go run ./cmd/server

# Собрать UI и положить его в server/web/dist для go:embed.
web:
	npm run build
	rm -rf server/web/dist/assets && cp -r dist/. server/web/dist/

test:
	npm run test
	cd server && go test ./...

check:
	npm run check
	cd server && go vet ./... && go test ./...

docker:
	docker build -t ai-calendar --build-arg VERSION=$$(git describe --always --dirty 2>/dev/null || echo dev) .

up:
	docker compose up --build
