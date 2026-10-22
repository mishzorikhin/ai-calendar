// Package store хранит данные: события, задачи, историю чата, аккаунты,
// сессии и уведомления. Две реализации одного интерфейса: JSON-файл
// (Open, для локального запуска) и PostgreSQL (OpenPostgres); выбор — по DATABASE_URL.
//
// Пользователь прикреплён к контексту (WithUser) HTTP-слоем после проверки
// сессии. Методы данных читают его через UserFrom: каждый видит свои события
// и сообщения, а задачи — свои и те, куда его добавили участником.
package store

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// ErrNotFound — запись не найдена (или недоступна этому пользователю).
var ErrNotFound = errors.New("not found")

// ErrUnauthorized — пользователь не опознан: нет сессии или она истекла.
var ErrUnauthorized = errors.New("unauthorized")

// ErrForbidden — операция не разрешена этому пользователю.
var ErrForbidden = errors.New("forbidden")

// ErrConflict — имя пользователя занято.
var ErrConflict = errors.New("conflict")

const (
	// SessionTTL — срок жизни сессии; скользит: когда остаётся меньше
	// sessionRefresh, продлевается до полного TTL при каждом обращении.
	SessionTTL     = 30 * 24 * time.Hour
	sessionRefresh = 15 * 24 * time.Hour
)

type ctxUserKey struct{}

// WithUser кладёт пользователя в контекст (вызывает HTTP-слой после проверки токена).
func WithUser(ctx context.Context, u model.User) context.Context {
	return context.WithValue(ctx, ctxUserKey{}, u)
}

// UserFrom достаёт пользователя из контекста; без него — ErrUnauthorized.
func UserFrom(ctx context.Context) (model.User, error) {
	u, ok := ctx.Value(ctxUserKey{}).(model.User)
	if !ok {
		return model.User{}, ErrUnauthorized
	}
	return u, nil
}

