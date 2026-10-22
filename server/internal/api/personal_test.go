package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

// fakeChatLLMBodies — как fakeChatLLM, но запоминает тела запросов к модели (промпт, инструменты).
func fakeChatLLMBodies(t *testing.T, rounds [][]string) (*llm.Client, *[]string) {
	t.Helper()
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		frames := rounds[min(len(bodies), len(rounds)-1)]
		bodies = append(bodies, string(raw))
		w.Header().Set("Content-Type", "text/event-stream")
		for _, f := range frames {
			fmt.Fprintf(w, "data: %s\n\n", f)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)
	return llm.New(llm.Config{BaseURL: srv.URL, APIKey: "key", Model: "test"}, 2*time.Second), &bodies
}

// toolCall — кадр SSE, в котором модель зовёт инструмент name с аргументами args (JSON).
func toolCall(name, args string) string {
	esc := strings.ReplaceAll(args, `"`, `\"`)
	return `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","type":"function","function":{"name":"` + name + `","arguments":"` + esc + `"}}]}}]}`
}

func TestFreeSlots(t *testing.T) {
	p := model.DefaultProfile()
	p.BufferMinutes = 10
	p.Protected = []model.ProtectedBlock{{Title: "Обед", Start: 13 * 60, End: 14 * 60, Days: []int{1, 2, 3, 4, 5}}}
	events := []model.Event{
		{Start: 10 * 60, End: 11 * 60},
		{Start: 16 * 60, End: 17 * 60, Travel: 30},
		{Start: 0, End: 1440, AllDay: true},
	}
	str := func(spans []span) string {
		var parts []string
		for _, s := range spans {
			parts = append(parts, hm(s.Start)+"-"+hm(s.End))
		}
		return strings.Join(parts, " ")
	}
	cases := []struct {
		name    string
		weekday time.Weekday
		work    bool
		now     int
		dur     int
		want    string
	}{
		// Буфер 10 минут вокруг встречи, обед в будни, дорога 30 минут перед 16:00.
		{"будний день", time.Wednesday, false, -1, 30, "07:00-09:50 11:10-13:00 14:00-15:20 17:10-23:00"},
		{"рабочие часы", time.Wednesday, true, -1, 30, "09:00-09:50 11:10-13:00 14:00-15:20 17:10-18:00"},
		{"выходной: обед не действует", time.Saturday, false, -1, 60, "07:00-09:50 11:10-15:20 17:10-23:00"},
		{"сегодня: не раньше ближайших 15 минут, начало кратно 5", time.Wednesday, false, 12*60 + 1, 30, "12:15-13:00 14:00-15:20 17:10-23:00"},
		{"длинное окно", time.Wednesday, false, -1, 180, "17:10-23:00"},
	}
	for _, c := range cases {
		from, to, ok := dayBounds(p, c.weekday, c.work)
		if !ok {
			t.Fatalf("%s: выходной", c.name)
		}
		got := str(freeSlots(slotQuery{From: from, To: to, Weekday: c.weekday, Now: c.now, Duration: c.dur}, busySpans(p, c.weekday, events)))
		if got != c.want {
			t.Errorf("%s: %s, ждали %s", c.name, got, c.want)
		}
	}
	if _, _, ok := dayBounds(p, time.Sunday, true); ok {
		t.Error("в выходной рабочих часов нет")
	}
	// Отбой после полуночи — окна до конца суток.
	p.BedTime = 60
	if from, to, _ := dayBounds(p, time.Monday, false); from != 7*60 || to != dayMinutes {
		t.Errorf("отбой после полуночи: %d–%d", from, to)
	}
}

func TestDaysLabel(t *testing.T) {
	for days, want := range map[string]string{
		"1,2,3,4,5":     "пн–пт",
		"1,3,5":         "пн, ср, пт",
		"":              "каждый день",
		"0,6":           "сб, вс",
		"1,2,4,5,6":     "пн, вт, чт–сб",
		"0,1,2,3,4,5,6": "каждый день",
	} {
		var list []int
		for _, f := range strings.Split(days, ",") {
			var d int
			if _, err := fmt.Sscan(f, &d); err == nil {
				list = append(list, d)
			}
		}
		if got := daysLabel(list); got != want {
			t.Errorf("%q: %q, ждали %q", days, got, want)
		}
	}
}

