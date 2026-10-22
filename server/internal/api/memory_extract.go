// Автоматическая память: после каждого ответа ассистента отдельный короткий запрос к модели
// разбирает реплику пользователя и решает, что из неё запомнить, обновить или забыть —
// как «память из разговоров» у ChatGPT и Claude или Mem0. Он же ведёт карточки людей.
// Основная модель в память не пишет: у неё другая задача, и записи не зависят от того,
// вспомнила ли она про инструмент.
//
// В разбор попадают только слова пользователя (и прошлая реплика ассистента — как контекст
// вопроса): названия событий и тексты из чужих календарей сюда не доходят, поэтому команда,
// спрятанная в событии, в память не попадёт.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

const (
	// extractTimeout — сколько ждать разбора памяти после ответа.
	extractTimeout = 25 * time.Second
	// maxExtractOps — больше изменений памяти за одну реплику не применяем.
	maxExtractOps = 5
)

// memoryChange — что изменилось в памяти за ход: показывается в чате («Запомнил: …»).
type memoryChange struct {
	// Action — added, updated или deleted.
	Action string `json:"action"`
	Text   string `json:"text"`
}

var memoryKindNames = []string{"about", "person", "place", "habit", "preference", "rule", "date", "other"}

var memoryOpsTool = llm.Tool{Type: "function", Function: llm.FunctionSpec{
	Name:        "save_memory_ops",
	Description: "Изменения памяти о пользователе по его последней реплике. Нечего менять — пустой список.",
	Parameters: object(map[string]any{
		"ops": map[string]any{"type": "array", "maxItems": maxExtractOps, "items": object(map[string]any{
			"op":   map[string]any{"type": "string", "enum": []string{"add", "update", "delete"}},
			"id":   map[string]any{"type": "integer", "description": "id факта из списка — для update и delete"},
			"kind": map[string]any{"type": "string", "enum": memoryKindNames},
			"text": map[string]any{"type": "string", "description": "Факт коротко, от третьего лица: «Зовут Миша», «По пятницам не работает»"},
			"date": map[string]any{"type": "string", "description": "Для дат: ГГГГ-ММ-ДД или --ММ-ДД (каждый год)"},
		}, "op")},
		"people": map[string]any{"type": "array", "maxItems": maxExtractOps, "items": object(map[string]any{
			"op":              map[string]any{"type": "string", "enum": []string{"add", "update", "delete"}},
			"id":              map[string]any{"type": "integer", "description": "id карточки из списка — для update и delete"},
			"name":            map[string]any{"type": "string", "description": "Как пользователь называет человека: «Глеб», «мама»"},
			"aliases":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Другие имена того же человека"},
			"relation":        map[string]any{"type": "string", "description": "Кто это пользователю: «коллега», «сестра»"},
			"place":           map[string]any{"type": "string", "description": "Где обычно встречаются"},
			"meeting_minutes": map[string]any{"type": "integer", "description": "Сколько обычно длится встреча"},
			"birthday":        map[string]any{"type": "string", "description": "ГГГГ-ММ-ДД или --ММ-ДД"},
			"notes":           map[string]any{"type": "string", "description": "Прочее важное о человеке"},
		}, "op")},
	}, "ops", "people"),
}}

const extractRules = `Ты ведёшь долговременную память личного ассистента-календаря о пользователе. По его последней реплике реши, что запомнить, и вызови save_memory_ops.

Запоминай устойчивое — то, что пригодится через неделю и через месяц:
- о себе (kind about): как зовут, где живёт, кем работает, семья, питомцы;
- правила и предпочтения (rule, preference): «по пятницам не работаю», «встречи не раньше 10», «отвечай коротко»;
- привычки (habit), важные даты (date, с полем date), места (place);
- людей из окружения — не фактами, а карточками в people: кто это, где обычно встречаются, сколько длится встреча, день рождения. Для известного человека — update с id его карточки и только изменёнными полями.

Не запоминай: разовые планы и встречи (для них есть календарь), вопросы, просьбы что-то сделать, догадки о пользователе, то, чего он прямо не сказал о себе.

Сверяйся со списком уже известного:
- уже есть то же самое — ничего не делай;
- пользователь сообщил новое вместо старого («теперь работаю с 10», «переехал в Казань») — update с id старого факта;
- пользователь просит забыть или говорит, что это неправда, — delete с id.

Пиши факты коротко, по-русски, от третьего лица, без лишних слов: «Зовут Миша», «Живёт в Казани». Реплика ассистента дана только как контекст вопроса («Как тебя зовут?» → «Миша» значит «Зовут Миша»); сама она источником фактов не является. Если запоминать нечего — вызови save_memory_ops с пустыми ops и people.`

