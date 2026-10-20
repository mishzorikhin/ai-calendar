// Package model описывает данные API. Поля в JSON совпадают с типами фронтенда (src/domain/types.ts).
package model

import (
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
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	PassHash  string    `json:"-"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
}

// Event — событие календаря. Start и End — минуты от полуночи.
type Event struct {
	ID        string    `json:"id"`
	UserID    int64     `json:"userId,omitempty"`
	Date      string    `json:"date"`
	Title     string    `json:"title"`
	Subtitle  string    `json:"subtitle,omitempty"`
	Start     int       `json:"start"`
	End       int       `json:"end"`
	Badge     Badge     `json:"badge"`
	Highlight bool      `json:"highlight,omitempty"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
}

// EventPatch — частичное обновление события: nil-поля не трогаем.
// Subtitle: указатель на "" — очистить подзаголовок.
type EventPatch struct {
	Title    *string
	Subtitle *string
	Date     *string
	Start    *int
	End      *int
	Badge    *Badge
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
	ID        int       `json:"id"`
	UserID    int64     `json:"userId"`
	From      *User     `json:"from,omitempty"`
	TaskID    string    `json:"taskId,omitempty"`
	Text      string    `json:"text"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
}