func TestProfileAPI(t *testing.T) {
	h, tok := newAuthedServer(t)
	p := decode[model.Profile](t, doAs(t, h, tok, "GET", "/api/profile", ""))
	if p.WakeUp != 420 || !p.Memory || p.Onboarded || p.Proactive != 2 {
		t.Fatalf("по умолчанию: %+v", p)
	}
	rec := doAs(t, h, tok, "PATCH", "/api/profile",
		`{"workStart":600,"workDays":[5,1,1,3],"focus":"morning","protected":[{"title":" Обед ","start":780,"end":840,"days":[1,2]}],"onboarded":true}`)
	p = decode[model.Profile](t, rec)
	if rec.Code != 200 || p.WorkStart != 600 || fmt.Sprint(p.WorkDays) != "[1 3 5]" || p.Protected[0].Title != "Обед" || !p.Onboarded {
		t.Fatalf("патч: %d %+v", rec.Code, p)
	}
	for _, bad := range []string{
		`{"workStart":1200}`,
		`{"workDays":[7]}`,
		`{"focus":"night"}`,
		`{"meetingMinutes":5}`,
		`{"bufferMinutes":90}`,
		`{"protected":[{"title":"","start":600,"end":660}]}`,
		`{"protected":[{"title":"Спорт","start":700,"end":600}]}`,
		`{"tone":"rude"}`,
		`{"address":"ono"}`,
		`{"proactive":9}`,
		`{"muted":["spam"]}`,
		`{"about":"` + strings.Repeat("я", 501) + `"}`,
		`{"wakeUp":1500}`,
		`{"unknown":1}`,
	} {
		if rec := doAs(t, h, tok, "PATCH", "/api/profile", bad); rec.Code != 400 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	// Неудачный патч ничего не портит.
	if p := decode[model.Profile](t, doAs(t, h, tok, "GET", "/api/profile", "")); p.WorkStart != 600 {
		t.Fatalf("после ошибки: %+v", p)
	}
}

func TestPromptMemories(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	at := func(days int) time.Time { return now.AddDate(0, 0, -days) }
	mk := func(id int64, kind model.MemoryKind, text, date string, updated time.Time) model.Memory {
		return model.Memory{ID: id, Kind: kind, Text: text, Date: date, Source: model.SourceUser, Confirmed: true, UpdatedAt: updated}
	}
	all := []model.Memory{
		mk(1, model.MemoryPlace, "Бассейн на Садовой", "", at(1)),
		mk(2, model.MemoryOther, "Старый факт", "", at(30)),
		mk(3, model.MemoryDate, "День рождения мамы", "--03-14", at(40)),
		mk(4, model.MemoryRule, "Не ставить встречи до 11", "", at(50)),
		mk(5, model.MemoryAbout, "Зовут Миша", "", at(60)),
		{ID: 6, Kind: model.MemoryHabit, Text: "Спорт по вторникам", Source: model.SourceInferred},
		{ID: 7, Kind: model.MemoryRule, Text: "Отклонено", Source: model.SourceUser, Rejected: true},
	}
	got, total := promptMemories(all, now, memoryBudget)
	var ids []int64
	for _, m := range got {
		ids = append(ids, m.ID)
	}
	// Все подтверждённые, без поиска по словам: о себе, правила, ближайшие даты, затем свежие.
	if fmt.Sprint(ids) != "[5 4 3 1 2]" || total != 5 {
		t.Fatalf("порядок: %v из %d", ids, total)
	}
	// Бюджет режет хвост, но общее число остаётся — модель знает про остальные.
	if got, total := promptMemories(all, now, 90); len(got) != 2 || total != 5 {
		t.Fatalf("бюджет: %d из %d", len(got), total)
	}
}

func TestPeopleAPI(t *testing.T) {
	h, tok := newAuthedServer(t)
	p := decode[model.Person](t, doAs(t, h, tok, "POST", "/api/people",
		`{"name":" Глеб ","aliases":["Глебушка","Глебушка",""],"relation":"коллега","meetingMinutes":45,"birthday":"--03-14","username":"@Gleb"}`))
	if p.ID == 0 || p.Name != "Глеб" || len(p.Aliases) != 1 || p.Username != "gleb" {
		t.Fatalf("создание: %+v", p)
	}
	for _, bad := range []string{`{"name":""}`, `{"name":"x","meetingMinutes":5}`, `{"name":"x","birthday":"14 марта"}`, `{"name":"x","username":"ы"}`} {
		if rec := doAs(t, h, tok, "POST", "/api/people", bad); rec.Code != 400 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	upd := decode[model.Person](t, doAs(t, h, tok, "PATCH", fmt.Sprintf("/api/people/%d", p.ID), `{"name":"Глеб Петров","place":"Кофейня"}`))
	if upd.Place != "Кофейня" || upd.Relation != "" {
		t.Fatalf("замена целиком: %+v", upd)
	}
	other := register(t, h, "bob")
	if rec := doAs(t, h, other, "DELETE", fmt.Sprintf("/api/people/%d", p.ID), ""); rec.Code != 404 {
		t.Fatalf("чужая карточка: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "DELETE", fmt.Sprintf("/api/people/%d", p.ID), ""); rec.Code != 204 {
		t.Fatalf("удаление: %d", rec.Code)
	}
	if list := decode[[]model.Person](t, doAs(t, h, tok, "GET", "/api/people", "")); len(list) != 0 {
		t.Fatalf("после удаления: %+v", list)
	}
}

func TestMemoriesAPI(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st})
	tok := register(t, h, "alice")
	u, _ := st.UserByUsername(context.Background(), "alice")
	ctx := store.WithUser(context.Background(), u)
	m, _ := st.AddMemory(ctx, model.Memory{Kind: model.MemoryHabit, Text: "Спорт по вторникам", Source: model.SourceInferred, Key: "habit:sport"})
	gone, _ := st.AddMemory(ctx, model.Memory{Kind: model.MemoryHabit, Text: "Отказ", Source: model.SourceInferred, Rejected: true})
	list := decode[[]model.Memory](t, doAs(t, h, tok, "GET", "/api/memories", ""))
	if len(list) != 1 || list[0].ID != m.ID {
		t.Fatalf("отклонённые не показываем: %+v", list)
	}
	upd := decode[model.Memory](t, doAs(t, h, tok, "PATCH", fmt.Sprintf("/api/memories/%d", m.ID), `{"confirmed":true,"text":"Спорт — вт и чт"}`))
	if !upd.Confirmed || upd.Text != "Спорт — вт и чт" {
		t.Fatalf("подтверждение: %+v", upd)
	}
	added := decode[model.Memory](t, doAs(t, h, tok, "POST", "/api/memories", `{"kind":"date","text":" ДР мамы ","date":"--03-14"}`))
	if added.Text != "ДР мамы" || added.Source != model.SourceUser || !added.Confirmed {
		t.Fatalf("ручной факт: %+v", added)
	}
	if rec := doAs(t, h, tok, "POST", "/api/memories", `{"text":"x","date":"14.03"}`); rec.Code != 400 {
		t.Fatalf("неверная дата: %d", rec.Code)
	}
	for _, bad := range []string{`{"text":""}`, `{"kind":"secret"}`, `{"date":"завтра"}`} {
		if rec := doAs(t, h, tok, "PATCH", fmt.Sprintf("/api/memories/%d", m.ID), bad); rec.Code != 400 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	if rec := doAs(t, h, tok, "DELETE", fmt.Sprintf("/api/memories/%d", gone.ID), ""); rec.Code != 204 {
		t.Fatalf("удаление: %d", rec.Code)
	}
	if rec := doAs(t, h, tok, "DELETE", "/api/memories", ""); rec.Code != 204 || len(st.Memories(ctx)) != 0 {
		t.Fatalf("забыть всё: %d", rec.Code)
	}
}

func TestChatMemoryInPrompt(t *testing.T) {
	st, _ := store.Open("")
	llmc, bodies := fakeChatLLMBodies(t, [][]string{
		{toolCall("update_profile", `{"work_start":"10:00","work_days":["mon","tue","wed","thu"],"protected":[{"title":"Обед","start":"14:00","end":"15:00"}]}`)},
		{textFrame("Готово.")},
		{textFrame("Ок.")},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	ctx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	_, _ = st.AddMemory(ctx, model.Memory{Kind: model.MemoryRule, Text: "По пятницам после 16:00 не работает", Source: model.SourceUser, Confirmed: true})
	_, _ = st.SavePerson(ctx, model.Person{Name: "Глеб", Relation: "коллега", Place: "Кофейня на Ленина", MeetingMinutes: 45})

	doAs(t, h, tok, "POST", "/api/chat", `{"text":"я теперь работаю с 10, пн–чт, обед в 14"}`)
	first := (*bodies)[0]
	// Основная модель в память не пишет: инструментов записи у неё нет.
	for _, name := range []string{`"name":"remember"`, `"name":"save_person"`} {
		if strings.Contains(first, name) {
			t.Errorf("у модели есть %s", name)
		}
	}
	p := decode[model.Profile](t, doAs(t, h, tok, "GET", "/api/profile", ""))
	if p.WorkStart != 600 || len(p.WorkDays) != 4 || len(p.Protected) != 1 || p.Protected[0].Start != 840 {
		t.Fatalf("профиль: %+v", p)
	}
	// Факты и люди — в промпте целиком, даже если о них не спрашивали.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"что у меня завтра"}`)
	last := (*bodies)[len(*bodies)-1]
	for _, want := range []string{"По пятницам после 16:00 не работает", "Кофейня на Ленина", "Обед 14:00–15:00", "Имя пользователя в аккаунте не задано"} {
		if !strings.Contains(last, want) {
			t.Errorf("в промпте нет %q", want)
		}
	}
	if st.Memories(ctx)[0].UsedAt.IsZero() {
		t.Error("использованный факт не отмечен")
	}
}

func TestChatMemoryOff(t *testing.T) {
	st, _ := store.Open("")
	llmc, bodies := fakeChatLLMBodies(t, [][]string{{textFrame("Ок.")}})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	doAs(t, h, tok, "PATCH", "/api/profile", `{"memory":false}`)
	ctx := store.WithUser(context.Background(), mustUser(t, st, "alice"))
	_, _ = st.AddMemory(ctx, model.Memory{Kind: model.MemoryRule, Text: "Секретный факт", Source: model.SourceUser, Confirmed: true})
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"я плаваю по средам"}`)
	first := (*bodies)[0]
	if strings.Contains(first, `"name":"list_memories"`) || strings.Contains(first, "Секретный факт") {
		t.Fatal("с выключенной памятью нет ни инструментов памяти, ни фактов в промпте")
	}
	if len(st.Memories(ctx)) != 1 {
		t.Fatal("с выключенной памятью ничего не сохраняется")
	}
}

func TestMemoryExtraction(t *testing.T) {
	st, _ := store.Open("")
	chatLLM, _ := fakeChatLLMBodies(t, [][]string{{textFrame("Приятно познакомиться!")}})
	memLLM, memBodies := fakeChatLLMBodies(t, [][]string{
		{toolCall("save_memory_ops", `{"ops":[{"op":"add","kind":"about","text":"Зовут Миша"},{"op":"add","kind":"about","text":"зовут миша"},{"op":"delete","id":999}]}`)},
		{toolCall("save_memory_ops", `{"ops":[{"op":"update","id":1,"kind":"about","text":"Зовут Михаил"}]}`)},
		{toolCall("save_memory_ops", `{"ops":[{"op":"delete","id":1}]}`)},
	})
	h := New(Options{Store: st, LLM: chatLLM, MemoryLLM: memLLM})
	tok := register(t, h, "misha")
	ctx := store.WithUser(context.Background(), mustUser(t, st, "misha"))

	rec := doAs(t, h, tok, "POST", "/api/chat", `{"text":"Меня зовут Миша"}`)
	if !strings.Contains(rec.Body.String(), `"type":"memory"`) || !strings.Contains(rec.Body.String(), "Зовут Миша") {
		t.Fatalf("в чате нет «Запомнил»: %s", rec.Body)
	}
	mem := st.Memories(ctx)
	if len(mem) != 1 || mem[0].Text != "Зовут Миша" || mem[0].Kind != model.MemoryAbout || !mem[0].Confirmed {
		t.Fatalf("память: %+v", mem)
	}
	// Разбор видит только слова пользователя и известные факты.
	if !strings.Contains((*memBodies)[0], "Меня зовут Миша") || !strings.Contains((*memBodies)[0], "save_memory_ops") {
		t.Fatalf("запрос разбора: %.400s", (*memBodies)[0])
	}

	// Обновление и удаление — по id известного факта.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"Вообще я Михаил"}`)
	if mem = st.Memories(ctx); len(mem) != 1 || mem[0].Text != "Зовут Михаил" {
		t.Fatalf("после обновления: %+v", mem)
	}
	if !strings.Contains((*memBodies)[1], "[1] about: Зовут Миша") {
		t.Fatalf("разбор не видит известное: %.400s", (*memBodies)[1])
	}
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"Забудь моё имя"}`)
	if mem = st.Memories(ctx); len(mem) != 0 {
		t.Fatalf("после удаления: %+v", mem)
	}

	// Память выключена — разбора нет.
	before := len(*memBodies)
	doAs(t, h, tok, "PATCH", "/api/profile", `{"memory":false}`)
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"Я живу в Казани"}`)
	if len(*memBodies) != before {
		t.Fatal("разбор памяти при выключенной памяти")
	}
}

