package model

import "time"

// Предложения ассистента: он сам замечает, что можно улучшить в расписании, и предлагает
// это одной карточкой («Да» / «Нет»). Поля JSON совпадают с src/domain/types.ts.

// Статусы предложения. Истёкшее (ExpiresAt в прошлом) не хранится отдельным статусом —
// оно просто не показывается.
const (
	SuggestionPending   = "pending"
	SuggestionAccepted  = "accepted"
	SuggestionDismissed = "dismissed"
)

// Что делает «Да».
const (
	// ActionEvent — создать событие Title в Date с Start по End.
	ActionEvent = "event"
	// ActionTask — создать задачу Title со сроком Due.
	ActionTask = "task"
	// ActionChat — открыть чат с запросом Prompt (план решает ассистент вместе с пользователем).
	ActionChat = "chat"
)

// SuggestionAction — что сделать, если пользователь согласен.
type SuggestionAction struct {
	Type   string `json:"type"`
	Title  string `json:"title,omitempty"`
	Date   string `json:"date,omitempty"`
	Start  int    `json:"start,omitempty"`
	End    int    `json:"end,omitempty"`
	Badge  Badge  `json:"badge,omitempty"`
	Due    string `json:"due,omitempty"`
	Prompt string `json:"prompt,omitempty"`
}

// Suggestion — предложение ассистента.
type Suggestion struct {
	ID     int64          `json:"id"`
	UserID int64          `json:"userId,omitempty"`
	Kind   SuggestionKind `json:"kind"`
	// Key — одно и то же предложение не делаем дважды («lunch:2026-10-22», «stale_task:task-3»).
	Key       string           `json:"key"`
	Title     string           `json:"title"`
	Body      string           `json:"body"`
	Action    SuggestionAction `json:"action"`
	Status    string           `json:"status"`
	CreatedAt time.Time        `json:"createdAt"`
	ExpiresAt time.Time        `json:"expiresAt"`
}

// Active — предложение ждёт ответа и ещё не устарело.
func (s Suggestion) Active(now time.Time) bool {
	return s.Status == SuggestionPending && now.Before(s.ExpiresAt)
}
