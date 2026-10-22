// Карточки людей: кто это, где обычно встречаемся, сколько длится встреча, день рождения.
// Люди, упомянутые в реплике, сами попадают в промпт — «встреча с Глебом» получает место и длительность.
package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

type personInput struct {
	Name           string   `json:"name"`
	Aliases        []string `json:"aliases"`
	Relation       string   `json:"relation"`
	Place          string   `json:"place"`
	MeetingMinutes int      `json:"meetingMinutes"`
	Birthday       string   `json:"birthday"`
	Notes          string   `json:"notes"`
	Username       string   `json:"username"`
}

// person проверяет поля и собирает карточку (без id).
func (in personInput) person() (model.Person, error) {
	p := model.Person{
		Name: strings.TrimSpace(in.Name), Relation: strings.TrimSpace(in.Relation), Place: strings.TrimSpace(in.Place),
		MeetingMinutes: in.MeetingMinutes, Birthday: strings.TrimSpace(in.Birthday), Notes: strings.TrimSpace(in.Notes),
		Username: strings.ToLower(strings.TrimPrefix(strings.TrimSpace(in.Username), "@")),
	}
	if n := utf8.RuneCountInString(p.Name); n == 0 || n > model.MaxPersonField {
		return p, badRequest("Имя обязательно и не длиннее %d символов", model.MaxPersonField)
	}
	for _, a := range in.Aliases {
		if a = strings.TrimSpace(a); a != "" && !slices.Contains(p.Aliases, a) {
			p.Aliases = append(p.Aliases, a)
		}
	}
	if len(p.Aliases) > model.MaxPersonAliases {
		return p, badRequest("Не больше %d других имён", model.MaxPersonAliases)
	}
	for _, f := range append([]string{p.Relation, p.Place}, p.Aliases...) {
		if utf8.RuneCountInString(f) > model.MaxPersonField {
			return p, badRequest("Поля карточки — не длиннее %d символов", model.MaxPersonField)
		}
	}
	if p.MeetingMinutes != 0 && (p.MeetingMinutes < 15 || p.MeetingMinutes > model.MaxMeetingMinutes) {
		return p, badRequest("Длительность встречи — от 15 минут до 8 часов")
	}
	if !validMemoryDate(p.Birthday) {
		return p, badRequest("День рождения — ГГГГ-ММ-ДД или --ММ-ДД")
	}
	if utf8.RuneCountInString(p.Notes) > model.MaxPersonNotes {
		return p, badRequest("Заметка — не длиннее %d символов", model.MaxPersonNotes)
	}
	if p.Username != "" && !usernameRe.MatchString(p.Username) {
		return p, badRequest("Логин — латиница, 3–24 знака")
	}
	return p, nil
}

func (s *server) listPeople(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, nonNil(s.store.People(r.Context())))
	return nil
}

func (s *server) createPerson(w http.ResponseWriter, r *http.Request) error {
	var in personInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	p, err := in.person()
	if err != nil {
		return err
	}
	saved, err := s.store.SavePerson(r.Context(), p)
	if errors.Is(err, store.ErrLimit) {
		return badRequest("Не больше %d человек", model.MaxPeople)
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, saved)
	return nil
}

func personID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, notFound("Человек")
	}
	return id, nil
}

// updatePerson заменяет карточку целиком (форма в приложении присылает все поля).
func (s *server) updatePerson(w http.ResponseWriter, r *http.Request) error {
	id, err := personID(r)
	if err != nil {
		return err
	}
	var in personInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	p, err := in.person()
	if err != nil {
		return err
	}
	p.ID = id
	saved, err := s.store.SavePerson(r.Context(), p)
	if errors.Is(err, store.ErrNotFound) {
		return notFound("Человек")
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, saved)
	return nil
}

func (s *server) deletePerson(w http.ResponseWriter, r *http.Request) error {
	id, err := personID(r)
	if err != nil {
		return err
	}
	if err := s.store.DeletePerson(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("Человек")
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- Упоминания ----------------------------------------------------------------

// promptPeople — карточки для промпта: недавно изменённые первыми, пока влезают в budget символов.
// Возвращает ещё и общее число карточек.
func promptPeople(all []model.Person, budget int) ([]model.Person, int) {
	list := slices.Clone(all)
	slices.SortStableFunc(list, func(a, b model.Person) int { return b.UpdatedAt.Compare(a.UpdatedAt) })
	var out []model.Person
	used := 0
	for _, p := range list {
		n := utf8.RuneCountInString(personLine(p))
		if used+n > budget {
			break
		}
		used += n
		out = append(out, p)
	}
	return out, len(list)
}

// personLine — карточка для промпта: «- [3] Глеб (коллега): обычно — «Кофейня», 45 мин; ДР 14.03».
func personLine(p model.Person) string {
	var b strings.Builder
	fmt.Fprintf(&b, "- [%d] %s", p.ID, p.Name)
	if len(p.Aliases) > 0 {
		fmt.Fprintf(&b, " (он же: %s)", strings.Join(p.Aliases, ", "))
	}
	if p.Relation != "" {
		fmt.Fprintf(&b, " — %s", p.Relation)
	}
	var facts []string
	if p.Place != "" {
		facts = append(facts, "обычно встречаетесь: "+p.Place)
	}
	if p.MeetingMinutes > 0 {
		facts = append(facts, fmt.Sprintf("встреча обычно %d мин", p.MeetingMinutes))
	}
	if p.Birthday != "" {
		facts = append(facts, "день рождения "+p.Birthday)
	}
	if p.Username != "" {
		facts = append(facts, "логин @"+p.Username)
	}
	if p.Notes != "" {
		facts = append(facts, "заметка: "+p.Notes)
	}
	if len(facts) > 0 {
		b.WriteString(". " + strings.Join(facts, "; "))
	}
	b.WriteByte('\n')
	return b.String()
}

// --- Инструменты ассистента ---------------------------------------------------

func (s *server) toolListPeople(ctx context.Context) (string, toolMeta) {
	type item struct {
		ID             int64    `json:"id"`
		Name           string   `json:"name"`
		Aliases        []string `json:"aliases,omitempty"`
		Relation       string   `json:"relation,omitempty"`
		Place          string   `json:"place,omitempty"`
		MeetingMinutes int      `json:"meeting_minutes,omitempty"`
		Birthday       string   `json:"birthday,omitempty"`
		Notes          string   `json:"notes,omitempty"`
		Username       string   `json:"username,omitempty"`
	}
	people := s.store.People(ctx)
	out := make([]item, 0, len(people))
	for _, p := range people {
		out = append(out, item{p.ID, p.Name, p.Aliases, p.Relation, p.Place, p.MeetingMinutes, p.Birthday, p.Notes, p.Username})
	}
	return toolJSON(map[string]any{"people": out}), toolMeta{}
}

func (s *server) toolForgetPerson(ctx context.Context, args map[string]any) (string, toolMeta) {
	id := int64(intArg(args, "person_id", 0))
	people := s.store.People(ctx)
	i := slices.IndexFunc(people, func(p model.Person) bool { return p.ID == id })
	if i < 0 {
		return `{"error":"человек не найден — посмотри list_people"}`, toolMeta{}
	}
	if err := s.store.DeletePerson(ctx, id); err != nil {
		return `{"error":"человек не найден"}`, toolMeta{}
	}
	return `{"ok":true}`, toolMeta{detail: people[i].Name}
}