// Store — хранилище данных.
type Store interface {
	// EventsOn — события пользователя на дату (YYYY-MM-DD).
	EventsOn(ctx context.Context, date string) []model.Event
	// EventsInMonth — события пользователя за месяц (префикс YYYY-MM).
	EventsInMonth(ctx context.Context, prefix string) []model.Event
	CreateEvent(ctx context.Context, e model.Event) (model.Event, error)
	// Event — одно событие по id (только своё).
	Event(ctx context.Context, id string) (model.Event, error)
	UpdateEvent(ctx context.Context, id string, patch model.EventPatch) (model.Event, error)
	DeleteEvent(ctx context.Context, id string) error
	// Tasks — свои задачи и те, где пользователь участник, в порядке создания.
	Tasks(ctx context.Context) []model.Task
	// Task — одна задача: доступна владельцу и участникам.
	Task(ctx context.Context, id string) (model.Task, error)
	CreateTask(ctx context.Context, t model.Task) (model.Task, error)
	UpdateTask(ctx context.Context, id string, patch model.TaskPatch) (model.Task, error)
	// DeleteTask: владелец удаляет задачу у всех, участник — выходит из неё.
	DeleteTask(ctx context.Context, id string) error
	// AddTaskMember добавляет участника; владелец или участник (ErrForbidden иначе).
	AddTaskMember(ctx context.Context, taskID string, memberID int64) (model.Task, error)
	// RemoveTaskMember: владелец удаляет любого, участник — только себя.
	RemoveTaskMember(ctx context.Context, taskID string, memberID int64) (model.Task, error)
	Messages(ctx context.Context) []model.Message
	// RecentMessages — последние n реплик пользователя в хронологическом порядке (контекст для модели).
	RecentMessages(ctx context.Context, n int) []model.Message
	AddMessage(ctx context.Context, role model.Role, text string) (model.Message, error)

	// CreateUser создаёт аккаунт; ErrConflict, если имя занято. Первый
	// пользователь получает записи без владельца (данные до аккаунтов).
	CreateUser(ctx context.Context, username, name, passHash string) (model.User, error)
	// UserCount — сколько аккаунтов на сервере (закрытая регистрация пускает только первого).
	UserCount(ctx context.Context) (int, error)
	// UserByUsername — пользователь с PassHash (для входа).
	UserByUsername(ctx context.Context, username string) (model.User, error)
	// SearchUsers — поиск по имени и логину для упоминаний; без PassHash и без самого себя.
	SearchUsers(ctx context.Context, query string, limit int) []model.User
	// UpdateUser меняет отображаемое имя текущего пользователя.
	UpdateUser(ctx context.Context, name string) (model.User, error)
	// CreateSession сохраняет токен (передаётся уже хэшированным).
	CreateSession(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error
	// UserBySession — пользователь по хэшу токена; продлевает сессию, если та скоро истечёт.
	UserBySession(ctx context.Context, tokenHash string) (model.User, error)
	DeleteSession(ctx context.Context, tokenHash string) error

	// Notifications — уведомления пользователя, новые первыми (до 100).
	Notifications(ctx context.Context) []model.Notification
	// AddNotification кладёт уведомление адресату (n.UserID — кому).
	AddNotification(ctx context.Context, n model.Notification) error
	// MarkNotificationsRead отмечает все уведомления пользователя прочитанными.
	MarkNotificationsRead(ctx context.Context) error

	// EventsBetween — события пользователя с from по to включительно (ГГГГ-ММ-ДД).
	// Повторяющиеся лежат одной записью на дату начала серии: вхождения разворачивает API.
	EventsBetween(ctx context.Context, from, to string) []model.Event
	// RepeatingEvents — повторяющиеся события пользователя, чья серия пересекает [from, to]:
	// начинается не позже to и не закончилась до from.
	RepeatingEvents(ctx context.Context, from, to string) []model.Event
	// SyncEvents приводит события источника source к списку events: совпавшие по
	// ExternalID обновляются (id сохраняется), новые добавляются, остальные удаляются.
	SyncEvents(ctx context.Context, source string, events []model.Event) (SyncStats, error)
	// SetEventETag запоминает версию события во внешнем календаре после записи туда.
	SetEventETag(ctx context.Context, id, etag string) error

	// Integrations — подключённые календари пользователя в порядке подключения.
	Integrations(ctx context.Context) []model.Integration
	Integration(ctx context.Context, id string) (model.Integration, error)
	// SaveIntegration создаёт (пустой ID) или заменяет подключение. Primary=true
	// снимает отметку «сюда новые события» с остальных календарей пользователя.
	SaveIntegration(ctx context.Context, in model.Integration) (model.Integration, error)
	// DeleteIntegration удаляет подключение вместе с его событиями.
	DeleteIntegration(ctx context.Context, id string) error
	// AllIntegrations — подключения всех пользователей (для фоновой синхронизации).
	AllIntegrations(ctx context.Context) []model.Integration

	// SetTimeZone запоминает часовой пояс текущего пользователя.
	SetTimeZone(ctx context.Context, tz string) (model.User, error)
	// FeedToken — секрет ссылки на ленту .ics пользователя ("" — лента выключена).
	FeedToken(ctx context.Context) (string, error)
	SetFeedToken(ctx context.Context, token string) error
	// UserByFeedToken — владелец ленты по секрету из ссылки.
	UserByFeedToken(ctx context.Context, token string) (model.User, error)
	// UserByID — пользователь без пароля (фоновая синхронизация, вход через OAuth).
	UserByID(ctx context.Context, id int64) (model.User, error)

	// SavePushSubscription запоминает подписку браузера за текущим пользователем. Адрес
	// уникален: устройство, вошедшее под другим аккаунтом, переходит к нему. У пользователя
	// не больше MaxPushSubscriptions подписок — самые старые забываются.
	SavePushSubscription(ctx context.Context, sub model.PushSubscription) error
	// DeletePushSubscription забывает подписку текущего пользователя; если её нет — не ошибка.
	DeletePushSubscription(ctx context.Context, endpoint string) error
	// PushSubscriptions — подписки текущего пользователя.
	PushSubscriptions(ctx context.Context) []model.PushSubscription
	// PushUserIDs — пользователи, у которых есть подписки (для планировщика напоминаний).
	PushUserIDs(ctx context.Context) []int64
	// NotifySettings — настройки напоминаний текущего пользователя (по умолчанию — DefaultNotifySettings).
	NotifySettings(ctx context.Context) (model.NotifySettings, error)
	SetNotifySettings(ctx context.Context, ns model.NotifySettings) error
	// ClaimReminder отмечает напоминание key текущего пользователя отправленным в момент now.
	// false — его уже отправляли. Отметки старше ReminderMemory забываются.
	ClaimReminder(ctx context.Context, key string, now time.Time) (bool, error)
	// AddSnooze откладывает уведомление текущего пользователя до at (и свои напоминания
	// «напомни в 18:00»); ErrLimit — отложенных уже MaxSnoozes.
	AddSnooze(ctx context.Context, at time.Time, msg model.PushMessage) (model.Snooze, error)
	// Snoozes — отложенные уведомления текущего пользователя, ближайшие первыми.
	Snoozes(ctx context.Context) []model.Snooze
	// DeleteSnooze отменяет отложенное уведомление текущего пользователя; ErrNotFound — нет такого.
	DeleteSnooze(ctx context.Context, id int64) error
	// TakeDueSnoozes забирает отложенные уведомления всех пользователей со сроком не позже now.
	TakeDueSnoozes(ctx context.Context, now time.Time) []model.Snooze
	// ServerKey — значение name из хранилища; если его ещё нет — сохраняет gen() и
	// возвращает его (при гонке двух процессов оба получат одно значение).
	ServerKey(ctx context.Context, name string, gen func() (string, error)) (string, error)

	// Profile — профиль текущего пользователя (по умолчанию — DefaultProfile).
	Profile(ctx context.Context) (model.Profile, error)
	SetProfile(ctx context.Context, p model.Profile) error
	// Memories — факты памяти текущего пользователя, новые первыми (с отклонёнными догадками).
	Memories(ctx context.Context) []model.Memory
	// AddMemory сохраняет факт текущего пользователя; ErrLimit — фактов уже MaxMemories.
	AddMemory(ctx context.Context, m model.Memory) (model.Memory, error)
	UpdateMemory(ctx context.Context, id int64, patch model.MemoryPatch) (model.Memory, error)
	DeleteMemory(ctx context.Context, id int64) error
	// DeleteMemories забывает все факты текущего пользователя.
	DeleteMemories(ctx context.Context) error
	// TouchMemories отмечает, что факты попали в запрос к модели (UsedAt).
	TouchMemories(ctx context.Context, ids []int64, at time.Time) error
	// People — карточки людей текущего пользователя по имени.
	People(ctx context.Context) []model.Person
	// SavePerson создаёт (ID 0) или заменяет карточку; ErrLimit — людей уже MaxPeople.
	SavePerson(ctx context.Context, p model.Person) (model.Person, error)
	DeletePerson(ctx context.Context, id int64) error
}

// ErrLimit — превышен предел записей.
var ErrLimit = errors.New("limit")

const (
	// MaxPushSubscriptions — устройств с уведомлениями на пользователя.
	MaxPushSubscriptions = 10
	// MaxSnoozes — отложенных уведомлений на пользователя.
	MaxSnoozes = 50
	// ReminderMemory — сколько помнить отправленные напоминания (дольше, чем самое раннее напоминание).
	ReminderMemory = 8 * 24 * time.Hour
)

// SyncStats — итог синхронизации источника.
type SyncStats struct {
	Added, Updated, Removed int
}

// storedUser — пользователь в файле: PassHash хранится, но не отдаётся в API.
type storedUser struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	PassHash  string    `json:"passHash"`
	TimeZone  string    `json:"timeZone,omitempty"`
	FeedToken string    `json:"feedToken,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

func (u storedUser) public() model.User {
	return model.User{ID: u.ID, Username: u.Username, Name: u.Name, TimeZone: u.TimeZone, CreatedAt: u.CreatedAt}
}

type storedSession struct {
	UserID    int64     `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type data struct {
	Events        []model.Event            `json:"events"`
	Messages      []model.Message          `json:"messages"`
	Tasks         []model.Task             `json:"tasks"`
	Users         []storedUser             `json:"users"`
	Sessions      map[string]storedSession `json:"sessions"`
	Notifications []model.Notification     `json:"notifications"`
	Integrations  []model.Integration      `json:"integrations"`
	// Web Push: подписки устройств, настройки напоминаний (по id пользователя),
	// отметки отправленных напоминаний («id|ключ» → когда) и отложенные уведомления.
	PushSubscriptions []model.PushSubscription       `json:"pushSubscriptions,omitempty"`
	NotifySettings    map[int64]model.NotifySettings `json:"notifySettings,omitempty"`
	SentReminders     map[string]time.Time           `json:"sentReminders,omitempty"`
	Snoozes           []model.Snooze                 `json:"snoozes,omitempty"`
	NextSnoozeID      int64                          `json:"nextSnoozeId,omitempty"`
	// ServerKeys — ключи сервера, созданные им самим (закрытый ключ VAPID).
	ServerKeys map[string]string `json:"serverKeys,omitempty"`
	// Персонализация: профили (по id пользователя), память ассистента и карточки людей.
	Profiles     map[int64]model.Profile `json:"profiles,omitempty"`
	Memories     []model.Memory          `json:"memories,omitempty"`
	NextMemoryID int64                   `json:"nextMemoryId,omitempty"`
	People       []model.Person          `json:"people,omitempty"`
	NextPersonID int64                   `json:"nextPersonId,omitempty"`

	NextID        int   `json:"nextId"`
	NextUserID    int64 `json:"nextUserId"`
	NextMessageID int   `json:"nextMessageId"`
}

// fileStore — JSON-файл с атомарной записью (временный файл и rename).
type fileStore struct {
	mu   sync.RWMutex
	path string
	d    data
	// lastGood — последнее успешно записанное состояние: к нему откатываемся, если запись не удалась.
	lastGood []byte
	now      func() time.Time
}

// Open читает файл данных из dir (создаёт при первом запуске). Пустой dir — хранение в памяти.
func Open(dir string) (Store, error) {
	s := &fileStore{now: time.Now}
	s.d.NextID = 1
	s.d.NextUserID = 1
	s.d.Sessions = map[string]storedSession{}
	if dir == "" {
		s.d.Tasks = []model.Task{}
		return s, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("создание каталога данных: %w", err)
	}
	s.path = filepath.Join(dir, "data.json")
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, fmt.Errorf("чтение данных: %w", err)
	default:
		if err := json.Unmarshal(raw, &s.d); err != nil {
			return nil, fmt.Errorf("разбор %s: %w", s.path, err)
		}
	}
	s.normalize()
	return s, s.save()
}

