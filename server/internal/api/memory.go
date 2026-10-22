// Память ассистента: факты о пользователе из разговоров («по пятницам не работаю»,
// «мама — день рождения 14 марта») и догадки по его поведению. Факты попадают в промпт целиком
// (promptMemories), пользователь видит и правит их в шторке «Что ассистент обо мне знает».
package api

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// memoryBudget — сколько символов фактов кладём в промпт (≈ 2–3 тысячи токенов): обычно это
// вся память, а если нет — модель видит самое важное и может дочитать остальное list_memories.
const memoryBudget = 8000

// peopleBudget — то же для карточек людей.
const peopleBudget = 4000

// validMemoryDate — «ГГГГ-ММ-ДД» (один раз) или «--ММ-ДД» (каждый год); пусто — без даты.
func validMemoryDate(v string) bool {
	if v == "" {
		return true
	}
	if rest, ok := strings.CutPrefix(v, "--"); ok {
		_, err := time.Parse("2006-01-02", "2000-"+rest) // 2000 — високосный: 29 февраля допустимо
		return err == nil && len(rest) == 5
	}
	_, err := time.Parse(time.DateOnly, v)
	return err == nil
}

func validateMemoryText(text string) error {
	if n := utf8.RuneCountInString(text); n == 0 || n > model.MaxMemoryRunes {
		return badRequest("Факт обязателен и не длиннее %d символов", model.MaxMemoryRunes)
	}
	return nil
}

// visibleMemories — факты для списка в приложении: без отклонённых догадок.
func visibleMemories(all []model.Memory) []model.Memory {
	out := make([]model.Memory, 0, len(all))
	for _, m := range all {
		if !m.Rejected {
			out = append(out, m)
		}
	}
	return out
}

func (s *server) listMemories(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, visibleMemories(s.store.Memories(r.Context())))
	return nil
}

type memoryInput struct {
	Kind model.MemoryKind `json:"kind"`
	Text string           `json:"text"`
	Date string           `json:"date"`
}

// createMemory — факт, который пользователь добавил сам в шторке памяти.
func (s *server) createMemory(w http.ResponseWriter, r *http.Request) error {
	var in memoryInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Kind == "" {
		in.Kind = model.MemoryOther
	}
	if !in.Kind.Valid() {
		return badRequest("Неизвестный вид факта: %q", in.Kind)
	}
	in.Text, in.Date = strings.TrimSpace(in.Text), strings.TrimSpace(in.Date)
	if err := validateMemoryText(in.Text); err != nil {
		return err
	}
	if !validMemoryDate(in.Date) {
		return badRequest("Дата — ГГГГ-ММ-ДД или --ММ-ДД (каждый год)")
	}
	m, err := s.store.AddMemory(r.Context(), model.Memory{Kind: in.Kind, Text: in.Text, Date: in.Date, Source: model.SourceUser, Confirmed: true})
	if errors.Is(err, store.ErrLimit) {
		return badRequest("Память заполнена: не больше %d фактов — удалите старые", model.MaxMemories)
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, m)
	return nil
}

type memoryPatchInput struct {
	Kind      *model.MemoryKind `json:"kind"`
	Text      *string           `json:"text"`
	Date      *string           `json:"date"`
	Confirmed *bool             `json:"confirmed"`
	Rejected  *bool             `json:"rejected"`
}

func memoryID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, notFound("Факт")
	}
	return id, nil
}

func (s *server) updateMemory(w http.ResponseWriter, r *http.Request) error {
	id, err := memoryID(r)
	if err != nil {
		return err
	}
	var in memoryPatchInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.Kind != nil && !in.Kind.Valid() {
		return badRequest("Неизвестный вид факта: %q", *in.Kind)
	}
	if in.Text != nil {
		*in.Text = strings.TrimSpace(*in.Text)
		if err := validateMemoryText(*in.Text); err != nil {
			return err
		}
	}
	if in.Date != nil && !validMemoryDate(*in.Date) {
		return badRequest("Дата — ГГГГ-ММ-ДД или --ММ-ДД (каждый год)")
	}
	m, err := s.store.UpdateMemory(r.Context(), id, model.MemoryPatch{
		Kind: in.Kind, Text: in.Text, Date: in.Date, Confirmed: in.Confirmed, Rejected: in.Rejected,
	})
	if errors.Is(err, store.ErrNotFound) {
		return notFound("Факт")
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, m)
	return nil
}