// extractMemories разбирает реплику пользователя и применяет изменения памяти. Возвращает,
// что изменилось. Сбой модели — просто ничего не запоминаем: ответ пользователю уже дан.
func (s *server) extractMemories(ctx context.Context, userText, assistantBefore string) []memoryChange {
	if !s.memLLM.Ready() || strings.TrimSpace(userText) == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, extractTimeout)
	defer cancel()
	known := s.store.Memories(ctx)
	var list strings.Builder
	for _, m := range known {
		if !m.Rejected {
			fmt.Fprintf(&list, "[%d] %s: %s\n", m.ID, m.Kind, m.Text)
		}
	}
	if list.Len() == 0 {
		list.WriteString("(пока ничего)\n")
	}
	people := s.store.People(ctx)
	var cards strings.Builder
	for _, p := range people {
		cards.WriteString(personLine(p))
	}
	if cards.Len() == 0 {
		cards.WriteString("(пока никого)\n")
	}
	input := "Уже известно о пользователе:\n" + list.String() + "\nКарточки людей:\n" + cards.String()
	if a := strings.TrimSpace(assistantBefore); a != "" {
		input += "\nПрошлая реплика ассистента (только контекст):\n" + clip(a, 600) + "\n"
	}
	input += "\nНовая реплика пользователя:\n" + userText
	msg, err := s.memLLM.Chat(ctx, []llm.Message{
		{Role: "system", Content: extractRules},
		{Role: "user", Content: input},
	}, []llm.Tool{memoryOpsTool}, func(string) {})
	if err != nil {
		slog.Warn("память: разбор реплики", "err", err)
		return nil
	}
	for _, call := range msg.ToolCalls {
		if call.Function.Name != memoryOpsTool.Function.Name {
			continue
		}
		var args struct {
			Ops    []memoryOp `json:"ops"`
			People []personOp `json:"people"`
		}
		if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
			return nil
		}
		return append(s.applyMemoryOps(ctx, known, args.Ops), s.applyPersonOps(ctx, people, args.People)...)
	}
	return nil
}

type memoryOp struct {
	Op   string `json:"op"`
	ID   int64  `json:"id"`
	Kind string `json:"kind"`
	Text string `json:"text"`
	Date string `json:"date"`
}

// applyMemoryOps проверяет и применяет изменения: только к своим неотклонённым фактам, без
// дублей и не больше maxExtractOps. Неверные изменения молча пропускаются.
func (s *server) applyMemoryOps(ctx context.Context, known []model.Memory, ops []memoryOp) []memoryChange {
	byID := map[int64]model.Memory{}
	for _, m := range known {
		if !m.Rejected {
			byID[m.ID] = m
		}
	}
	has := func(text string) bool {
		for _, m := range byID {
			if foldText(m.Text) == foldText(text) {
				return true
			}
		}
		return false
	}
	var out []memoryChange
	for i, op := range ops {
		if i >= maxExtractOps {
			break
		}
		text := strings.TrimSpace(op.Text)
		kind := model.MemoryKind(op.Kind)
		if kind == "" {
			kind = model.MemoryOther
		}
		switch op.Op {
		case "add":
			if !kind.Valid() || validateMemoryText(text) != nil || !validMemoryDate(op.Date) || has(text) {
				continue
			}
			m, err := s.store.AddMemory(ctx, model.Memory{Kind: kind, Text: text, Date: op.Date, Source: model.SourceUser, Confirmed: true})
			if err != nil {
				return out // предел памяти — остальное не влезет
			}
			byID[m.ID] = m
			out = append(out, memoryChange{Action: "added", Text: text})
		case "update":
			old, ok := byID[op.ID]
			if !ok || validateMemoryText(text) != nil || !validMemoryDate(op.Date) || foldText(old.Text) == foldText(text) {
				continue
			}
			patch := model.MemoryPatch{Text: &text}
			if kind.Valid() && op.Kind != "" {
				patch.Kind = &kind
			}
			if op.Date != "" {
				patch.Date = &op.Date
			}
			// Сказанное пользователем подтверждает и догадку, если правили её.
			yes := true
			patch.Confirmed = &yes
			m, err := s.store.UpdateMemory(ctx, op.ID, patch)
			if err != nil {
				continue
			}
			byID[m.ID] = m
			out = append(out, memoryChange{Action: "updated", Text: text})
		case "delete":
			old, ok := byID[op.ID]
			if !ok || s.store.DeleteMemory(ctx, op.ID) != nil {
				continue
			}
			delete(byID, op.ID)
			out = append(out, memoryChange{Action: "deleted", Text: old.Text})
		}
	}
	return out
}

