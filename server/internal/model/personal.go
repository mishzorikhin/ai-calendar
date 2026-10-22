package model

import (
	"encoding/json"
	"slices"
	"time"
)

// Персонализация ассистента: профиль (что человек сказал о себе), память (факты из разговоров
// и выводы из поведения) и карточки людей. Поля JSON совпадают с src/domain/types.ts.

// Focus — когда пользователю лучше думается: туда ассистент ставит сложные задачи.
type Focus string

const (
	FocusNone      Focus = "none"
	FocusMorning   Focus = "morning"
	FocusAfternoon Focus = "afternoon"
	FocusEvening   Focus = "evening"
)

func (f Focus) Valid() bool {
	switch f {
	case FocusNone, FocusMorning, FocusAfternoon, FocusEvening:
		return true
	}
	return false
}

// Tone — как подробно отвечать; Address — на «ты» или на «вы».
const (
	ToneBrief    = "brief"
	ToneDetailed = "detailed"
	AddressTy    = "ty"
	AddressVy    = "vy"
)

// ProtectedBlock — «святой» отрезок дня (обед, спорт, дорога в сад): ассистент его не занимает.
// Days — дни недели, 0 — воскресенье (как Date.getDay()); пусто — каждый день.
type ProtectedBlock struct {
	Title string `json:"title"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	Days  []int  `json:"days,omitempty"`
}

// On — блок действует в этот день недели.
func (b ProtectedBlock) On(weekday time.Weekday) bool {
	return len(b.Days) == 0 || slices.Contains(b.Days, int(weekday))
}

// Profile — что пользователь рассказал о себе. Время — минуты от полуночи в его поясе.
type Profile struct {
	// WakeUp и BedTime — границы активного дня; BedTime ≤ WakeUp — ложится после полуночи.
	WakeUp  int `json:"wakeUp"`
	BedTime int `json:"bedTime"`
	// WorkStart–WorkEnd в дни WorkDays (0 — воскресенье) — рабочее время.
	WorkStart int   `json:"workStart"`
	WorkEnd   int   `json:"workEnd"`
	WorkDays  []int `json:"workDays"`
	Focus     Focus `json:"focus"`
	// MeetingMinutes — обычная длина встречи; BufferMinutes — перерыв между делами.
	MeetingMinutes int              `json:"meetingMinutes"`
	BufferMinutes  int              `json:"bufferMinutes"`
	Protected      []ProtectedBlock `json:"protected"`
	Tone           string           `json:"tone"`
	Address        string           `json:"address"`
	// About — свободный текст «что ещё важно знать ассистенту».
	About string `json:"about,omitempty"`
	// Memory — ассистент запоминает факты из разговоров и видит их.
	Memory bool `json:"memory"`
	// Proactive — сколько предложений в день присылать (0 — не присылать); Muted — выключенные виды.
	Proactive int      `json:"proactive"`
	Muted     []string `json:"muted,omitempty"`
	// Onboarded — анкета при первом входе пройдена или пропущена.
	Onboarded bool `json:"onboarded"`
}

// Пределы профиля.
const (
	MaxProtectedBlocks = 10
	MaxProactive       = 3
	MaxAboutRunes      = 500
	MaxBlockTitleRunes = 40
)

// DefaultProfile — профиль, пока пользователь ничего о себе не рассказал.
func DefaultProfile() Profile {
	return Profile{
		WakeUp: 7 * 60, BedTime: 23 * 60, WorkStart: 9 * 60, WorkEnd: 18 * 60, WorkDays: []int{1, 2, 3, 4, 5},
		Focus: FocusNone, MeetingMinutes: 60, BufferMinutes: 0, Protected: []ProtectedBlock{},
		Tone: ToneBrief, Address: AddressTy, Memory: true, Proactive: 2,
	}
}

// UnmarshalJSON подставляет значения по умолчанию для полей, которых нет в сохранённом профиле.
func (p *Profile) UnmarshalJSON(b []byte) error {
	type plain Profile
	v := plain(DefaultProfile())
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*p = Profile(v)
	if p.Protected == nil {
		p.Protected = []ProtectedBlock{}
	}
	return nil
}

// WorkDay — рабочий ли это день недели.
func (p Profile) WorkDay(weekday time.Weekday) bool {
	return slices.Contains(p.WorkDays, int(weekday))
}

// DayBounds — активное время дня: от подъёма до отбоя (после полуночи — до конца суток).
func (p Profile) DayBounds() (from, to int) {
	if p.BedTime <= p.WakeUp {
		return p.WakeUp, 24 * 60
	}
	return p.WakeUp, p.BedTime
}

// MemoryKind — вид факта о пользователе.
type MemoryKind string

const (
	// MemoryAbout — о самом пользователе: имя, город, работа, семья. Всегда идёт в промпт.
	MemoryAbout      MemoryKind = "about"
	MemoryPerson     MemoryKind = "person"
	MemoryPlace      MemoryKind = "place"
	MemoryHabit      MemoryKind = "habit"
	MemoryPreference MemoryKind = "preference"
	MemoryRule       MemoryKind = "rule"
	MemoryDate       MemoryKind = "date"
	MemoryOther      MemoryKind = "other"
)

func (k MemoryKind) Valid() bool {
	switch k {
	case MemoryAbout, MemoryPerson, MemoryPlace, MemoryHabit, MemoryPreference, MemoryRule, MemoryDate, MemoryOther:
		return true
	}
	return false
}

// MemorySource — откуда факт: пользователь сказал сам или ассистент сделал вывод по поведению.
type MemorySource string

const (
	SourceUser     MemorySource = "user"
	SourceInferred MemorySource = "inferred"
)

// Memory — факт о пользователе в памяти ассистента.
type Memory struct {
	ID     int64      `json:"id"`
	UserID int64      `json:"userId,omitempty"`
	Kind   MemoryKind `json:"kind"`
	Text   string     `json:"text"`
	// Date — для дат: ГГГГ-ММ-ДД (один раз) или --ММ-ДД (каждый год).
	Date   string       `json:"date,omitempty"`
	Source MemorySource `json:"source"`
	// Confirmed — догадку подтвердили (у фактов пользователя всегда true).
	Confirmed bool `json:"confirmed"`
	// Key — устойчивый ключ догадки («duration:sport»): одну и ту же не предлагаем дважды.
	Key string `json:"key,omitempty"`
	// Rejected — от догадки отказались; хранится, чтобы не предлагать её снова, в списках не видна.
	Rejected  bool      `json:"rejected,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	// UsedAt — когда факт последний раз попадал в запрос к модели.
	UsedAt time.Time `json:"usedAt,omitempty"`
}

