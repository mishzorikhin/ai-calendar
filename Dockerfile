# syntax=docker/dockerfile:1.7
#
# Один контейнер: Go-сервер с API и встроенным в бинарник веб-интерфейсом (PWA).
#   docker build -t ai-calendar .
#   docker run -p 8080:8080 -v ai-calendar-data:/data ai-calendar

# Базовые образы можно переопределить (например, зеркалом mirror.gcr.io/library/...).
ARG NODE_IMAGE=node:22-alpine
ARG GO_IMAGE=golang:1.24-alpine
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot

# ── 1. Веб-интерфейс ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# ── 2. Сервер ────────────────────────────────────────────────────
FROM ${GO_IMAGE} AS server
WORKDIR /src
COPY server/go.mod ./
RUN go mod download
COPY server ./
# Собранный UI встраивается в бинарник через go:embed (server/web/dist).
COPY --from=web /app/dist ./web/dist
ARG VERSION=dev
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/ai-calendar ./cmd/server \
    && mkdir -p /out/data

# ── 3. Минимальный образ ─────────────────────────────────────────
FROM ${RUNTIME_IMAGE}
COPY --from=server /out/ai-calendar /ai-calendar
# Каталог данных принадлежит непривилегированному пользователю distroless (uid 65532).
COPY --from=server --chown=65532:65532 /out/data /data
ENV PORT=8080 \
    DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
USER nonroot:nonroot
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/ai-calendar", "-healthcheck"]
ENTRYPOINT ["/ai-calendar"]