func (s *server) deleteMemory(w http.ResponseWriter, r *http.Request) error {
	id, err := memoryID(r)
	if err != nil {
		return err
	}
	if err := s.store.DeleteMemory(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Факт")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *server) deleteAllMemories(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.DeleteMemories(r.Context()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- Отбор фактов в промпт ---------------------------------------------------

// foldText — нижний регистр, «ё» → «е», знаки препинания — пробелы, пробелы схлопнуты.
func foldText(s string) string {
	var b strings.Builder
	space := true
	for _, r := range strings.ToLower(s) {
		if r == 'ё' {
			r = 'е'
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			space = false
		} else if !space {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

// upcomingDate — дата факта наступает в ближайшие days дней (ежегодные — в этом или следующем году).
func upcomingDate(date string, now time.Time, days int) (time.Time, bool) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var when time.Time
	if rest, ok := strings.CutPrefix(date, "--"); ok {
		d, err := time.Parse("2006-01-02", fmt.Sprintf("%d-%s", today.Year(), rest))
		if err != nil {
			return time.Time{}, false
		}
		if d.Before(today) {
			d = d.AddDate(1, 0, 0)
		}
		when = d
	} else {
		d, err := time.Parse(time.DateOnly, date)
		if err != nil {
			return time.Time{}, false
		}
		when = d
	}
	diff := int(when.Sub(today).Hours() / 24)
	return when, diff >= 0 && diff <= days
}

// promptMemories — факты для промпта: все подтверждённые, пока влезают в budget символов.
// Порядок — по важности для ответа: сведения о себе, правила и предпочтения, ближайшие даты,
// затем свежие. Возвращает ещё и общее число фактов, чтобы модель знала про остальные.
func promptMemories(all []model.Memory, now time.Time, budget int) ([]model.Memory, int) {
	var usable []model.Memory
	for _, m := range all {
		if !m.Rejected && (m.Source == model.SourceUser || m.Confirmed) {
			usable = append(usable, m)
		}
	}
	rank := func(m model.Memory) int {
		switch {
		case m.Kind == model.MemoryAbout:
			return 0
		case m.Kind == model.MemoryRule || m.Kind == model.MemoryPreference:
			return 1
		case m.Date != "":
			if _, soon := upcomingDate(m.Date, now, 14); soon {
				return 2
			}
		}
		return 3
	}
	slices.SortStableFunc(usable, func(a, b model.Memory) int {
		return cmp.Or(cmp.Compare(rank(a), rank(b)), b.UpdatedAt.Compare(a.UpdatedAt))
	})
	var out []model.Memory
	used := 0
	for _, m := range usable {
		n := utf8.RuneCountInString(m.Text) + 24
		if used+n > budget {
			break
		}
		used += n
		out = append(out, m)
	}
	return out, len(usable)
}

var memoryKindLabels = map[model.MemoryKind]string{
	model.MemoryAbout:      "о себе",
	model.MemoryPerson:     "человек",
	model.MemoryPlace:      "место",
	model.MemoryHabit:      "привычка",
	model.MemoryPreference: "предпочтение",
	model.MemoryRule:       "правило",
	model.MemoryDate:       "дата",
	model.MemoryOther:      "факт",
}

// memoryLines — факты для промпта: «- [12] (правило) Не ставить встречи до 11».
func memoryLines(list []model.Memory) string {
	var b strings.Builder
	for _, m := range list {
		fmt.Fprintf(&b, "- [%d] (%s) %s", m.ID, memoryKindLabels[m.Kind], m.Text)
		if m.Date != "" {
			fmt.Fprintf(&b, " — дата %s", m.Date)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// --- Инструменты ассистента ---------------------------------------------------

func (s *server) toolForget(ctx context.Context, args map[string]any) (string, toolMeta) {
	id := int64(intArg(args, "memory_id", 0))
	list := s.store.Memories(ctx)
	i := slices.IndexFunc(list, func(m model.Memory) bool { return m.ID == id && !m.Rejected })
	if i < 0 {
		return `{"error":"факт не найден — посмотри list_memories"}`, toolMeta{}
	}
	if err := s.store.DeleteMemory(ctx, id); err != nil {
		return `{"error":"факт не найден"}`, toolMeta{}
	}
	return `{"ok":true}`, toolMeta{detail: list[i].Text}
}

func (s *server) toolListMemories(ctx context.Context) (string, toolMeta) {
	type item struct {
		ID   int64  `json:"id"`
		Kind string `json:"kind"`
		Text string `json:"text"`
		Date string `json:"date,omitempty"`
	}
	out := []item{}
	for _, m := range s.store.Memories(ctx) {
		if !m.Rejected && (m.Source == model.SourceUser || m.Confirmed) {
			out = append(out, item{m.ID, string(m.Kind), m.Text, m.Date})
		}
	}
	return toolJSON(map[string]any{"memories": out}), toolMeta{}
}
