// Package model описывает данные API. Поля в JSON совпадают с типами фронтенда (src/domain/types.ts).
package model

import (
	"encoding/json"
	"slices"
	"time"
	"unicode/utf8"
)

// Badge — тип события, по нему фронтенд выбирает цвет и значок.
type Badge string

const (
	BadgeSleep   Badge = "sleep"
	BadgeRoutine Badge = "routine"
	BadgeWork    Badge = "work"
	BadgeFood    Badge = "food"
	BadgeSport   Badge = "sport"
	BadgeRead    Badge = "read"
)

// Valid сообщает, известен ли тип события.
func (b Badge) Valid() bool {
	switch b {
	case BadgeSleep, BadgeRoutine, BadgeWork, BadgeFood, BadgeSport, BadgeRead:
		return true
	}
	return false
}

// User — аккаунт. Username — публичный логин для входа и упоминаний (@misha),
// Name — отображаемое имя. PassHash наружу не сериализуется.
// TimeZone — IANA-пояс пользователя (Europe/Moscow): в нём внешние календари
// переводятся в дату и минуты от полуночи.
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	TimeZone  string    `json:"timeZone,omitempty"`
	PassHash  string    `json:"-"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
}

// Event — событие календаря. Start и End — минуты от полуночи.
//
// События из внешних календарей: Source — id подключения (Integration), ExternalID —
// id события там (для CalDAV — путь ресурса), ETag — версия на момент синхронизации.
// ReadOnly — менять можно только в исходном календаре (подписка, повтор серии,
// многодневное или на весь день). AllDay — на весь день: Start 0, End 1440.
type Event struct {
	ID         string `json:"id"`
	UserID     int64  `json:"userId,omitempty"`
	Date       string `json:"date"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"`
	Start      int    `json:"start"`
	End        int    `json:"end"`
	Badge      Badge  `json:"badge"`
	Highlight  bool   `json:"highlight,omitempty"`
	Source     string `json:"source,omitempty"`
	ExternalID string `json:"externalId,omitempty"`
	ETag       string `json:"etag,omitempty"`
	ReadOnly   bool   `json:"readOnly,omitempty"`
	AllDay     bool   `json:"allDay,omitempty"`
	// Travel — сколько минут добираться до места: время до начала тоже занято, напоминание —
	// «пора выезжать».
	Travel int `json:"travel,omitempty"`
	// Notes — заметки, URL — ссылка (созвон, билет). Место — Subtitle.
	Notes string `json:"notes,omitempty"`
	URL   string `json:"url,omitempty"`
	// EndDate — последний день многодневного события (пусто — однодневное). В хранилище одна
	// запись; по дням его разворачивает API (eventsBetween): у вхождений Date — свой день,
	// Start/End — отрезок этого дня, а Span — исходные день и время.
	EndDate string     `json:"endDate,omitempty"`
	Span    *EventSpan `json:"span,omitempty"`
	// Attendees — кого владелец пригласил и что они ответили (видят владелец и участники).
	Attendees []Attendee `json:"attendees,omitempty"`
	// Invite — у приглашённого: от кого приглашение и его ответ. Такое событие у него только для чтения.
	Invite *Invite `json:"invite,omitempty"`
	// Reminders — за сколько минут до начала напомнить. nil — как в настройках
	// пользователя (события внешних календарей и созданные до напоминаний), [] — не напоминать.
	Reminders []int `json:"reminders"`
	// Repeat — повтор своего события (пусто — без повтора). Date — первый день серии,
	// RepeatUntil — последний (пусто — бессрочно), ExDates — дни, убранные из серии.
	// В хранилище лежит одна запись; вхождения по дням разворачивает API (repeat.go)
	// с тем же id и датой вхождения в Date.
	Repeat      Repeat    `json:"repeat,omitempty"`
	RepeatUntil string    `json:"repeatUntil,omitempty"`
	ExDates     []string  `json:"exdates,omitempty"`
	CreatedAt   time.Time `json:"createdAt,omitempty"`
}

// RSVP — ответ на приглашение.
type RSVP string

const (
	RSVPPending  RSVP = "pending"
	RSVPAccepted RSVP = "accepted"
	RSVPDeclined RSVP = "declined"
)

func (r RSVP) Valid() bool {
	return r == RSVPPending || r == RSVPAccepted || r == RSVPDeclined
}

