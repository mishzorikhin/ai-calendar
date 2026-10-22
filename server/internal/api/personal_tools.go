package api

import (
	"context"
	"slices"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Инструменты персонализации: профиль, память и карточки людей.

var dayNames = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

func object(props map[string]any, required ...string) map[string]any {
	if required == nil {
		required = []string{}
	}
	return map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
}

var personalTools = []llm.Tool{
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "update_profile",
		Description: "Изменить профиль пользователя по его прямой просьбе: ритм дня, рабочие часы и дни, когда лучше думается, длительность встречи, перерыв, «святые» блоки, манеру общения, «о себе». Переданные поля заменяют старые.",
		Parameters: object(map[string]any{
			"wake_up":         map[string]any{"type": "string", "description": "Подъём, ЧЧ:ММ"},
			"bed_time":        map[string]any{"type": "string", "description": "Отбой, ЧЧ:ММ"},
			"work_start":      map[string]any{"type": "string", "description": "Начало работы, ЧЧ:ММ"},
			"work_end":        map[string]any{"type": "string", "description": "Конец работы, ЧЧ:ММ"},
			"work_days":       map[string]any{"type": "array", "items": map[string]any{"type": "string", "enum": dayNames}, "description": "Рабочие дни"},
			"focus":           map[string]any{"type": "string", "enum": []string{"none", "morning", "afternoon", "evening"}, "description": "Когда лучше думается"},
			"meeting_minutes": map[string]any{"type": "integer", "minimum": 15, "maximum": 480, "description": "Обычная длина встречи"},
			"buffer_minutes":  map[string]any{"type": "integer", "minimum": 0, "maximum": 60, "description": "Перерыв между делами"},
			"protected": map[string]any{"type": "array", "maxItems": model.MaxProtectedBlocks,
				"description": "Полный новый список «святых» блоков (старый заменяется — включи и те, что остаются)",
				"items": object(map[string]any{
					"title": map[string]any{"type": "string"},
					"start": map[string]any{"type": "string", "description": "ЧЧ:ММ"},
					"end":   map[string]any{"type": "string", "description": "ЧЧ:ММ"},
					"days":  map[string]any{"type": "array", "items": map[string]any{"type": "string", "enum": dayNames}, "description": "Пусто — каждый день"},
				}, "title", "start", "end")},
			"tone":    map[string]any{"type": "string", "enum": []string{"brief", "detailed"}},
			"address": map[string]any{"type": "string", "enum": []string{"ty", "vy"}, "description": "На «ты» или на «вы»"},
			"about":   map[string]any{"type": "string", "description": "Что ещё важно знать о пользователе (заменяет прежний текст)"},
		}),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "forget",
		Description: "Забыть факт из памяти по id.",
		Parameters:  object(map[string]any{"memory_id": map[string]any{"type": "integer"}}, "memory_id"),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "list_memories",
		Description: "Все факты, которые ты помнишь о пользователе, с id.",
		Parameters:  object(map[string]any{}),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "list_people",
		Description: "Карточки людей пользователя: кто это, где обычно встречаются, длительность, день рождения, заметки, логин.",
		Parameters:  object(map[string]any{}),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "respond_invitation",
		Description: "Ответить на приглашение на чужую встречу (invited_by в get_day_schedule): придёт пользователь или нет.",
		Parameters: object(map[string]any{
			"event_id": map[string]any{"type": "string"},
			"answer":   map[string]any{"type": "string", "enum": []string{"accepted", "declined"}},
		}, "event_id", "answer"),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "plan_tasks",
		Description: "Предложить план: разложить открытые задачи по свободным окнам (фокус-время, рабочие часы, сроки, оценки). Ничего не создаёт.",
		Parameters: object(map[string]any{
			"task_ids":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Какие задачи; пусто — все открытые"},
			"from":       map[string]any{"type": "string", "description": "С какого дня, ГГГГ-ММ-ДД; пусто — сегодня"},
			"days":       map[string]any{"type": "integer", "minimum": 1, "maximum": 14, "description": "На сколько дней вперёд (1 — только этот день)"},
			"work_hours": map[string]any{"type": "boolean", "description": "Только рабочие часы и дни (по умолчанию true); false — весь день, для личных дел"},
		}),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "shift_events",
		Description: "Сдвинуть свои события дня на N минут и/или перенести на другой день: по списку id или все, что начинаются не раньше from. Больше трёх событий и перенос на другой день выполнятся только по кнопке пользователя.",
		Parameters: object(map[string]any{
			"date":      map[string]any{"type": "string", "description": "День, ГГГГ-ММ-ДД"},
			"minutes":   map[string]any{"type": "integer", "description": "На сколько минут сдвинуть: 60 — на час позже, -30 — на полчаса раньше"},
			"to_date":   map[string]any{"type": "string", "description": "Перенести на этот день, ГГГГ-ММ-ДД"},
			"event_ids": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Какие события; пусто — все со временем от from"},
			"from":      map[string]any{"type": "string", "description": "ЧЧ:ММ — двигать события, начинающиеся не раньше (без event_ids)"},
		}, "date"),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "clear_day",
		Description: "Освободить день: перенести свои события в ближайшие свободные окна следующих рабочих дней. Выполнится только по кнопке пользователя.",
		Parameters:  object(map[string]any{"date": map[string]any{"type": "string", "description": "Какой день, ГГГГ-ММ-ДД"}}, "date"),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "forget_person",
		Description: "Удалить карточку человека по id.",
		Parameters:  object(map[string]any{"person_id": map[string]any{"type": "integer"}}, "person_id"),
	}},
}