// MemoryPatch — частичное изменение факта: nil-поля не трогаем.
type MemoryPatch struct {
	Kind      *MemoryKind
	Text      *string
	Date      *string
	Confirmed *bool
	Rejected  *bool
}

// Apply применяет патч к факту на месте.
func (m *Memory) Apply(p MemoryPatch) {
	if p.Kind != nil {
		m.Kind = *p.Kind
	}
	if p.Text != nil {
		m.Text = *p.Text
	}
	if p.Date != nil {
		m.Date = *p.Date
	}
	if p.Confirmed != nil {
		m.Confirmed = *p.Confirmed
	}
	if p.Rejected != nil {
		m.Rejected = *p.Rejected
	}
}

// Пределы памяти.
const (
	MaxMemories       = 300
	MaxMemoryRunes    = 300
	MaxPeople         = 200
	MaxPersonAliases  = 5
	MaxPersonNotes    = 500
	MaxPersonField    = 80
	MaxMeetingMinutes = 8 * 60
)

// Person — карточка человека из окружения пользователя: «Глеб — коллега, встречаемся в кофейне».
type Person struct {
	ID       int64    `json:"id"`
	UserID   int64    `json:"userId,omitempty"`
	Name     string   `json:"name"`
	Aliases  []string `json:"aliases,omitempty"`
	Relation string   `json:"relation,omitempty"`
	// Place — обычное место встречи; MeetingMinutes — обычная длительность (0 — как в профиле).
	Place          string `json:"place,omitempty"`
	MeetingMinutes int    `json:"meetingMinutes,omitempty"`
	// Birthday — ГГГГ-ММ-ДД или --ММ-ДД (год неизвестен).
	Birthday string `json:"birthday,omitempty"`
	Notes    string `json:"notes,omitempty"`
	// Username — логин, если человек есть на этом сервере (для совместных задач и приглашений).
	Username  string    `json:"username,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SuggestionKind — вид предложения ассистента (этап «ассистент предлагает сам»).
type SuggestionKind string

const (
	// SuggestLunch — в плотный день не осталось времени на обед.
	SuggestLunch SuggestionKind = "lunch"
	// SuggestStaleTask — задача давно открыта или просрочена.
	SuggestStaleTask SuggestionKind = "stale_task"
	// SuggestDate — скоро важная дата из памяти или день рождения.
	SuggestDate SuggestionKind = "date"
	// SuggestOverload — встреч на неделе заметно больше обычного.
	SuggestOverload SuggestionKind = "overload"
	// SuggestPlanTasks — утром есть задачи без времени и свободные окна.
	SuggestPlanTasks SuggestionKind = "plan_tasks"
)

func (k SuggestionKind) Valid() bool {
	switch k {
	case SuggestLunch, SuggestStaleTask, SuggestDate, SuggestOverload, SuggestPlanTasks:
		return true
	}
	return false
}
