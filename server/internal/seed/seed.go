// Package seed — исходные данные: заведения, отзывы и типовое расписание дня.
package seed

import (
	"fmt"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Places — заведения рядом с пользователем (в прототипе — фиксированный список).
var Places = []model.Place{
	{
		ID:          "scramble",
		Name:        "Scramble place",
		Cuisine:     "Завтраки весь день",
		Rating:      4.9,
		WalkMinutes: 10,
		Distance:    "650 м",
		Address:     "Пятницкая ул., 12",
		Price:       "₽₽",
		OpensAt:     480,
		ClosesAt:    1320,
		Description: "Уютное место для неспешных завтраков: свежая выпечка, панкейки с ягодами, домашние джемы и хороший кофе.",
		Tint:        "rgba(132, 98, 70, 0.62)",
		Art:         "radial-gradient(120% 90% at 20% 30%, #f3d9b8 0%, rgba(243,217,184,0) 55%), radial-gradient(80% 70% at 80% 70%, #c9875a 0%, rgba(201,135,90,0) 60%), radial-gradient(60% 50% at 65% 25%, #fff3e0 0%, rgba(255,243,224,0) 60%), linear-gradient(160deg, #e8c39c 0%, #b07a52 55%, #6f4a33 100%)",
		Photo:       "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=900&q=70",
		Tags:        []string{"Завтраки", "Выпечка", "Кофе", "Тихо"},
		Radar:       [2]float64{0.32, 0.5},
	},
	{
		ID:          "ambient",
		Name:        "Ambient bar",
		Cuisine:     "Европейская кухня",
		Rating:      4.8,
		WalkMinutes: 25,
		Distance:    "1,9 км",
		Address:     "Малая Ордынка, 7",
		Price:       "₽₽₽",
		OpensAt:     720,
		ClosesAt:    1500,
		Description: "Камерная атмосфера, сезонные продукты и большой выбор крафтового пива от местных пивоварен.",
		Tint:        "rgba(78, 84, 52, 0.62)",
		Art:         "radial-gradient(90% 70% at 75% 25%, #f1e4c2 0%, rgba(241,228,194,0) 50%), radial-gradient(90% 80% at 25% 75%, #5d7146 0%, rgba(93,113,70,0) 65%), linear-gradient(170deg, #9aa57a 0%, #56603d 55%, #2f3523 100%)",
		Photo:       "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=900&q=70",
		Tags:        []string{"Бар", "Крафт", "Поздно"},
		Radar:       [2]float64{-0.72, -0.48},
	},
	{
		ID:          "green",
		Name:        "Green cup",
		Cuisine:     "Кофейня",
		Rating:      4.3,
		WalkMinutes: 15,
		Distance:    "1,1 км",
		Address:     "Новокузнецкая ул., 20",
		Price:       "₽",
		OpensAt:     450,
		ClosesAt:    1260,
		Description: "Светлая кофейня с большими окнами, боулами и десертами без сахара.",
		Tint:        "rgba(70, 104, 96, 0.6)",
		Art:         "radial-gradient(90% 70% at 30% 30%, #e8f1e6 0%, rgba(232,241,230,0) 55%), radial-gradient(80% 70% at 75% 75%, #6f9c8e 0%, rgba(111,156,142,0) 60%), linear-gradient(160deg, #b9d3c5 0%, #6d978a 55%, #3c5a52 100%)",
		Photo:       "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=900&q=70",
		Tags:        []string{"Кофе", "Боулы", "Ноутбук-friendly"},
		Radar:       [2]float64{0.66, -0.78},
	},
}

// Reviews — отзывы, одинаковые для всех мест (демо).
var Reviews = []model.Review{
	{Name: "Анна", Initials: "А", Color: "#f3c9b9", Rating: 5, Text: "Лучшие панкейки в районе, приходим каждое воскресенье."},
	{Name: "Дмитрий", Initials: "Д", Color: "#c9d4f3", Rating: 5, Text: "Тихо, вкусный кофе, можно спокойно поговорить."},
	{Name: "Мария", Initials: "М", Color: "#d6eccb", Rating: 4, Text: "Утром бывает очередь, но бронь держат чётко."},
}

// FindPlace ищет заведение по id.
func FindPlace(id string) (model.Place, bool) {
	for _, p := range Places {
		if p.ID == id {
			return p, true
		}
	}
	return model.Place{}, false
}

type templateEvent struct {
	key        string
	title      string
	subtitle   string
	start, end int
	badge      model.Badge
	sleepGraph bool
}

func hm(h, m int) int { return h*60 + m }

var schedule = []templateEvent{
	{key: "sleep", title: "Сон", subtitle: "4 ч глубокого", start: hm(6, 0), end: hm(8, 0), badge: model.BadgeSleep, sleepGraph: true},
	{key: "routine", title: "Утренняя рутина", start: hm(8, 0), end: hm(9, 0), badge: model.BadgeRoutine},
	{key: "vc", title: "Подготовка к созвону", subtitle: "A301 — переговорная", start: hm(10, 30), end: hm(11, 30), badge: model.BadgeWork},
	{key: "lunch", title: "Обед с командой", subtitle: "Water Bar", start: hm(13, 0), end: hm(14, 0), badge: model.BadgeFood},
	{key: "ux", title: "Встреча по UX", subtitle: "Продуктовая команда", start: hm(15, 0), end: hm(16, 30), badge: model.BadgeWork},
	{key: "gym", title: "Тренировка", subtitle: "Зал на Покровке", start: hm(17, 0), end: hm(18, 0), badge: model.BadgeSport},
	{key: "dinner", title: "Ужин", subtitle: "Дома", start: hm(19, 30), end: hm(20, 30), badge: model.BadgeFood},
	{key: "read", title: "Чтение", subtitle: "30 страниц", start: hm(22, 0), end: hm(23, 0), badge: model.BadgeRead},
}

// DaySchedule — типовое расписание дня. Дни немного различаются, как и в моках фронтенда.
func DaySchedule(date time.Time) []model.Event {
	day := date.Format(time.DateOnly)
	seed := date.Day() % 3
	events := make([]model.Event, 0, len(schedule))
	for _, t := range schedule {
		if (seed == 1 && t.key == "gym") || (seed == 2 && t.key == "lunch") {
			continue
		}
		events = append(events, model.Event{
			ID:         fmt.Sprintf("base-%s-%s", day, t.key),
			Date:       day,
			Title:      t.title,
			Subtitle:   t.subtitle,
			Start:      t.start,
			End:        t.end,
			Badge:      t.badge,
			SleepGraph: t.sleepGraph,
		})
	}
	return events
}

// monthPattern — точки событий в месячной сетке по числу месяца.
var monthPattern = map[int][]model.Badge{
	1:  {model.BadgeFood},
	3:  {model.BadgeWork},
	8:  {model.BadgeWork, model.BadgeFood},
	11: {model.BadgeWork},
	14: {model.BadgeSport},
	17: {model.BadgeWork, model.BadgeRoutine},
	19: {model.BadgeFood},
	22: {model.BadgeSport, model.BadgeFood},
	25: {model.BadgeWork},
	27: {model.BadgeWork, model.BadgeRoutine},
	30: {model.BadgeFood},
}

// MonthDots — значки по дням месяца из типового расписания.
func MonthDots(daysInMonth int) map[int][]model.Badge {
	dots := make(map[int][]model.Badge, len(monthPattern))
	for day, badges := range monthPattern {
		if day <= daysInMonth {
			dots[day] = append([]model.Badge(nil), badges...)
		}
	}
	return dots
}