// memoryTools — инструменты памяти: с выключенной памятью ассистент её не видит и не трогает.
var memoryTools = []string{"list_memories", "forget", "list_people", "forget_person"}

// chatToolsFor — инструменты для этого пользователя: с выключенной памятью — без памяти.
func chatToolsFor(p model.Profile) []llm.Tool {
	out := slices.Concat(chatTools, personalTools)
	if !p.Memory {
		out = slices.DeleteFunc(out, func(t llm.Tool) bool { return slices.Contains(memoryTools, t.Function.Name) })
	}
	return out
}

// daysArg — дни недели из имён («mon») в номера (0 — воскресенье); ok=false — неизвестное имя.
func daysArg(raw any) ([]int, bool) {
	list, ok := raw.([]any)
	if !ok {
		return nil, raw == nil
	}
	out := []int{}
	for _, v := range list {
		name, _ := v.(string)
		i := slices.Index(weekdayKeys[:], name)
		if i < 0 {
			return nil, false
		}
		out = append(out, i)
	}
	return out, true
}

func (s *server) toolUpdateProfile(ctx context.Context, args map[string]any) (string, toolMeta) {
	var in profileInput
	for key, dst := range map[string]**int{"wake_up": &in.WakeUp, "bed_time": &in.BedTime, "work_start": &in.WorkStart, "work_end": &in.WorkEnd} {
		if _, ok := args[key]; !ok {
			continue
		}
		v, ok := parseHM(strArg(args, key))
		if !ok {
			return `{"error":"` + key + ` должен быть ЧЧ:ММ"}`, toolMeta{}
		}
		*dst = &v
	}
	// Отбой «00:00» — это полночь в конце дня.
	if in.BedTime != nil && *in.BedTime == 0 {
		v := dayMinutes
		in.BedTime = &v
	}
	if raw, ok := args["work_days"]; ok {
		days, ok := daysArg(raw)
		if !ok {
			return `{"error":"work_days — список mon…sun"}`, toolMeta{}
		}
		in.WorkDays = &days
	}
	if _, ok := args["focus"]; ok {
		f := model.Focus(strArg(args, "focus"))
		in.Focus = &f
	}
	for key, dst := range map[string]**int{"meeting_minutes": &in.MeetingMinutes, "buffer_minutes": &in.BufferMinutes} {
		if _, ok := args[key]; ok {
			v := intArg(args, key, 0)
			*dst = &v
		}
	}
	if raw, ok := args["protected"].([]any); ok {
		blocks := []model.ProtectedBlock{}
		for _, item := range raw {
			obj, _ := item.(map[string]any)
			start, okS := parseHM(strArg(obj, "start"))
			end, okE := parseHM(strArg(obj, "end"))
			if end == 0 {
				end = dayMinutes
			}
			days, okD := daysArg(obj["days"])
			if !okS || !okE || !okD {
				return `{"error":"блок: start и end — ЧЧ:ММ, days — mon…sun"}`, toolMeta{}
			}
			blocks = append(blocks, model.ProtectedBlock{Title: strArg(obj, "title"), Start: start, End: end, Days: days})
		}
		in.Protected = &blocks
	}
	for key, dst := range map[string]**string{"tone": &in.Tone, "address": &in.Address, "about": &in.About} {
		if _, ok := args[key]; ok {
			v := strArg(args, key)
			*dst = &v
		}
	}
	p, err := s.patchProfile(ctx, in)
	if err != nil {
		return toolErr(err, "не удалось изменить профиль"), toolMeta{}
	}
	return toolJSON(map[string]any{"ok": true, "profile": profileSummary("", p)}), toolMeta{detail: "профиль"}
}