// normalize инициализирует поля, которых нет у файлов, созданных до появления новых сущностей.
func (s *fileStore) normalize() {
	if s.d.Tasks == nil {
		s.d.Tasks = []model.Task{}
	}
	if s.d.Sessions == nil {
		s.d.Sessions = map[string]storedSession{}
	}
	if s.d.NextID == 0 {
		s.d.NextID = 1
	}
	if s.d.NextUserID == 0 {
		s.d.NextUserID = 1
	}
	// Файлы до появления счётчика: продолжаем нумерацию после самого старшего id.
	for _, m := range s.d.Messages {
		s.d.NextMessageID = max(s.d.NextMessageID, m.ID+1)
	}
}

// nextMessageID — id новой реплики (общий счётчик для всех пользователей).
func (s *fileStore) nextMessageID() int {
	id := s.d.NextMessageID
	s.d.NextMessageID++
	return id
}

// save вызывается под блокировкой на запись. Если файл записать не удалось, состояние в памяти
// откатывается к последнему сохранённому, чтобы оно не расходилось с диском.
func (s *fileStore) save() error {
	if s.path == "" {
		return nil
	}
	raw, err := json.MarshalIndent(s.d, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	err = os.WriteFile(tmp, raw, 0o600)
	if err == nil {
		err = os.Rename(tmp, s.path)
	} else {
		err = fmt.Errorf("запись данных: %w", err)
	}
	if err != nil {
		s.rollback()
		return err
	}
	s.lastGood = raw
	return nil
}

func (s *fileStore) rollback() {
	if s.lastGood == nil {
		return
	}
	var prev data
	if json.Unmarshal(s.lastGood, &prev) == nil {
		s.d = prev
		s.normalize()
	}
}

func (s *fileStore) nextID(prefix string) string {
	id := fmt.Sprintf("%s-%d", prefix, s.d.NextID)
	s.d.NextID++
	return id
}

// uid — id пользователя из контекста.
func (s *fileStore) uid(ctx context.Context) (int64, error) {
	u, err := UserFrom(ctx)
	return u.ID, err
}

// userCard — карточка другого пользователя для задач: без пароля и личных настроек.
func (s *fileStore) userCard(id int64) (model.User, bool) {
	u, ok := s.userByID(id)
	u.TimeZone = ""
	return u, ok
}

// userByID — пользователь (без пароля) по id.
func (s *fileStore) userByID(id int64) (model.User, bool) {
	for _, u := range s.d.Users {
		if u.ID == id {
			return u.public(), true
		}
	}
	return model.User{}, false
}

// taskVisible — задача доступна владельцу и участникам.
func taskVisible(t *model.Task, uid int64) bool {
	if t.OwnerID == uid {
		return true
	}
	return slices.ContainsFunc(t.Members, func(m model.User) bool { return m.ID == uid })
}

// decorateTask заполняет Owner, свежие карточки Members и роль запросившего.
// Вызывается под блокировкой; меняет переданную копию задачи.
func (s *fileStore) decorateTask(t *model.Task, uid int64) {
	if owner, ok := s.userCard(t.OwnerID); ok {
		owner := owner
		t.Owner = &owner
	}
	members := t.Members[:0]
	for _, m := range t.Members {
		if u, ok := s.userCard(m.ID); ok {
			members = append(members, u)
		}
	}
	t.Members = members
	if len(t.Members) == 0 {
		t.Members = nil
	}
	t.Role = model.TaskRoleMember
	if t.OwnerID == uid {
		t.Role = model.TaskRoleOwner
	}
}

func (s *fileStore) EventsOn(ctx context.Context, date string) []model.Event {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		if e.Date == date && e.UserID == uid {
			out = append(out, e)
		}
	}
	return out
}