// Attendee — приглашённый на встречу пользователь сервера и его ответ.
type Attendee struct {
	UserID   int64  `json:"-"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Status   RSVP   `json:"status"`
}

// Invite — приглашение глазами приглашённого.
type Invite struct {
	From   User `json:"from"`
	Status RSVP `json:"status"`
}

// MaxAttendees — сколько людей можно пригласить на одну встречу.
const MaxAttendees = 20

// EventSpan — исходные начало и конец многодневного события у его вхождения в другой день.
type EventSpan struct {
	Date   string `json:"date"`
	Start  int    `json:"start"`
	End    int    `json:"end"`
	AllDay bool   `json:"allDay,omitempty"`
}

// MaxSpanDays — самое длинное многодневное событие.
const MaxSpanDays = 60

// Repeat — правило повтора события.
type Repeat string

const (
	RepeatNone     Repeat = ""
	RepeatDaily    Repeat = "daily"
	RepeatWeekdays Repeat = "weekdays"
	RepeatWeekly   Repeat = "weekly"
	RepeatMonthly  Repeat = "monthly"
	RepeatYearly   Repeat = "yearly"
)

func (r Repeat) Valid() bool {
	switch r {
	case RepeatNone, RepeatDaily, RepeatWeekdays, RepeatWeekly, RepeatMonthly, RepeatYearly:
		return true
	}
	return false
}

// MaxExDates — сколько дней можно убрать из одной серии.
const MaxExDates = 200

// EventPatch — частичное обновление события: nil-поля не трогаем.
// Subtitle: указатель на "" — очистить подзаголовок.
type EventPatch struct {
	Title    *string
	Subtitle *string
	Date     *string
	Start    *int
	End      *int
	Badge    *Badge
	// Reminders: указатель на nil — вернуть напоминание по умолчанию.
	Reminders *[]int
	// Repeat и RepeatUntil меняют правило повтора; SkipDate убирает один день из серии;
	// ExDates заменяет убранные дни целиком (при сдвиге серии они сдвигаются вместе с ней).
	Repeat      *Repeat
	RepeatUntil *string
	SkipDate    *string
	ExDates     *[]string
	// AllDay: true — на весь день (время 0–1440), false — снова со временем (Start и End — из патча).
	AllDay *bool
	// Notes, URL, Travel; EndDate: "" — снова однодневное.
	Notes   *string
	URL     *string
	Travel  *int
	EndDate *string
}

// Apply применяет патч к событию на месте.
func (e *Event) Apply(p EventPatch) {
	if p.Title != nil {
		e.Title = *p.Title
	}
	if p.Subtitle != nil {
		e.Subtitle = *p.Subtitle
	}
	if p.Date != nil {
		e.Date = *p.Date
	}
	if p.Start != nil {
		e.Start = *p.Start
	}
	if p.End != nil {
		e.End = *p.End
	}
	if p.Badge != nil {
		e.Badge = *p.Badge
	}
	if p.AllDay != nil {
		e.AllDay = *p.AllDay
		if e.AllDay {
			e.Start, e.End = 0, 24*60
		}
	}
	if p.Reminders != nil {
		e.Reminders = slices.Clone(*p.Reminders)
	}
	if p.Repeat != nil {
		e.Repeat = *p.Repeat
		if e.Repeat == RepeatNone {
			e.RepeatUntil, e.ExDates = "", nil
		}
	}
	if p.RepeatUntil != nil {
		e.RepeatUntil = *p.RepeatUntil
	}
	if p.ExDates != nil && e.Repeat != RepeatNone {
		e.ExDates = slices.Clone(*p.ExDates)
	}
	if p.SkipDate != nil && !slices.Contains(e.ExDates, *p.SkipDate) {
		e.ExDates = append(slices.Clone(e.ExDates), *p.SkipDate)
	}
	if p.Notes != nil {
		e.Notes = *p.Notes
	}
	if p.URL != nil {
		e.URL = *p.URL
	}
	if p.Travel != nil {
		e.Travel = *p.Travel
	}
	if p.EndDate != nil {
		e.EndDate = *p.EndDate
	}
}

// OnlyReminders — патч меняет только напоминания: во внешний календарь писать нечего.
func (p EventPatch) OnlyReminders() bool {
	return p.Reminders != nil && p.Title == nil && p.Subtitle == nil && p.Date == nil &&
		p.Start == nil && p.End == nil && p.Badge == nil && p.Repeat == nil && p.RepeatUntil == nil && p.SkipDate == nil && p.ExDates == nil && p.AllDay == nil &&
		p.Notes == nil && p.URL == nil && p.Travel == nil && p.EndDate == nil
}

// TaskKind — вид карточки: задача (с категорией) или цель (с дедлайном).
type TaskKind string

const (
	TaskKindTask TaskKind = "task"
	TaskKindGoal TaskKind = "goal"
)

func (k TaskKind) Valid() bool {
	return k == TaskKindTask || k == TaskKindGoal
}

// TaskCategory — свободный тег задачи (учёба, спорт, работа или любой свой).
// Константы — готовые значения с иконками в интерфейсе, а не ограничение.
type TaskCategory string

const (
	CategoryStudy TaskCategory = "study"
	CategorySport TaskCategory = "sport"
	CategoryWork  TaskCategory = "work"
)

// CategoryMaxRunes — предел длины тега.
const CategoryMaxRunes = 24

func (c TaskCategory) Valid() bool {
	return utf8.RuneCountInString(string(c)) <= CategoryMaxRunes
}

// Task — задача или цель из блока «Задачи и цели». Due — дата ГГГГ-ММ-ДД.
// Совместная задача: Owner — создатель, Members — с кем поделились
// (упоминанием @username или явным шарингом). Role — роль запросившего.
type Task struct {
	ID       string       `json:"id"`
	OwnerID  int64        `json:"ownerId,omitempty"`
	Owner    *User        `json:"owner,omitempty"`
	Members  []User       `json:"members,omitempty"`
	Role     string       `json:"role,omitempty"`
	Title    string       `json:"title"`
	Subtitle string       `json:"subtitle,omitempty"`
	Kind     TaskKind     `json:"kind"`
	Category TaskCategory `json:"category,omitempty"`
	Done     bool         `json:"done"`
	Due      string       `json:"due,omitempty"`
}

// TaskRole — роль пользователя в совместной задаче.
const (
	TaskRoleOwner  = "owner"
	TaskRoleMember = "member"
)

// TaskPatch — частичное обновление задачи: nil-поля не трогаем.
// Category: указатель на "" — очистить категорию.
type TaskPatch struct {
	Title    *string
	Subtitle *string
	Kind     *TaskKind
	Category *TaskCategory
	Done     *bool
	Due      *string
}

// Apply применяет патч к задаче на месте.
func (t *Task) Apply(p TaskPatch) {
	if p.Title != nil {
		t.Title = *p.Title
	}
	if p.Subtitle != nil {
		t.Subtitle = *p.Subtitle
	}
	if p.Kind != nil {
		t.Kind = *p.Kind
	}
	if p.Category != nil {
		t.Category = *p.Category
	}
	if p.Done != nil {
		t.Done = *p.Done
	}
	if p.Due != nil {
		t.Due = *p.Due
	}
}

type Role string

const (
	RoleUser Role = "user"
	RoleAI   Role = "ai"
)

type Message struct {
	ID        int       `json:"id"`
	UserID    int64     `json:"userId,omitempty"`
	Role      Role      `json:"role"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

// Notification — уведомление в шторке аккаунта: «@misha поделился с вами задачей».
type Notification struct {
	ID     int    `json:"id"`
	UserID int64  `json:"userId"`
	From   *User  `json:"from,omitempty"`
	TaskID string `json:"taskId,omitempty"`
	// EventID и Date — уведомление о встрече (приглашение, ответ): по нажатию открывается день.
	EventID   string    `json:"eventId,omitempty"`
	Date      string    `json:"date,omitempty"`
	Text      string    `json:"text"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
}

// IntegrationKind — вид подключённого календаря.
type IntegrationKind string

const (
	// IntegrationICS — подписка по ссылке .ics, только чтение.
	IntegrationICS IntegrationKind = "ics"
	// IntegrationCalDAV — Яндекс, iCloud, Nextcloud и другие CalDAV-серверы.
	IntegrationCalDAV IntegrationKind = "caldav"
	// IntegrationGoogle — Google Календарь через OAuth.
	IntegrationGoogle IntegrationKind = "google"
	// IntegrationOutlook — Outlook и Microsoft 365 через OAuth (Microsoft Graph).
	IntegrationOutlook IntegrationKind = "outlook"
)

func (k IntegrationKind) Valid() bool {
	switch k {
	case IntegrationICS, IntegrationCalDAV, IntegrationGoogle, IntegrationOutlook:
		return true
	}
	return false
}

// Integration — подключённый внешний календарь пользователя.
// Хранится целиком (вместе с зашифрованным Secret); наружу API отдаёт отдельное
// представление без секретов.
type Integration struct {
	ID     string          `json:"id"`
	UserID int64           `json:"userId"`
	Kind   IntegrationKind `json:"kind"`
	Name   string          `json:"name"`
	// URL — ссылка .ics или адрес CalDAV-коллекции календаря.
	URL string `json:"url,omitempty"`
	// Username — логин CalDAV или e-mail аккаунта Google/Microsoft.
	Username string `json:"username,omitempty"`
	// Secret — пароль CalDAV или OAuth-токены, зашифрованы ключом сервера.
	Secret string `json:"secret,omitempty"`
	// CalendarID — id календаря у Google/Microsoft (primary — основной).
	CalendarID string `json:"calendarId,omitempty"`
	// Badge — каким типом показывать события этого календаря.
	Badge Badge `json:"badge"`
	// Writable — календарь принимает изменения; Primary — сюда уходят новые события.
	Writable  bool      `json:"writable"`
	Primary   bool      `json:"primary"`
	LastSync  time.Time `json:"lastSync"`
	LastError string    `json:"lastError,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// MaxReminders — сколько напоминаний можно задать одному событию;
// MaxReminderMinutes — самое раннее напоминание: за неделю.
const (
	MaxReminders       = 3
	MaxReminderMinutes = 7 * 24 * 60
)

// PushSubscription — подписка браузера на Web Push (PushSubscription.toJSON()).
// Endpoint — адрес у сервиса доставки браузера, P256DH и Auth — ключи шифрования.
// Наружу не отдаётся: адрес позволяет слать уведомления на устройство.
type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	P256DH   string `json:"p256dh"`
	Auth     string `json:"auth"`
	// Label — «Chrome · Android»: подпись устройства в списке, из User-Agent при подписке.
	Label     string    `json:"label,omitempty"`
	UserID    int64     `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
}

// NotifySettings — настройки напоминаний пользователя. Время — минуты от полуночи
// в поясе пользователя; -1 — выключено.
type NotifySettings struct {
	// EventReminder — за сколько минут напоминать о событии без своих напоминаний
	// (новые события по умолчанию, внешние календари).
	EventReminder int `json:"eventReminder"`
	// TaskTime — во сколько напомнить о незакрытой задаче или цели в день срока.
	TaskTime int `json:"taskTime"`
	// Digest — во сколько присылать сводку дня: встречи и задачи на сегодня.
	Digest int `json:"digest"`
	// Evening — во сколько присылать план на завтра.
	Evening int `json:"evening"`
	// QuietFrom и QuietTo — тихие часы (могут переходить через полночь): в это время не приходит
	// ничего, кроме напоминаний, заданных явно (у события или «напомни в …»). Оба -1 — выключены.
	QuietFrom int `json:"quietFrom"`
	QuietTo   int `json:"quietTo"`
	// BadgeReminders — своё «по умолчанию» для типа события (минуты, -1 — не напоминать);
	// типа нет в списке — EventReminder.
	BadgeReminders map[Badge]int `json:"badgeReminders,omitempty"`
}

// DefaultNotifySettings — настройки, пока пользователь их не менял.
var DefaultNotifySettings = NotifySettings{EventReminder: 10, TaskTime: 9 * 60, Digest: -1, Evening: -1, QuietFrom: -1, QuietTo: -1}

// UnmarshalJSON подставляет значения по умолчанию для полей, которых нет в сохранённых
// настройках: в data.json до тихих часов и вечерней сводки их нет, а ноль там — «в 0:00».
func (ns *NotifySettings) UnmarshalJSON(b []byte) error {
	type plain NotifySettings
	p := plain(DefaultNotifySettings)
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*ns = NotifySettings(p)
	return nil
}

// DefaultReminder — напоминание по умолчанию для события такого типа (-1 — не напоминать).
func (ns NotifySettings) DefaultReminder(b Badge) int {
	if v, ok := ns.BadgeReminders[b]; ok {
		return v
	}
	return ns.EventReminder
}

// Quiet — момент (минуты от полуночи) попадает в тихие часы.
func (ns NotifySettings) Quiet(minutes int) bool {
	from, to := ns.QuietFrom, ns.QuietTo
	if from < 0 || to < 0 || from == to {
		return false
	}
	if from < to {
		return minutes >= from && minutes < to
	}
	return minutes >= from || minutes < to // через полночь: 23:00–07:00
}

// PushKind — вид уведомления: от него зависят кнопки в уведомлении.
type PushKind string

const (
	PushEvent  PushKind = "event"
	PushTask   PushKind = "task"
	PushDigest PushKind = "digest"
	PushShare  PushKind = "share"
	PushTest   PushKind = "test"
	// PushReminder — своё напоминание без события («напомни позвонить маме в 18:00»).
	PushReminder PushKind = "reminder"
)

// PushMessage — содержимое уведомления; service worker показывает его как есть.
type PushMessage struct {
	Kind  PushKind `json:"kind"`
	Title string   `json:"title"`
	Body  string   `json:"body,omitempty"`
	// URL — что открыть по нажатию (адрес приложения: «/#day/2026-10-21»).
	URL string `json:"url,omitempty"`
	// Tag — одно уведомление на событие: новое с тем же тегом заменяет старое.
	Tag string `json:"tag,omitempty"`
	// TaskID — для кнопки «Готово» у напоминания о задаче.
	TaskID string `json:"taskId,omitempty"`
	// Badge — сколько встреч и задач ещё осталось сегодня: число на иконке приложения.
	Badge *int `json:"badge,omitempty"`
}

// Snooze — отложенное уведомление («Напомнить через 10 минут»).
type Snooze struct {
	ID      int64       `json:"id"`
	UserID  int64       `json:"userId"`
	At      time.Time   `json:"at"`
	Message PushMessage `json:"message"`
}