type personOp struct {
	Op             string    `json:"op"`
	ID             int64     `json:"id"`
	Name           *string   `json:"name"`
	Aliases        *[]string `json:"aliases"`
	Relation       *string   `json:"relation"`
	Place          *string   `json:"place"`
	MeetingMinutes *int      `json:"meeting_minutes"`
	Birthday       *string   `json:"birthday"`
	Notes          *string   `json:"notes"`
}

// applyPersonOps применяет изменения карточек людей с той же проверкой полей, что и в
// приложении (personInput). У update меняются только переданные поля; логин модель не ставит —
// его привязывает сам пользователь. Неверные изменения молча пропускаются.
func (s *server) applyPersonOps(ctx context.Context, known []model.Person, ops []personOp) []memoryChange {
	byID := map[int64]model.Person{}
	for _, p := range known {
		byID[p.ID] = p
	}
	var out []memoryChange
	for i, op := range ops {
		if i >= maxExtractOps {
			break
		}
		switch op.Op {
		case "add", "update":
			var cur model.Person
			if op.Op == "update" {
				var ok bool
				if cur, ok = byID[op.ID]; !ok {
					continue
				}
			} else if op.Name == nil || slices.ContainsFunc(known, func(p model.Person) bool { return foldText(p.Name) == foldText(*op.Name) }) {
				continue // без имени или такой человек уже есть — модели стоило прислать update
			}
			in := personInput{Name: cur.Name, Aliases: cur.Aliases, Relation: cur.Relation, Place: cur.Place,
				MeetingMinutes: cur.MeetingMinutes, Birthday: cur.Birthday, Notes: cur.Notes, Username: cur.Username}
			for dst, src := range map[*string]*string{&in.Name: op.Name, &in.Relation: op.Relation, &in.Place: op.Place,
				&in.Birthday: op.Birthday, &in.Notes: op.Notes} {
				if src != nil {
					*dst = *src
				}
			}
			if op.Aliases != nil {
				in.Aliases = *op.Aliases
			}
			if op.MeetingMinutes != nil {
				in.MeetingMinutes = *op.MeetingMinutes
			}
			p, err := in.person()
			if err != nil {
				continue
			}
			p.ID = cur.ID
			if op.Op == "update" && personLine(p) == personLine(cur) {
				continue
			}
			saved, err := s.store.SavePerson(ctx, p)
			if err != nil {
				continue
			}
			byID[saved.ID] = saved
			known = append(known, saved)
			action := "added"
			if op.Op == "update" {
				action = "updated"
			}
			out = append(out, memoryChange{Action: action, Text: personSummary(saved)})
		case "delete":
			old, ok := byID[op.ID]
			if !ok || s.store.DeletePerson(ctx, op.ID) != nil {
				continue
			}
			delete(byID, op.ID)
			out = append(out, memoryChange{Action: "deleted", Text: personSummary(old)})
		}
	}
	return out
}

// personSummary — человек для пометки в чате: «Глеб — коллега».
func personSummary(p model.Person) string {
	if p.Relation != "" {
		return p.Name + " — " + p.Relation
	}
	return p.Name
}
