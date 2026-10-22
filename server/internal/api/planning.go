// Планирование и массовые действия ассистента: разложить задачи по свободным окнам,
// сдвинуть события дня, освободить день. Расчёт — чистые функции (planTasks, shiftPlan,
// placeItems), инструменты только собирают данные и применяют результат.
package api

import (
	"cmp"
	"context"
	"fmt"
	"hash/fnv"
	"slices"
	"strings"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// planItem — что поставить: задача или переносимое событие. Due — крайний день (пусто — без срока).
type planItem struct {
	ID      string
	Title   string
	Minutes int
	Due     string
}

// planDay — день, куда можно ставить: свободные окна и фокус-время (в нём — сначала).
type planDay struct {
	Date  string
	Free  []span
	Focus span
}

// placed — куда поставили. Late — после срока: раньше места не нашлось.
type placed struct {
	ID    string
	Title string
	Date  string
	Start int
	End   int
	Late  bool
}

// placeItems раскладывает по порядку: каждое — в самое раннее окно, где помещается, причём
// сначала в фокус-время дня, потом в остальное; до срока, если получается. Занятое окно
// сжимается на длину дела и перерыв buffer. Что не поместилось никуда — во втором списке.
func placeItems(items []planItem, days []planDay, buffer int) ([]placed, []planItem) {
	free := make([][]span, len(days))
	for i, d := range days {
		free[i] = slices.Clone(d.Free)
	}
	// take — первое начало в дне i, где помещается n минут (в пределах lim, если он задан).
	take := func(i, n int, lim span) (int, bool) {
		for _, f := range free[i] {
			start, end := f.Start, f.End
			if lim.End > lim.Start {
				start, end = max(start, lim.Start), min(end, lim.End)
				start = (start + 4) / 5 * 5
			}
			if end-start >= n {
				return start, true
			}
		}
		return 0, false
	}
	occupy := func(i, start, end int) {
		var next []span
		for _, f := range free[i] {
			if end <= f.Start || start >= f.End {
				next = append(next, f)
				continue
			}
			if start-f.Start > 0 {
				next = append(next, span{f.Start, start})
			}
			if f.End-(end+buffer) > 0 {
				next = append(next, span{(end + buffer + 4) / 5 * 5, f.End})
			}
		}
		free[i] = slices.DeleteFunc(next, func(s span) bool { return s.End <= s.Start })
	}
	var out []placed
	var left []planItem
	for _, it := range items {
		found := false
		// Два прохода: до срока (если он есть), затем — где угодно, с пометкой «после срока».
		for pass := 0; pass < 2 && !found; pass++ {
			for i, d := range days {
				late := it.Due != "" && d.Date > it.Due
				if pass == 0 && late {
					break
				}
				start, ok := take(i, it.Minutes, d.Focus)
				if !ok {
					start, ok = take(i, it.Minutes, span{})
				}
				if !ok {
					continue
				}
				occupy(i, start, start+it.Minutes)
				out = append(out, placed{ID: it.ID, Title: it.Title, Date: d.Date, Start: start, End: start + it.Minutes, Late: late})
				found = true
				break
			}
			if it.Due == "" {
				break // без срока второй проход ничего не добавит
			}
		}
		if !found {
			left = append(left, it)
		}
	}
	return out, left
}

// planTasks — план для открытых задач: сначала со сроком (раньше срок — раньше в плане),
// затем без срока в исходном порядке. Ничего не создаёт.
func planTasks(tasks []model.Task, days []planDay, buffer int) ([]placed, []planItem) {
	var items []planItem
	for _, t := range tasks {
		if t.Done || t.Kind != model.TaskKindTask {
			continue
		}
		items = append(items, planItem{ID: t.ID, Title: t.Title, Minutes: t.Minutes(), Due: t.Due})
	}
	slices.SortStableFunc(items, func(a, b planItem) int {
		switch {
		case a.Due == b.Due:
			return 0
		case a.Due == "":
			return 1
		case b.Due == "":
			return -1
		}
		return cmp.Compare(a.Due, b.Due)
	})
	return placeItems(items, days, buffer)
}

// shiftPlan — новое время событий после сдвига на minutes. Нельзя выйти за сутки: тогда ошибка
// с названием первого события, которое не помещается.
func shiftPlan(events []model.Event, minutes int) ([]placed, error) {
	out := make([]placed, 0, len(events))
	for _, e := range events {
		start, end := e.Start+minutes, e.End+minutes
		if start < 0 || end > dayMinutes {
			return nil, fmt.Errorf("«%s» выйдет за пределы дня (%s–%s)", e.Title, hm(max(start, 0)), hm(min(end, dayMinutes)%dayMinutes))
		}
		out = append(out, placed{ID: e.ID, Title: e.Title, Date: e.Date, Start: start, End: end})
	}
	return out, nil
}

// movable — своё событие со временем, которое можно двигать целиком: не из чужого календаря,
// не приглашение, не серия (сдвиг вхождения сдвинул бы все) и не кусок многодневного.
func movable(e model.Event) bool {
	return !e.ReadOnly && !e.AllDay && e.Invite == nil && e.Span == nil && e.Repeat == model.RepeatNone && e.Source == ""
}

// planDays — свободные окна дней с from (включительно) на n дней вперёд. workOnly — только
// рабочие дни и часы (выходные пропускаются). skip — события, которые не считаются занятыми
// (их как раз переносят).
func (s *server) planDays(ctx context.Context, p model.Profile, now time.Time, from string, n int, workOnly bool, skip map[string]bool) []planDay {
	events := s.eventsBetween(ctx, from, addDays(from, n))
	byDay := map[string][]model.Event{}
	for _, e := range events {
		if !skip[e.ID] {
			byDay[e.Date] = append(byDay[e.Date], e)
		}
	}
	today := now.Format(time.DateOnly)
	var out []planDay
	for i := range n {
		date := addDays(from, i)
		if date < today {
			continue
		}
		d, _ := time.Parse(time.DateOnly, date)
		lo, hi, ok := dayBounds(p, d.Weekday(), workOnly)
		if !ok {
			continue
		}
		q := slotQuery{From: lo, To: hi, Weekday: d.Weekday(), Now: -1, Duration: model.MinEstimate}
		if date == today {
			q.Now = now.Hour()*60 + now.Minute()
		}
		fl, fh := focusWindow(p, d.Weekday())
		out = append(out, planDay{Date: date, Free: freeSlots(q, busySpans(p, d.Weekday(), byDay[date])), Focus: span{fl, fh}})
	}
	return out
}

// toolPlanItem — пункт плана для модели.
type toolPlanItem struct {
	TaskID  string `json:"task_id,omitempty"`
	EventID string `json:"event_id,omitempty"`
	Title   string `json:"title"`
	Date    string `json:"date"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Late    bool   `json:"after_due,omitempty"`
}

func (s *server) toolPlanTasks(ctx context.Context, turn chatTurn, args map[string]any) (string, toolMeta) {
	from := strArg(args, "from")
	if from == "" {
		from = turn.now.Format(time.DateOnly)
	}
	if _, err := time.Parse(time.DateOnly, from); err != nil {
		return `{"error":"from должен быть в формате ГГГГ-ММ-ДД"}`, toolMeta{}
	}
	days := min(max(intArg(args, "days", 1), 1), 14)
	tasks := s.store.Tasks(ctx)
	if ids := stringsArg(args, "task_ids"); len(ids) > 0 {
		tasks = slices.DeleteFunc(tasks, func(t model.Task) bool { return !slices.Contains(ids, t.ID) })
	}
	p := s.profileFor(ctx)
	workOnly := true
	if v, ok := args["work_hours"].(bool); ok {
		workOnly = v
	}
	plan, left := planTasks(tasks, s.planDays(ctx, p, turn.now, from, days, workOnly, nil), p.BufferMinutes)
	items := make([]toolPlanItem, 0, len(plan))
	for _, pl := range plan {
		items = append(items, toolPlanItem{TaskID: pl.ID, Title: pl.Title, Date: pl.Date, Start: hm(pl.Start), End: hm(pl.End), Late: pl.Late})
	}
	unplaced := []string{}
	for _, it := range left {
		unplaced = append(unplaced, it.Title)
	}
	return toolJSON(map[string]any{
		"plan": items, "unplaced": unplaced,
		"instruction": "Это только план, ничего не создано. Покажи его пользователю коротко списком; после согласия создай события create_event с task_id (badge work). after_due — не успеть до срока.",
	}), toolMeta{detail: fmt.Sprintf("%d в плане", len(items)), date: from}
}

// eventsToMove — свои события дня, которые можно двигать: по списку id или все, что начинаются не раньше from.
func (s *server) eventsToMove(ctx context.Context, date string, ids []string, from int) (move, skipped []model.Event) {
	// Границы выборки включительны: только этот день.
	for _, e := range s.withAttendees(ctx, s.eventsBetween(ctx, date, date)) {
		if e.AllDay || (len(ids) > 0 && !slices.Contains(ids, e.ID)) || (len(ids) == 0 && e.Start < from) {
			continue
		}
		if movable(e) {
			move = append(move, e)
		} else {
			skipped = append(skipped, e)
		}
	}
	return move, skipped
}

// batchKey — ключ подтверждения массового действия: тот же набор и тот же сдвиг.
func batchKey(kind string, parts ...string) string {
	h := fnv.New64a()
	h.Write([]byte(strings.Join(parts, "|")))
	return fmt.Sprintf("%s:%x", kind, h.Sum64())
}

// planSig — подпись плана: что, куда и во сколько. Поменялось хоть что-то — это другое действие.
func planSig(plan []placed) string {
	var b strings.Builder
	for _, pl := range plan {
		fmt.Fprintf(&b, "%s@%s %d-%d;", pl.ID, pl.Date, pl.Start, pl.End)
	}
	return b.String()
}

func idsOf(events []model.Event) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.ID
	}
	return out
}

// skippedTitles — что не тронули и почему, для модели.
func skippedTitles(events []model.Event) []string {
	out := []string{}
	for _, e := range events {
		why := "из внешнего календаря"
		switch {
		case e.Invite != nil:
			why = "чужая встреча"
		case e.Repeat != model.RepeatNone:
			why = "повторяется — переносится вся серия, это update_event"
		case e.Span != nil:
			why = "многодневное"
		}
		out = append(out, e.Title+" ("+why+")")
	}
	return out
}

// moveAll применяет план переноса и возвращает, что получилось.
func (s *server) moveAll(ctx context.Context, events []model.Event, plan []placed) ([]toolPlanItem, error) {
	byID := map[string]model.Event{}
	for _, e := range events {
		byID[e.ID] = e
	}
	out := make([]toolPlanItem, 0, len(plan))
	for _, pl := range plan {
		cur := byID[pl.ID]
		date, start, end := pl.Date, pl.Start, pl.End
		ev, err := s.updateEventSynced(ctx, cur, model.EventPatch{Date: &date, Start: &start, End: &end})
		if err != nil {
			return out, err
		}
		if len(cur.Attendees) > 0 {
			s.notifyAttendeesChange(ctx, cur.Attendees, ev, "Перенесли: «%s»", "Перенёс ")
		}
		out = append(out, toolPlanItem{EventID: ev.ID, Title: ev.Title, Date: ev.Date, Start: hm(ev.Start), End: hm(ev.End)})
	}
	return out, nil
}

// batchCard — карточка подтверждения переноса: что и куда переедет.
func batchCard(turn chatTurn, key, title, done string, date string, plan []placed) confirmCard {
	lines := make([]string, 0, len(plan))
	for _, pl := range plan {
		lines = append(lines, fmt.Sprintf("%s → %s, %s", pl.Title, strings.ToLower(dayTitle(turn.now, pl.Date)), hm(pl.Start)))
	}
	return confirmCard{Key: key, Title: title, Detail: strings.Join(lines, "\n"), Button: "Перенести", Date: date, Done: done}
}

func (s *server) toolShiftEvents(ctx context.Context, turn chatTurn, args map[string]any) (string, toolMeta) {
	date := strArg(args, "date")
	if _, err := time.Parse(time.DateOnly, date); err != nil {
		return `{"error":"date должен быть в формате ГГГГ-ММ-ДД"}`, toolMeta{}
	}
	minutes := intArg(args, "minutes", 0)
	to := strArg(args, "to_date")
	if to != "" {
		if _, err := time.Parse(time.DateOnly, to); err != nil {
			return `{"error":"to_date должен быть в формате ГГГГ-ММ-ДД"}`, toolMeta{}
		}
	}
	if minutes == 0 && (to == "" || to == date) {
		return `{"error":"нужен сдвиг: minutes (±) или to_date"}`, toolMeta{}
	}
	from := 0
	if raw := strArg(args, "from"); raw != "" {
		var ok bool
		if from, ok = parseHM(raw); !ok {
			return `{"error":"from должен быть ЧЧ:ММ"}`, toolMeta{}
		}
	}
	meta := toolMeta{date: date}
	move, skipped := s.eventsToMove(ctx, date, stringsArg(args, "event_ids"), from)
	if len(move) == 0 {
		return toolJSON(map[string]any{"error": "нечего двигать", "skipped": skippedTitles(skipped)}), meta
	}
	plan, err := shiftPlan(move, minutes)
	if err != nil {
		return toolJSON(map[string]string{"error": err.Error()}), meta
	}
	if to != "" {
		for i := range plan {
			plan[i].Date = to
		}
	}
	// Перенос на другой день — всегда по кнопке, как и сдвиг больше трёх событий.
	if len(move) > 3 || (to != "" && to != date) {
		key := batchKey("shift", date, planSig(plan))
		n := plural(len(move), "событие", "события", "событий")
		card := batchCard(turn, key, "Перенести "+n+"?", "Перенёс "+n+".", date, plan)
		titles := make([]string, len(move))
		for i, e := range move {
			titles[i] = e.Title
		}
		if res, meta, wait := needsConfirm(turn, card, map[string]any{"events": titles}); wait {
			return res, meta
		}
	}
	done, err := s.moveAll(ctx, move, plan)
	if err != nil {
		return toolJSON(map[string]any{"error": "перенесено не всё", "moved": done}), meta
	}
	meta.detail = plural(len(done), "событие", "события", "событий")
	if to != "" {
		meta.date = to
	}
	return toolJSON(map[string]any{"ok": true, "moved": done, "skipped": skippedTitles(skipped)}), meta
}

func (s *server) toolClearDay(ctx context.Context, turn chatTurn, args map[string]any) (string, toolMeta) {
	date := strArg(args, "date")
	if _, err := time.Parse(time.DateOnly, date); err != nil {
		return `{"error":"date должен быть в формате ГГГГ-ММ-ДД"}`, toolMeta{}
	}
	meta := toolMeta{date: date}
	move, skipped := s.eventsToMove(ctx, date, nil, 0)
	if len(move) == 0 {
		return toolJSON(map[string]any{"ok": true, "moved": []toolPlanItem{}, "skipped": skippedTitles(skipped)}), meta
	}
	p := s.profileFor(ctx)
	items := make([]planItem, len(move))
	skip := map[string]bool{}
	for i, e := range move {
		items[i] = planItem{ID: e.ID, Title: e.Title, Minutes: e.End - e.Start}
		skip[e.ID] = true
	}
	// Рабочие дни есть — переносим в рабочие часы следующих рабочих дней, иначе — в любой следующий день.
	plan, left := placeItems(items, s.planDays(ctx, p, turn.now, addDays(date, 1), 14, len(p.WorkDays) > 0, skip), p.BufferMinutes)
	if len(left) > 0 {
		titles := make([]string, len(left))
		for i, it := range left {
			titles[i] = it.Title
		}
		return toolJSON(map[string]any{"error": "за две недели нет места для всех", "unplaced": titles}), meta
	}
	key := batchKey("clear", date, planSig(plan))
	card := batchCard(turn, key, "Освободить "+strings.ToLower(dayTitle(turn.now, date))+"?", "Готово, день свободен.", date, plan)
	shown := make([]toolPlanItem, len(plan))
	for i, pl := range plan {
		shown[i] = toolPlanItem{EventID: pl.ID, Title: pl.Title, Date: pl.Date, Start: hm(pl.Start), End: hm(pl.End)}
	}
	if res, meta, wait := needsConfirm(turn, card, map[string]any{"plan": shown, "skipped": skippedTitles(skipped)}); wait {
		return res, meta
	}
	done, err := s.moveAll(ctx, move, plan)
	if err != nil {
		return toolJSON(map[string]any{"error": "перенесено не всё", "moved": done}), meta
	}
	meta.detail = "день свободен"
	return toolJSON(map[string]any{"ok": true, "moved": done, "skipped": skippedTitles(skipped)}), meta
}
