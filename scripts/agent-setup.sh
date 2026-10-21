#!/usr/bin/env bash
# Подготовка окружения для кодового агента в облачной сессии (хук SessionStart Claude Code).
# Локально ничего не делает — зависимости разработчик ставит сам.
set -euo pipefail

if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

# npm-зависимости: ставим, если их нет или lock-файл новее установленных.
if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm ci --no-audit --no-fund --loglevel=error >&2
fi

# Go-модули бэкенда, включая pgx/v5 для PostgreSQL (см. server/go.mod).
if command -v go >/dev/null 2>&1; then
  (cd server && go mod download) >&2
fi

echo "Окружение готово: npm run check — проверки фронтенда, cd server && go test ./... — бэкенда."
