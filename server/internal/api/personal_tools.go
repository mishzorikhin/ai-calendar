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

var evidenceParam = map[string]any{"type": "string",
	"description": "Дословный кусок реплики пользователя, где он это сказал (без него ничего не сохранится)"}

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
		Name:        "remember",
		Description: "Запомнить устойчивый факт о пользователе: привычку, правило, предпочтение, важную дату, место. Только то, что он сказал сам.",
		Parameters: object(map[string]any{
			"kind":     map[string]any{"type": "string", "enum": []string{"person", "place", "habit", "preference", "rule", "date", "other"}},
			"text":     map[string]any{"type": "string", "description": "Факт коротко, от третьего лица: «По пятницам после 16:00 не работает»"},
			"date":     map[string]any{"type": "string", "description": "Для дат: ГГГГ-ММ-ДД или --ММ-ДД (каждый год)"},
			"evidence": evidenceParam,
		}, "kind", "text", "evidence"),
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
		Description: "Карточки людей пользователя: кто это, где обычно встречаются, длительность, день рождения, сколько встреч за 90 дней.",
		Parameters:  object(map[string]any{}),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "save_person",
		Description: "Создать или дополнить карточку человека (person_id — дополнить существующую). Только со слов пользователя.",
		Parameters: object(map[string]any{
			"person_id":       map[string]any{"type": "integer", "description": "id существующей карточки; нет — новая"},
			"name":            map[string]any{"type": "string"},
			"aliases":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Другие имена: «Глебушка», «Г. Петров»"},
			"relation":        map[string]any{"type": "string", "description": "Кто это: «коллега», «мама»"},
			"place":           map[string]any{"type": "string", "description": "Где обычно встречаются"},
			"meeting_minutes": map[string]any{"type": "integer", "minimum": 15, "maximum": 480},
			"birthday":        map[string]any{"type": "string", "description": "ГГГГ-ММ-ДД или --ММ-ДД"},
			"notes":           map[string]any{"type": "string"},
			"username":        map[string]any{"type": "string", "description": "Логин на сервере, если человек там есть (list_users)"},
			"evidence":        evidenceParam,
		}, "evidence"),
	}},
	{Type: "function", Function: llm.FunctionSpec{
		Name:        "forget_person",
		Description: "Удалить карточку человека по id.",
		Parameters:  object(map[string]any{"person_id": map[string]any{"type": "integer"}}, "person_id"),
	}},
}

// memoryWriteTools — инструменты, которые сохраняют новое в память: без памяти их не предлагаем.
var memoryWriteTools = []string{"remember", "save_person"}

// chatToolsFor — инструменты для этого пользователя: с выключенной памятью — без записи в неё.
func chatToolsFor(p model.Profile) []llm.Tool {
	out := slices.Concat(chatTools, personalTools)
	if !p.Memory {
		out = slices.DeleteFunc(out, func(t llm.Tool) bool { return slices.Contains(memoryWriteTools, t.Function.Name) })
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