func (s *fileStore) EventsInMonth(ctx context.Context, prefix string) []model.Event {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		if e.UserID == uid && len(e.Date) >= len(prefix) && e.Date[:len(prefix)] == prefix {
			out = append(out, e)
		}
	}
	return out
}

func (s *fileStore) CreateEvent(ctx context.Context, e model.Event) (model.Event, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Event{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e.ID = s.nextID("evt")
	e.UserID = uid
	e.CreatedAt = s.now()
	s.d.Events = append(s.d.Events, e)
	return e, s.save()
}

func (s *fileStore) Event(ctx context.Context, id string) (model.Event, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Event{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	i := slices.IndexFunc(s.d.Events, func(e model.Event) bool { return e.ID == id && e.UserID == uid })
	if i < 0 {
		return model.Event{}, ErrNotFound
	}
	return s.d.Events[i], nil
}

func (s *fileStore) UpdateEvent(ctx context.Context, id string, patch model.EventPatch) (model.Event, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Event{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Events, func(e model.Event) bool { return e.ID == id && e.UserID == uid })
	if i < 0 {
		return model.Event{}, ErrNotFound
	}
	s.d.Events[i].Apply(patch)
	return s.d.Events[i], s.save()
}

func (s *fileStore) DeleteEvent(ctx context.Context, id string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Events, func(e model.Event) bool { return e.ID == id && e.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	s.d.Events = slices.Delete(s.d.Events, i, i+1)
	return s.save()
}

func (s *fileStore) Tasks(ctx context.Context) []model.Task {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Task
	for _, t := range s.d.Tasks {
		if !taskVisible(&t, uid) {
			continue
		}
		t := t
		t.Members = slices.Clone(t.Members)
		s.decorateTask(&t, uid)
		out = append(out, t)
	}
	return out
}

func (s *fileStore) Task(ctx context.Context, id string) (model.Task, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Task{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	i := slices.IndexFunc(s.d.Tasks, func(t model.Task) bool { return t.ID == id })
	if i < 0 || !taskVisible(&s.d.Tasks[i], uid) {
		return model.Task{}, ErrNotFound
	}
	t := s.d.Tasks[i]
	t.Members = slices.Clone(t.Members)
	s.decorateTask(&t, uid)
	return t, nil
}

func (s *fileStore) CreateTask(ctx context.Context, t model.Task) (model.Task, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Task{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t.ID = s.nextID("task")
	t.OwnerID = uid
	s.d.Tasks = append(s.d.Tasks, t)
	out := t
	out.Members = slices.Clone(t.Members)
	s.decorateTask(&out, uid)
	return out, s.save()
}

func (s *fileStore) UpdateTask(ctx context.Context, id string, patch model.TaskPatch) (model.Task, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Task{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Tasks, func(t model.Task) bool { return t.ID == id })
	if i < 0 || !taskVisible(&s.d.Tasks[i], uid) {
		return model.Task{}, ErrNotFound
	}
	s.d.Tasks[i].Apply(patch)
	t := s.d.Tasks[i]
	t.Members = slices.Clone(t.Members)
	s.decorateTask(&t, uid)
	return t, s.save()
}

func (s *fileStore) DeleteTask(ctx context.Context, id string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Tasks, func(t model.Task) bool { return t.ID == id })
	if i < 0 {
		return ErrNotFound
	}
	t := &s.d.Tasks[i]
	if t.OwnerID == uid {
		s.d.Tasks = slices.Delete(s.d.Tasks, i, i+1)
		return s.save()
	}
	// Участник «удаляет» задачу у себя — выходит из неё.
	j := slices.IndexFunc(t.Members, func(m model.User) bool { return m.ID == uid })
	if j < 0 {
		return ErrNotFound
	}
	t.Members = slices.Delete(t.Members, j, j+1)
	return s.save()
}

func (s *fileStore) AddTaskMember(ctx context.Context, taskID string, memberID int64) (model.Task, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Task{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Tasks, func(t model.Task) bool { return t.ID == taskID })
	if i < 0 || !taskVisible(&s.d.Tasks[i], uid) {
		return model.Task{}, ErrNotFound
	}
	t := &s.d.Tasks[i]
	if t.OwnerID == memberID {
		return model.Task{}, badMember("нельзя добавить владельца")
	}
	if slices.ContainsFunc(t.Members, func(m model.User) bool { return m.ID == memberID }) {
		out := *t
		out.Members = slices.Clone(t.Members)
		s.decorateTask(&out, uid)
		return out, nil // уже участник — не дублируем
	}
	member, ok := s.userCard(memberID)
	if !ok {
		return model.Task{}, ErrNotFound
	}
	t.Members = append(t.Members, member)
	out := *t
	out.Members = slices.Clone(t.Members)
	s.decorateTask(&out, uid)
	return out, s.save()
}

func (s *fileStore) RemoveTaskMember(ctx context.Context, taskID string, memberID int64) (model.Task, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Task{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Tasks, func(t model.Task) bool { return t.ID == taskID })
	if i < 0 || !taskVisible(&s.d.Tasks[i], uid) {
		return model.Task{}, ErrNotFound
	}
	t := &s.d.Tasks[i]
	// Владелец удаляет любого участника, участник — только себя.
	if t.OwnerID != uid && memberID != uid {
		return model.Task{}, ErrForbidden
	}
	if t.OwnerID == memberID {
		return model.Task{}, badMember("владелец не может выйти из своей задачи")
	}
	j := slices.IndexFunc(t.Members, func(m model.User) bool { return m.ID == memberID })
	if j < 0 {
		return model.Task{}, ErrNotFound
	}
	t.Members = slices.Delete(t.Members, j, j+1)
	out := *t
	out.Members = slices.Clone(t.Members)
	s.decorateTask(&out, uid)
	return out, s.save()
}

func (s *fileStore) Messages(ctx context.Context) []model.Message {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Message
	for _, m := range s.d.Messages {
		if m.UserID == uid {
			out = append(out, m)
		}
	}
	return out
}

func (s *fileStore) RecentMessages(ctx context.Context, n int) []model.Message {
	uid, err := s.uid(ctx)
	if err != nil || n <= 0 {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Идём с конца: старая история не перебирается целиком ради последних n.
	var out []model.Message
	for i := len(s.d.Messages) - 1; i >= 0 && len(out) < n; i-- {
		if m := s.d.Messages[i]; m.UserID == uid {
			out = append(out, m)
		}
	}
	slices.Reverse(out)
	return out
}

func (s *fileStore) AddMessage(ctx context.Context, role model.Role, text string) (model.Message, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Message{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m := model.Message{ID: s.nextMessageID(), UserID: uid, Role: role, Text: text, CreatedAt: s.now()}
	s.d.Messages = append(s.d.Messages, m)
	return m, s.save()
}

func (s *fileStore) CreateUser(ctx context.Context, username, name, passHash string) (model.User, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	lower := strings.ToLower(username)
	for _, u := range s.d.Users {
		if u.Username == lower {
			return model.User{}, ErrConflict
		}
	}
	su := storedUser{ID: s.d.NextUserID, Username: lower, Name: name, PassHash: passHash, CreatedAt: s.now()}
	s.d.NextUserID++
	s.d.Users = append(s.d.Users, su)
	// Первый пользователь забирает данные без владельца (записанные до аккаунтов).
	if len(s.d.Users) == 1 {
		for i := range s.d.Events {
			if s.d.Events[i].UserID == 0 {
				s.d.Events[i].UserID = su.ID
			}
		}
		for i := range s.d.Tasks {
			if s.d.Tasks[i].OwnerID == 0 {
				s.d.Tasks[i].OwnerID = su.ID
			}
		}
		for i := range s.d.Messages {
			if s.d.Messages[i].UserID == 0 {
				s.d.Messages[i].UserID = su.ID
			}
		}
	}
	// Приветствие ассистента — первое сообщение в истории нового пользователя.
	hasGreeting := slices.ContainsFunc(s.d.Messages, func(m model.Message) bool { return m.UserID == su.ID })
	if !hasGreeting {
		s.d.Messages = append(s.d.Messages, model.Message{ID: s.nextMessageID(), UserID: su.ID, Role: model.RoleAI, Text: "Чем могу помочь?", CreatedAt: s.now()})
	}
	return su.public(), s.save()
}

func (s *fileStore) UserCount(context.Context) (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.d.Users), nil
}

func (s *fileStore) UserByUsername(_ context.Context, username string) (model.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lower := strings.ToLower(username)
	for _, u := range s.d.Users {
		if u.Username == lower {
			out := u.public()
			out.PassHash = u.PassHash
			return out, nil
		}
	}
	return model.User{}, ErrNotFound
}

func (s *fileStore) SearchUsers(ctx context.Context, query string, limit int) []model.User {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	q := strings.ToLower(strings.TrimSpace(query))
	var out []model.User
	for _, u := range s.d.Users {
		if u.ID == uid {
			continue
		}
		if q != "" && !strings.Contains(u.Username, q) && !strings.Contains(strings.ToLower(u.Name), q) {
			continue
		}
		out = append(out, model.User{ID: u.ID, Username: u.Username, Name: u.Name})
	}
	slices.SortFunc(out, func(a, b model.User) int { return strings.Compare(a.Username, b.Username) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (s *fileStore) UpdateUser(ctx context.Context, name string) (model.User, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.User{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == uid {
			s.d.Users[i].Name = name
			return s.d.Users[i].public(), s.save()
		}
	}
	return model.User{}, ErrNotFound
}

func (s *fileStore) CreateSession(_ context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Заодно убираем истёкшие сессии: сами они пропадают, только если токен снова предъявят.
	now := s.now()
	for h, sess := range s.d.Sessions {
		if now.After(sess.ExpiresAt) {
			delete(s.d.Sessions, h)
		}
	}
	s.d.Sessions[tokenHash] = storedSession{UserID: userID, ExpiresAt: expiresAt}
	return s.save()
}

func (s *fileStore) UserBySession(_ context.Context, tokenHash string) (model.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.d.Sessions[tokenHash]
	if !ok {
		return model.User{}, ErrUnauthorized
	}
	now := s.now()
	if now.After(sess.ExpiresAt) {
		delete(s.d.Sessions, tokenHash)
		_ = s.save()
		return model.User{}, ErrUnauthorized
	}
	// Скользящее продление: до конца меньше половины TTL — продлеваем заново.
	if sess.ExpiresAt.Sub(now) < sessionRefresh {
		sess.ExpiresAt = now.Add(SessionTTL)
		s.d.Sessions[tokenHash] = sess
		_ = s.save()
	}
	u, ok := s.userByID(sess.UserID)
	if !ok {
		return model.User{}, ErrUnauthorized
	}
	return u, nil
}

func (s *fileStore) DeleteSession(_ context.Context, tokenHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.d.Sessions, tokenHash)
	return s.save()
}

func (s *fileStore) Notifications(ctx context.Context) []model.Notification {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Notification
	for _, n := range s.d.Notifications {
		if n.UserID == uid {
			out = append(out, n)
		}
	}
	slices.SortFunc(out, func(a, b model.Notification) int { return b.ID - a.ID })
	if len(out) > 100 {
		out = out[:100]
	}
	return out
}

func (s *fileStore) AddNotification(_ context.Context, n model.Notification) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := 0
	for _, m := range s.d.Notifications {
		id = max(id, m.ID+1)
	}
	n.ID = id
	n.CreatedAt = s.now()
	s.d.Notifications = append(s.d.Notifications, n)
	return s.save()
}

func (s *fileStore) MarkNotificationsRead(ctx context.Context) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Notifications {
		if s.d.Notifications[i].UserID == uid {
			s.d.Notifications[i].Read = true
		}
	}
	return s.save()
}

// MemberError — нарушение правила участников задачи; HTTP-слой отдаёт его как 400.
type MemberError struct{ Msg string }

func (e *MemberError) Error() string { return e.Msg }
func badMember(msg string) error     { return &MemberError{Msg: msg} }

func (s *fileStore) EventsBetween(ctx context.Context, from, to string) []model.Event {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		if e.UserID == uid && e.Date >= from && e.Date <= to {
			out = append(out, e)
		}
	}
	return out
}

func (s *fileStore) SyncEvents(ctx context.Context, source string, events []model.Event) (SyncStats, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return SyncStats{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	incoming := make(map[string]model.Event, len(events))
	for _, e := range events {
		if _, dup := incoming[e.ExternalID]; !dup && e.ExternalID != "" {
			incoming[e.ExternalID] = e
		}
	}
	var stats SyncStats
	kept := s.d.Events[:0]
	seen := map[string]bool{}
	for _, e := range s.d.Events {
		if e.UserID != uid || e.Source != source {
			kept = append(kept, e)
			continue
		}
		in, ok := incoming[e.ExternalID]
		if !ok || seen[e.ExternalID] {
			stats.Removed++
			continue
		}
		seen[e.ExternalID] = true
		if mergeSynced(&e, in) {
			stats.Updated++
		}
		kept = append(kept, e)
	}
	s.d.Events = kept
	for _, e := range events {
		if e.ExternalID == "" || seen[e.ExternalID] {
			continue
		}
		seen[e.ExternalID] = true
		e.ID = s.nextID("evt")
		e.UserID = uid
		e.Source = source
		e.Highlight = false
		e.CreatedAt = s.now()
		s.d.Events = append(s.d.Events, e)
		stats.Added++
	}
	return stats, s.save()
}

// mergeSynced переносит в событие поля из внешнего календаря; true — что-то изменилось.
func mergeSynced(e *model.Event, in model.Event) bool {
	changed := e.Date != in.Date || e.Title != in.Title || e.Subtitle != in.Subtitle ||
		e.Start != in.Start || e.End != in.End || e.Badge != in.Badge ||
		e.ETag != in.ETag || e.ReadOnly != in.ReadOnly || e.AllDay != in.AllDay
	e.Date, e.Title, e.Subtitle = in.Date, in.Title, in.Subtitle
	e.Start, e.End, e.Badge = in.Start, in.End, in.Badge
	e.ETag, e.ReadOnly, e.AllDay = in.ETag, in.ReadOnly, in.AllDay
	// Напоминания — настройка пользователя в приложении, синхронизация их не трогает.
	return changed
}

func (s *fileStore) SetEventETag(ctx context.Context, id, etag string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Events, func(e model.Event) bool { return e.ID == id && e.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	s.d.Events[i].ETag = etag
	return s.save()
}

func (s *fileStore) Integrations(ctx context.Context) []model.Integration {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Integration
	for _, in := range s.d.Integrations {
		if in.UserID == uid {
			out = append(out, in)
		}
	}
	return out
}

func (s *fileStore) Integration(ctx context.Context, id string) (model.Integration, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Integration{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, in := range s.d.Integrations {
		if in.ID == id && in.UserID == uid {
			return in, nil
		}
	}
	return model.Integration{}, ErrNotFound
}

func (s *fileStore) SaveIntegration(ctx context.Context, in model.Integration) (model.Integration, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Integration{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	in.UserID = uid
	if in.ID == "" {
		in.ID = s.nextID("cal")
		in.CreatedAt = s.now()
		s.d.Integrations = append(s.d.Integrations, in)
	} else {
		i := slices.IndexFunc(s.d.Integrations, func(x model.Integration) bool { return x.ID == in.ID && x.UserID == uid })
		if i < 0 {
			return model.Integration{}, ErrNotFound
		}
		in.CreatedAt = s.d.Integrations[i].CreatedAt
		s.d.Integrations[i] = in
	}
	if in.Primary {
		for i := range s.d.Integrations {
			if x := &s.d.Integrations[i]; x.UserID == uid && x.ID != in.ID {
				x.Primary = false
			}
		}
	}
	return in, s.save()
}

func (s *fileStore) DeleteIntegration(ctx context.Context, id string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Integrations, func(x model.Integration) bool { return x.ID == id && x.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	s.d.Integrations = slices.Delete(s.d.Integrations, i, i+1)
	s.d.Events = slices.DeleteFunc(s.d.Events, func(e model.Event) bool { return e.UserID == uid && e.Source == id })
	return s.save()
}

func (s *fileStore) AllIntegrations(context.Context) []model.Integration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Clone(s.d.Integrations)
}

func (s *fileStore) SetTimeZone(ctx context.Context, tz string) (model.User, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.User{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == uid {
			s.d.Users[i].TimeZone = tz
			return s.d.Users[i].public(), s.save()
		}
	}
	return model.User{}, ErrNotFound
}

func (s *fileStore) FeedToken(ctx context.Context) (string, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return "", err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		if u.ID == uid {
			return u.FeedToken, nil
		}
	}
	return "", ErrNotFound
}

func (s *fileStore) SetFeedToken(ctx context.Context, token string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == uid {
			s.d.Users[i].FeedToken = token
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *fileStore) UserByFeedToken(_ context.Context, token string) (model.User, error) {
	if token == "" {
		return model.User{}, ErrNotFound
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		if u.FeedToken != "" && subtle.ConstantTimeCompare([]byte(u.FeedToken), []byte(token)) == 1 {
			return u.public(), nil
		}
	}
	return model.User{}, ErrNotFound
}

func (s *fileStore) UserByID(_ context.Context, id int64) (model.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if u, ok := s.userByID(id); ok {
		return u, nil
	}
	return model.User{}, ErrNotFound
}

// --- Web Push ------------------------------------------------------------------

func (s *fileStore) SavePushSubscription(ctx context.Context, sub model.PushSubscription) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sub.UserID = uid
	sub.CreatedAt = s.now()
	subs := slices.DeleteFunc(s.d.PushSubscriptions, func(p model.PushSubscription) bool { return p.Endpoint == sub.Endpoint })
	subs = append(subs, sub)
	// Лишние подписки пользователя — самые старые, они в начале списка.
	mine := 0
	for _, p := range subs {
		if p.UserID == uid {
			mine++
		}
	}
	subs = slices.DeleteFunc(subs, func(p model.PushSubscription) bool {
		if p.UserID == uid && mine > MaxPushSubscriptions {
			mine--
			return true
		}
		return false
	})
	s.d.PushSubscriptions = subs
	return s.save()
}

func (s *fileStore) DeletePushSubscription(ctx context.Context, endpoint string) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	before := len(s.d.PushSubscriptions)
	s.d.PushSubscriptions = slices.DeleteFunc(s.d.PushSubscriptions, func(p model.PushSubscription) bool {
		return p.UserID == uid && p.Endpoint == endpoint
	})
	if len(s.d.PushSubscriptions) == before {
		return nil
	}
	return s.save()
}

func (s *fileStore) PushSubscriptions(ctx context.Context) []model.PushSubscription {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.PushSubscription
	for _, p := range s.d.PushSubscriptions {
		if p.UserID == uid {
			out = append(out, p)
		}
	}
	return out
}

func (s *fileStore) PushUserIDs(context.Context) []int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []int64
	for _, p := range s.d.PushSubscriptions {
		if !slices.Contains(out, p.UserID) {
			out = append(out, p.UserID)
		}
	}
	return out
}

func (s *fileStore) NotifySettings(ctx context.Context) (model.NotifySettings, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.NotifySettings{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if ns, ok := s.d.NotifySettings[uid]; ok {
		return ns, nil
	}
	return model.DefaultNotifySettings, nil
}

func (s *fileStore) SetNotifySettings(ctx context.Context, ns model.NotifySettings) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.d.NotifySettings == nil {
		s.d.NotifySettings = map[int64]model.NotifySettings{}
	}
	s.d.NotifySettings[uid] = ns
	return s.save()
}

func (s *fileStore) ClaimReminder(ctx context.Context, key string, now time.Time) (bool, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.d.SentReminders == nil {
		s.d.SentReminders = map[string]time.Time{}
	}
	k := fmt.Sprintf("%d|%s", uid, key)
	if _, sent := s.d.SentReminders[k]; sent {
		return false, nil
	}
	for old, at := range s.d.SentReminders {
		if now.Sub(at) > ReminderMemory {
			delete(s.d.SentReminders, old)
		}
	}
	s.d.SentReminders[k] = now
	return true, s.save()
}

func (s *fileStore) AddSnooze(ctx context.Context, at time.Time, msg model.PushMessage) (model.Snooze, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Snooze{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, z := range s.d.Snoozes {
		if z.UserID == uid {
			n++
		}
	}
	if n >= MaxSnoozes {
		return model.Snooze{}, ErrLimit
	}
	s.d.NextSnoozeID++
	z := model.Snooze{ID: s.d.NextSnoozeID, UserID: uid, At: at, Message: msg}
	s.d.Snoozes = append(s.d.Snoozes, z)
	return z, s.save()
}

func (s *fileStore) Snoozes(ctx context.Context) []model.Snooze {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Snooze
	for _, z := range s.d.Snoozes {
		if z.UserID == uid {
			out = append(out, z)
		}
	}
	slices.SortStableFunc(out, func(a, b model.Snooze) int { return a.At.Compare(b.At) })
	return out
}

func (s *fileStore) DeleteSnooze(ctx context.Context, id int64) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Snoozes, func(z model.Snooze) bool { return z.ID == id && z.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	s.d.Snoozes = slices.Delete(s.d.Snoozes, i, i+1)
	return s.save()
}

func (s *fileStore) RepeatingEvents(ctx context.Context, from, to string) []model.Event {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Event
	for _, e := range s.d.Events {
		if e.UserID == uid && e.Repeat != model.RepeatNone && e.Date <= to && (e.RepeatUntil == "" || e.RepeatUntil >= from) {
			out = append(out, e)
		}
	}
	return out
}

func (s *fileStore) TakeDueSnoozes(_ context.Context, now time.Time) []model.Snooze {
	s.mu.Lock()
	defer s.mu.Unlock()
	var due []model.Snooze
	kept := s.d.Snoozes[:0]
	for _, z := range s.d.Snoozes {
		if z.At.After(now) {
			kept = append(kept, z)
		} else {
			due = append(due, z)
		}
	}
	if len(due) == 0 {
		return nil
	}
	s.d.Snoozes = kept
	if err := s.save(); err != nil {
		return nil
	}
	return due
}

func (s *fileStore) ServerKey(_ context.Context, name string, gen func() (string, error)) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.d.ServerKeys[name]; ok {
		return v, nil
	}
	v, err := gen()
	if err != nil {
		return "", err
	}
	if s.d.ServerKeys == nil {
		s.d.ServerKeys = map[string]string{}
	}
	s.d.ServerKeys[name] = v
	return v, s.save()
}
