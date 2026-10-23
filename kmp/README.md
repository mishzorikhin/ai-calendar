# Клиент на Kotlin Multiplatform

Те же экраны на Android, iOS и в браузере. Общий код — Compose Multiplatform в `shared/`: вход, сегодня, месяц, день, неделя, задачи и чат с ассистентом, шторки события (просмотр, правка, ответ на приглашение), задачи, поиска, аккаунта (имя, пароль, уведомления, устройства), «Календари» (Google и Outlook через браузер, CalDAV, `.ics`, своя лента), «Ассистент обо мне», «Что ассистент знает», «Люди», карточки предложений; события с повтором, напоминанием, гостями и ссылкой, задачи со сроком и участниками. Данные приходят из Go-сервера этого репозитория, веб-PWA на React остаётся как был.

Собрано на Kotlin 2.4 и Compose Multiplatform 1.11. Веб — Wasm (и запасная сборка JS). Нужен браузер с WasmGC: актуальные Chrome, Firefox или Safari.

Это не замена PWA. Здесь нет офлайн-очереди, голосового ввода, push-уведомлений (а значит, и настроек напоминаний с будильниками: доставка идёт только в веб-PWA), анкеты знакомства, картинок в чате и многодневных событий. Повтор, гости и картинки в чате тоже остаются в веб-версии.

## Что нужно

- JDK 17 или новее (проверено на 21)
- Android: Android SDK, `local.properties` с `sdk.dir`
- iOS: macOS и Xcode. Собираются устройство и симулятор Apple Silicon (`iosArm64`, `iosSimulatorArm64`). На Linux эти цели только лежат в проекте. В Compose 1.11 нет `iosX64`, симулятор на Intel Mac этой сборкой не покрыт.
- Для веба сервер должен разрешить источник страницы: `CORS_ORIGINS=http://localhost:8088`

## Запуск

Из каталога `kmp/`:

```bash
# тесты общей логики (календарная сетка и разбор потока чата)
./gradlew :shared:jvmTest

# веб, http://localhost:8088 — порт 8080 занят Go-сервером
./gradlew :webApp:wasmJsBrowserDevelopmentRun

# статика для выкладки: webApp/build/dist/wasmJs/productionExecutable
./gradlew :webApp:wasmJsBrowserDistribution

# запасной веб на JS, если Wasm в браузере недоступен
./gradlew :webApp:jsBrowserDistribution

# Android, apk в androidApp/build/outputs/apk/debug/
./gradlew :androidApp:assembleDebug
```

iOS: открыть `iosApp/iosApp.xcodeproj` на Mac и запустить схему `iosApp`. Скрипт сборки вызывает `./gradlew :shared:embedAndSignAppleFrameworkForXcode`. В `iosApp/Configuration/Config.xcconfig` можно задать `TEAM_ID`.

На экране входа укажите адрес API. Пока адрес не задан, используется адрес из `defaultApiUrl()` (`Platform.kt`); он меняется на экране входа по ссылке «Сервер».

- Эмулятор Android видит компьютер как `http://10.0.2.2:8080`
- Телефон в той же сети — `http://IP-компьютера:8080` (или порт из `APP_PORT`)
- Веб с dev-сервера ходит на Go напрямую, поэтому нужен `CORS_ORIGINS`

Приложение само сообщает серверу часовой пояс устройства. HTTP без TLS приложение принимает только для localhost и частных адресов (`10.*`, `172.16–31.*`, `192.168.*`, `*.local`), остальное — только `https://`.

Сессия (токен и адрес) хранится на устройстве: SharedPreferences, UserDefaults или `localStorage`. В лог токен не пишется.

## Анимации и значки

Пружины (`uiSpring`, `softSpring`, `bouncySpring`) переведены из `src/lib/motion.ts` (`Motion.kt`). Нажатие со сжатием — `Modifier.pressable`, каскадное появление — `Modifier.appear`, переходы экранов и шторки повторяют `screenVariants` и `BottomSheet`. Значки взяты из `src/components/Icons.tsx`. Шрифт Inter не подключён: для него нужен плагин ресурсов Compose, который в этой среде не собрать, поэтому текст набирается системным шрифтом.
