// Напоминания: каждые PushOptions.Interval сервер смотрит события и задачи
// пользователей с подписанными устройствами и отправляет то, чему пришло время.
//
// Отдельной очереди заданий нет: напоминания вычисляются из текущих данных,
// поэтому их не нужно пересчитывать при каждой правке события, синхронизации
// календаря или действии ассистента. От повторов защищает отметка в хранилище
// (ClaimReminder) по ключу, в который входят дата и время: перенесли встречу —
// ключ новый, и напоминание придёт заново.
package api

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
	"github.com/mishzorikhin/ai-calendar/server/internal/webpush"
)

// reminderGrace — насколько поздно ещё можно прислать напоминание (перезапуск сервера,
// пропущенный тик). Пропущенные дольше — не шлём: «через 10 минут» спустя час только путает.
const reminderGrace = 10 * time.Minute

// reminder — напоминание, которому пришло время.
type reminder struct {
	key string
	at  time.Time
	msg model.PushMessage
	opt pushOpts
}

// runPushLoop — фоновая рассылка напоминаний и отложенных уведомлений.
func (s *server) runPushLoop(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		s.remindAll(ctx, s.cal.now())
	}
}

// remindAll отправляет всё, чему пришло время к моменту now.
func (s *server) remindAll(ctx context.Context, now time.Time) {
	for _, z := range s.store.TakeDueSnoozes(ctx, now) {
		u, err := s.store.UserByID(ctx, z.UserID)
		if err != nil {
			continue
		}
		_, _ = s.pushTo(store.WithUser(ctx, u), z.Message, pushOpts{ttl: time.Hour, urgency: webpush.UrgencyHigh})
	}
	for _, id := range s.store.PushUserIDs(ctx) {
		if ctx.Err() != nil {
			return
		}
		u, err := s.store.UserByID(ctx, id)
		if err != nil {
			continue
		}
		s.remindUser(store.WithUser(ctx, u), u, now)
	}
}

func (s *server) remindUser(ctx context.Context, u model.User, now time.Time) {
	ns, err := s.store.NotifySettings(ctx)
	if err != nil {
		return
	}
	loc := s.cal.location(u)
	from := now.Add(-reminderGrace)
	// События — от дня начала окна до недели вперёд (самое раннее напоминание — за неделю).
	first := from.In(loc).Format(time.DateOnly)
	last := now.In(loc).AddDate(0, 0, 8).Format(time.DateOnly)
	events := s.store.EventsBetween(ctx, first, last)
	tasks := s.store.Tasks(ctx)
	for _, r := range planReminders(loc, ns, events, tasks, from, now) {
		ok, err := s.store.ClaimReminder(ctx, r.key, now)
		if err != nil || !ok {
			continue
		}
		_, _ = s.pushTo(ctx, r.msg, r.opt)
	}
}

// localTime — момент «дата + минуты от полуночи» в поясе loc (по настенным часам,
// поэтому переход на летнее время не сдвигает напоминание).
func localTime(date string, minutes int, loc *time.Location) (time.Time, bool) {
	d, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return time.Time{}, false
	}
	return time.Date(d.Year(), d.Month(), d.Day(), 0, minutes, 0, 0, loc), true
}

