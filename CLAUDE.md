# CLAUDE.md

Все правила проекта — в [AGENTS.md](AGENTS.md) (общий файл для всех кодовых агентов), правила
бэкенда — в [server/AGENTS.md](server/AGENTS.md), чек-лист ревью — в [REVIEW.md](REVIEW.md).

@AGENTS.md

## Дополнительно для Claude Code

- В облачных сессиях хук `SessionStart` (`.claude/settings.json` → `scripts/agent-setup.sh`) сам
  ставит npm-зависимости. Локально хук ничего не делает.
- Часто используемые команды разрешены без подтверждения в `.claude/settings.json`
  (`npm run check`, тесты, линтер, `go test`, `git status/diff/log`).
- Для визуальной проверки UI используйте Playwright с установленным Chromium
  (`executablePath: '/opt/pw-browsers/chromium'` в облачной среде), вьюпорт 390×844, `deviceScaleFactor: 2`.
  Скриншоты и временные файлы — в scratchpad, не в репозиторий.
- Перед сообщением «готово» прогоните Definition of Done из AGENTS.md и честно перечислите,
  что проверено, а что нет.
