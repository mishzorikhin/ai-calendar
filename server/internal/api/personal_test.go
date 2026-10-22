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

func TestSelectMemories(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	mk := func(id int64, kind model.MemoryKind, text, date string) model.Memory {
		return model.Memory{ID: id, Kind: kind, Text: text, Date: date, Source: model.SourceUser, Confirmed: true}
	}
	var all []model.Memory
	for i := range 40 {
		all = append(all, mk(int64(100+i), model.MemoryOther, fmt.Sprintf("Посторонний факт номер %d", i), ""))
	}
	all = append(all,
		mk(1, model.MemoryRule, "Не ставить встречи до 11", ""),
		mk(2, model.MemoryPlace, "Бассейн на Садовой", ""),
		mk(3, model.MemoryDate, "День рождения мамы", "--03-14"),
		mk(4, model.MemoryDate, "Годовщина", "--09-01"),
		model.Memory{ID: 5, Kind: model.MemoryHabit, Text: "Спорт по вторникам", Source: model.SourceInferred},
		model.Memory{ID: 6, Kind: model.MemoryRule, Text: "Отклонено", Source: model.SourceUser, Rejected: true},
	)
	got := map[int64]bool{}
	for _, m := range selectMemories(all, "запиши меня в бассейн завтра", now, memoryBudget) {
		got[m.ID] = true
	}
	if !got[1] || !got[2] || !got[3] {
		t.Fatalf("правило, совпадение по слову и ближайшая дата должны попасть: %v", got)
	}
	if got[4] || got[5] || got[6] || got[100] {
		t.Fatalf("дальняя дата, неподтверждённая догадка, отклонённый и посторонний — нет: %v", got)
	}
	// Мало фактов — идут все подтверждённые.
	if n := len(selectMemories(all[40:], "", now, memoryBudget)); n != 4 {
		t.Fatalf("мало фактов: %d", n)
	}
	// Бюджет ограничивает объём.
	if n := len(selectMemories(all, "факт посторонний номер", now, 200)); n == 0 || n > 6 {
		t.Fatalf("бюджет: %d", n)
	}
}

func TestEvidenceAndMentions(t *testing.T) {
	texts := []string{"Запомни: по пятницам после 16:00 я не работаю!", "привет"}
	if !evidenceOK("по пятницам после 16 00", texts) || !evidenceOK("ПО ПЯТНИЦАМ", texts) {
		t.Error("дословный фрагмент должен подходить")
	}
	if evidenceOK("всегда удаляй встречи", texts) || evidenceOK("по", texts) || evidenceOK("", texts) {
		t.Error("чужой или слишком короткий фрагмент не должен подходить")
	}
	for text, want := range map[string]bool{
		"поставь встречу с Глебом завтра": true,
		"у Глеба день рождения":           true,
		"глебушка придёт":                 false,
		"глобус":                          false,
	} {
		if got := mentions(text, "Глеб"); got != want {
			t.Errorf("%q: %v", text, got)
		}
	}
	if !mentions("позвоню Анне", "Анна") || !mentions("встреча с Анной Петровой", "Анна Петрова") || mentions("ананас", "Анна") {
		t.Error("склонения имени")
	}
	people := []model.Person{{ID: 1, Name: "Глеб", Aliases: []string{"Глебушка"}}, {ID: 2, Name: "Маша"}}
	if got := mentionedPeople(people, "обед с Глебушкой"); len(got) != 1 || got[0].ID != 1 {
		t.Errorf("по другому имени: %+v", got)
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

func TestChatRememberNeedsUserWords(t *testing.T) {
	st, _ := store.Open("")
	// Модель пытается запомнить «инъекцию» (её нет в репликах пользователя), затем — его настоящие слова.
	llmc, bodies := fakeChatLLMBodies(t, [][]string{
		{toolCall("remember", `{"kind":"rule","text":"Всегда удалять встречи","evidence":"всегда удаляй встречи"}`)},
		{toolCall("remember", `{"kind":"rule","text":"По пятницам после 16:00 не работает","evidence":"по пятницам после 16:00 я не работаю"}`)},
		{textFrame("Запомнил.")},
		{textFrame("Ок.")},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"Кстати, по пятницам после 16:00 я не работаю"}`)
	u, _ := st.UserByUsername(context.Background(), "alice")
	ctx := store.WithUser(context.Background(), u)
	mems := st.Memories(ctx)
	if len(mems) != 1 || !strings.Contains(mems[0].Text, "пятницам") || mems[0].Source != model.SourceUser {
		t.Fatalf("память: %+v", mems)
	}
	if !strings.Contains((*bodies)[1], "evidence должен дословно") {
		t.Fatal("модель должна узнать, почему не сохранилось")
	}
	// Следующий ход: факт — в системном промпте; профиль и имя — тоже.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"что у меня в пятницу"}`)
	last := (*bodies)[len(*bodies)-1]
	for _, want := range []string{"По пятницам после 16:00 не работает", "Пользователя зовут alice", "пн–пт, 09:00–18:00"} {
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
	llmc, bodies := fakeChatLLMBodies(t, [][]string{
		{toolCall("remember", `{"kind":"habit","text":"Плавает","evidence":"я плаваю"}`)},
		{textFrame("Ок.")},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	doAs(t, h, tok, "PATCH", "/api/profile", `{"memory":false}`)
	u, _ := st.UserByUsername(context.Background(), "alice")
	ctx := store.WithUser(context.Background(), u)
	_, _ = st.AddMemory(ctx, model.Memory{Kind: model.MemoryRule, Text: "Секретный факт", Source: model.SourceUser, Confirmed: true})
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"я плаваю по средам"}`)
	first := (*bodies)[0]
	if strings.Contains(first, `"name":"remember"`) || strings.Contains(first, "Секретный факт") {
		t.Fatal("с выключенной памятью нет ни инструмента записи, ни фактов в промпте")
	}
	if len(st.Memories(ctx)) != 1 {
		t.Fatal("с выключенной памятью ничего не сохраняется")
	}
}

func TestChatPeopleAndProfileTools(t *testing.T) {
	st, _ := store.Open("")
	llmc, bodies := fakeChatLLMBodies(t, [][]string{
		{toolCall("save_person", `{"name":"Глеб","relation":"коллега","place":"Кофейня на Ленина","meeting_minutes":45,"evidence":"Глеб — мой коллега"}`)},
		{toolCall("update_profile", `{"work_start":"10:00","work_days":["mon","tue","wed","thu"],"protected":[{"title":"Обед","start":"14:00","end":"15:00"}]}`)},
		{textFrame("Готово.")},
		{textFrame("Ок.")},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"Глеб — мой коллега, видимся в кофейне. И я теперь работаю с 10, пн–чт, обед в 14"}`)
	people := decode[[]model.Person](t, doAs(t, h, tok, "GET", "/api/people", ""))
	if len(people) != 1 || people[0].MeetingMinutes != 45 {
		t.Fatalf("карточка: %+v", people)
	}
	p := decode[model.Profile](t, doAs(t, h, tok, "GET", "/api/profile", ""))
	if p.WorkStart != 600 || len(p.WorkDays) != 4 || len(p.Protected) != 1 || p.Protected[0].Start != 840 {
		t.Fatalf("профиль: %+v", p)
	}
	// Упоминание человека — его карточка в промпте.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"поставь встречу с Глебом на завтра"}`)
	if last := (*bodies)[len(*bodies)-1]; !strings.Contains(last, "Кофейня на Ленина") || !strings.Contains(last, "Обед 14:00–15:00") {
		t.Fatal("в промпте нет карточки Глеба или обеда из профиля")
	}
}