// planReminders — напоминания со временем в (from, to]. Чистая функция: всё, что
// нужно, передаётся аргументами.
func planReminders(loc *time.Location, ns model.NotifySettings, events []model.Event, tasks []model.Task, from, to time.Time) []reminder {
	var out []reminder
	inWindow := func(at time.Time) bool { return at.After(from) && !at.After(to) }

	for _, e := range events {
		if e.AllDay {
			continue // у событий на весь день нет времени — они попадают в сводку
		}
		start, ok := localTime(e.Date, e.Start, loc)
		if !ok {
			continue
		}
		offsets := e.Reminders
		if offsets == nil && ns.EventReminder >= 0 {
			offsets = []int{ns.EventReminder}
		}
		for _, off := range offsets {
			at := start.Add(-time.Duration(off) * time.Minute)
			if !inWindow(at) {
				continue
			}
			out = append(out, reminder{
				key: fmt.Sprintf("event:%s:%s:%d:%d", e.ID, e.Date, e.Start, off),
				at:  at,
				msg: model.PushMessage{
					Kind:  model.PushEvent,
					Title: e.Title,
					Body:  eventReminderBody(e, off),
					URL:   "/#day/" + e.Date,
					Tag:   "event:" + e.ID,
				},
				// Хранить, пока встреча не началась (плюс немного): позже напоминание бесполезно.
				opt: pushOpts{ttl: max(start.Add(15*time.Minute).Sub(at), time.Minute), urgency: webpush.UrgencyHigh},
			})
		}
	}

	if ns.TaskTime >= 0 {
		for _, t := range tasks {
			if t.Done || t.Due == "" {
				continue
			}
			at, ok := localTime(t.Due, ns.TaskTime, loc)
			if !ok || !inWindow(at) {
				continue
			}
			body := "Срок сегодня"
			if t.Kind == model.TaskKindGoal {
				body = "Цель: срок сегодня"
			}
			if t.Subtitle != "" {
				body += " · " + t.Subtitle
			}
			out = append(out, reminder{
				key: fmt.Sprintf("task:%s:%s:%d", t.ID, t.Due, ns.TaskTime),
				at:  at,
				msg: model.PushMessage{
					Kind: model.PushTask, Title: t.Title, Body: body, URL: "/#home", Tag: "task:" + t.ID, TaskID: t.ID,
				},
				opt: pushOpts{ttl: 12 * time.Hour, urgency: webpush.UrgencyNormal},
			})
		}
	}

	if ns.Digest >= 0 {
		// Окно может переходить через полночь — проверяем оба дня.
		days := []string{from.In(loc).Format(time.DateOnly), to.In(loc).Format(time.DateOnly)}
		for _, day := range slices.Compact(days) {
			at, ok := localTime(day, ns.Digest, loc)
			if !ok || !inWindow(at) {
				continue
			}
			body, ok := digestBody(day, events, tasks)
			if !ok {
				continue // пустой день — не беспокоим
			}
			out = append(out, reminder{
				key: "digest:" + day,
				at:  at,
				msg: model.PushMessage{Kind: model.PushDigest, Title: "План на сегодня", Body: body, URL: "/#day/" + day, Tag: "digest"},
				opt: pushOpts{ttl: 6 * time.Hour, urgency: webpush.UrgencyNormal},
			})
		}
	}
	slices.SortStableFunc(out, func(a, b reminder) int { return a.at.Compare(b.at) })
	return out
}

func clock(minutes int) string {
	return fmt.Sprintf("%d:%02d", minutes/60%24, minutes%60)
}

// eventReminderBody — «Через 10 минут · 10:00–11:00 · Кафе».
func eventReminderBody(e model.Event, off int) string {
	var when string
	switch {
	case off == 0:
		when = "Сейчас"
	case off < 60:
		when = "Через " + plural(off, "минуту", "минуты", "минут")
	case off < 24*60 && off%60 == 0:
		when = "Через " + plural(off/60, "час", "часа", "часов")
	case off < 24*60:
		when = fmt.Sprintf("Через %d ч %d мин", off/60, off%60)
	case off%(24*60) == 0:
		when = "Через " + plural(off/(24*60), "день", "дня", "дней")
	default:
		when = "Через " + plural(off/(24*60), "день", "дня", "дней") + " и " + plural(off%(24*60)/60, "час", "часа", "часов")
	}
	parts := []string{when, clock(e.Start) + "–" + clock(e.End)}
	if e.Subtitle != "" {
		parts = append(parts, e.Subtitle)
	}
	return strings.Join(parts, " · ")
}

// digestBody — «3 встречи, первая в 10:00 — Звонок. 2 задачи на сегодня»; false — день пуст.
func digestBody(day string, events []model.Event, tasks []model.Task) (string, bool) {
	var timed []model.Event
	allDay := 0
	for _, e := range events {
		if e.Date != day {
			continue
		}
		if e.AllDay {
			allDay++
		} else {
			timed = append(timed, e)
		}
	}
	due := 0
	for _, t := range tasks {
		if !t.Done && t.Due == day {
			due++
		}
	}
	var parts []string
	if len(timed) > 0 {
		slices.SortStableFunc(timed, func(a, b model.Event) int { return a.Start - b.Start })
		first := timed[0]
		if len(timed) == 1 {
			parts = append(parts, fmt.Sprintf("В %s — %s", clock(first.Start), first.Title))
		} else {
			parts = append(parts, fmt.Sprintf("%s, первая в %s — %s",
				plural(len(timed), "встреча", "встречи", "встреч"), clock(first.Start), first.Title))
		}
	}
	if allDay > 0 {
		parts = append(parts, plural(allDay, "событие", "события", "событий")+" на весь день")
	}
	if due > 0 {
		parts = append(parts, plural(due, "задача", "задачи", "задач")+" со сроком сегодня")
	}
	if len(parts) == 0 {
		return "", false
	}
	return strings.Join(parts, ". "), true
}

// plural — «1 минуту», «3 минуты», «5 минут».
func plural(n int, one, few, many string) string {
	form := many
	switch m10, m100 := n%10, n%100; {
	case m10 == 1 && m100 != 11:
		form = one
	case m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14):
		form = few
	}
	return fmt.Sprintf("%d %s", n, form)
}
