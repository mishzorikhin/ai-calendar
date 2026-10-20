// Package model описывает данные API. Поля в JSON совпадают с типами фронтенда (src/domain/types.ts).
package model

import "time"

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

// Event — событие календаря. Start и End — минуты от полуночи.
type Event struct {
	ID         string `json:"id"`
	Date       string `json:"date"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"`
	Start      int    `json:"start"`
	End        int    `json:"end"`
	Badge      Badge  `json:"badge"`
	SleepGraph bool   `json:"sleepGraph,omitempty"`
	Highlight  bool   `json:"highlight,omitempty"`
}

// Place — заведение. OpensAt и ClosesAt — минуты от полуночи; закрытие после полуночи больше 24×60.
type Place struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Cuisine     string     `json:"cuisine"`
	Rating      float64    `json:"rating"`
	WalkMinutes int        `json:"walkMinutes"`
	Distance    string     `json:"distance"`
	Address     string     `json:"address"`
	Price       string     `json:"price"`
	OpensAt     int        `json:"opensAt"`
	ClosesAt    int        `json:"closesAt"`
	Description string     `json:"description"`
	Tint        string     `json:"tint"`
	Art         string     `json:"art"`
	Photo       string     `json:"photo"`
	Tags        []string   `json:"tags"`
	Radar       [2]float64 `json:"radar"`
}

// OpenAt сообщает, открыто ли заведение в указанную минуту суток.
func (p Place) OpenAt(minutes int) bool {
	t := minutes
	if t < p.OpensAt && p.ClosesAt > 24*60 {
		t += 24 * 60
	}
	return t >= p.OpensAt && t < p.ClosesAt
}

type Review struct {
	Name     string `json:"name"`
	Initials string `json:"initials"`
	Color    string `json:"color"`
	Rating   int    `json:"rating"`
	Text     string `json:"text"`
}

type BookingStatus string

const (
	BookingConfirmed BookingStatus = "confirmed"
	BookingCancelled BookingStatus = "cancelled"
)

type Booking struct {
	ID        string        `json:"id"`
	Place     Place         `json:"place"`
	Date      string        `json:"date"`
	Start     int           `json:"start"`
	End       int           `json:"end"`
	Guests    int           `json:"guests"`
	Invite    bool          `json:"invite"`
	Code      string        `json:"code"`
	Status    BookingStatus `json:"status"`
	CreatedAt time.Time     `json:"createdAt"`
}

type Role string

const (
	RoleUser Role = "user"
	RoleAI   Role = "ai"
)

type Message struct {
	ID        int       `json:"id"`
	Role      Role      `json:"role"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}