func TestMemoryOpsGuard(t *testing.T) {
	st, _ := store.Open("")
	s := &server{store: st}
	u, _ := st.CreateUser(context.Background(), "a", "a", "h")
	b, _ := st.CreateUser(context.Background(), "b", "b", "h")
	ctx := store.WithUser(context.Background(), u)
	bctx := store.WithUser(context.Background(), b)
	other, _ := st.AddMemory(bctx, model.Memory{Kind: model.MemoryAbout, Text: "Зовут Боб", Source: model.SourceUser, Confirmed: true})
	ops := []memoryOp{
		{Op: "add", Kind: "rule", Text: "Не работает по пятницам"},
		{Op: "delete", ID: other.ID},                               // чужой факт
		{Op: "update", ID: other.ID, Text: "Зовут Ева"},            // чужой факт
		{Op: "add", Kind: "secret", Text: "x"},                     // неизвестный вид
		{Op: "add", Kind: "date", Text: "ДР", Date: "завтра"},      // плохая дата
		{Op: "add", Kind: "about", Text: strings.Repeat("я", 400)}, // слишком длинно
	}
	got := s.applyMemoryOps(ctx, st.Memories(ctx), ops)
	if len(got) != 1 || got[0].Action != "added" {
		t.Fatalf("изменения: %+v", got)
	}
	if bm := st.Memories(bctx); len(bm) != 1 || bm[0].Text != "Зовут Боб" {
		t.Fatalf("задет чужой факт: %+v", bm)
	}
	// Больше maxExtractOps за раз не применяется.
	many := make([]memoryOp, maxExtractOps+3)
	for i := range many {
		many[i] = memoryOp{Op: "add", Kind: "other", Text: fmt.Sprint("Факт ", i)}
	}
	if got := s.applyMemoryOps(ctx, st.Memories(ctx), many); len(got) != maxExtractOps {
		t.Fatalf("предел изменений: %d", len(got))
	}
}

func TestPeopleExtraction(t *testing.T) {
	st, _ := store.Open("")
	chatLLM, _ := fakeChatLLMBodies(t, [][]string{{textFrame("Понял.")}, {textFrame("Хорошо.")}})
	memLLM, memBodies := fakeChatLLMBodies(t, [][]string{
		{toolCall("save_memory_ops", `{"ops":[],"people":[{"op":"add","name":"Глеб","relation":"коллега","place":"Кофейня на Ленина","meeting_minutes":45},{"op":"add","name":"глеб"},{"op":"add","name":"Вася","meeting_minutes":5}]}`)},
		{toolCall("save_memory_ops", `{"ops":[],"people":[{"op":"update","id":1,"meeting_minutes":60},{"op":"update","id":999,"name":"Кто-то"}]}`)},
	})
	h := New(Options{Store: st, LLM: chatLLM, MemoryLLM: memLLM})
	tok := register(t, h, "alice")

	body := doAs(t, h, tok, "POST", "/api/chat", `{"text":"Глеб — мой коллега, видимся в кофейне на Ленина минут на 45"}`).Body.String()
	if !strings.Contains(body, "Глеб — коллега") {
		t.Fatalf("в чате нет пометки о карточке: %s", body)
	}
	people := decode[[]model.Person](t, doAs(t, h, tok, "GET", "/api/people", ""))
	// Дубль по имени и карточка с неверной длительностью отброшены той же проверкой, что в приложении.
	if len(people) != 1 || people[0].Place != "Кофейня на Ленина" || people[0].MeetingMinutes != 45 {
		t.Fatalf("карточки: %+v", people)
	}
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"с Глебом теперь видимся на час"}`)
	if !strings.Contains((*memBodies)[1], "[1] Глеб — коллега") {
		t.Fatalf("разбор не видит карточку: %.600s", (*memBodies)[1])
	}
	people = decode[[]model.Person](t, doAs(t, h, tok, "GET", "/api/people", ""))
	if len(people) != 1 || people[0].MeetingMinutes != 60 || people[0].Place != "Кофейня на Ленина" {
		t.Fatalf("после обновления: %+v", people)
	}
}
