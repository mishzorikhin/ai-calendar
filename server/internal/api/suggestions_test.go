package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Вторник, 20 октября 2026, 9:00 по Москве.
var sgNow = time.Date(2026, 10, 20, 9, 0, 0, 0, time.FixedZone("MSK", 3*3600))

func sgInput() suggestInput {
	p := model.DefaultProfile()
	p.Proactive = 3
	return suggestInput{Now: sgNow, Profile: p, Notify: model.DefaultNotifySettings, Seen: map[string]bool{}}
}

func ev(date string, start, end int, title string) model.Event {
	return model.Event{ID: title + date, Date: date, Title: title, Start: start, End: end}
}

func kinds(list []model.Suggestion) string {
	var out []string
	for _, s := range list {
		out = append(out, string(s.Kind))
	}
	return strings.Join(out, " ")
}

func TestSuggestLunch(t *testing.T) {
	in := sgInput()
	in.Events = []model.Event{
		ev("2026-10-20", 600, 720, "Планёрка"), ev("2026-10-20", 720, 780, "Созвон"),
		ev("2026-10-20", 810, 900, "Ревью"), ev("2026-10-20", 900, 960, "Звонок"),
	}
	got := planSuggestions(in)
	if kinds(got) != "lunch" {
		t.Fatalf("виды: %q", kinds(got))
	}
	a := got[0].Action
	if a.Type != model.ActionEvent || a.Start != 780 || a.End != 810 || a.Badge != model.BadgeFood || got[0].Key != "lunch:2026-10-20" {
		t.Fatalf("обед: %+v", got[0])
	}
	if !got[0].ExpiresAt.Equal(time.Date(2026, 10, 20, 13, 0, 0, 0, sgNow.Location())) {
		t.Errorf("истекает: %v", got[0].ExpiresAt)
	}
	// Обед уже стоит — не предлагаем; как и после полудня, и если окон достаточно.
	withLunch := in
	withLunch.Events = append(append([]model.Event{}, in.Events...), ev("2026-10-20", 780, 810, "Обед с Глебом"))
	afternoon := in
	afternoon.Now = sgNow.Add(4 * time.Hour)
	roomy := in
	roomy.Events = in.Events[:1]
	for name, c := range map[string]suggestInput{"обед есть": withLunch, "после полудня": afternoon, "свободно": roomy} {
		if got := planSuggestions(c); strings.Contains(kinds(got), "lunch") {
			t.Errorf("%s: %q", name, kinds(got))
		}
	}
}

func TestSuggestStaleTask(t *testing.T) {
	in := sgInput()
	in.Profile.Focus = model.FocusMorning
	in.Tasks = []model.Task{
		{ID: "t-new", Title: "Новая", Kind: model.TaskKindTask, CreatedAt: sgNow.Add(-24 * time.Hour)},
		{ID: "t-old", Title: "Отчёт", Kind: model.TaskKindTask, CreatedAt: sgNow.Add(-10 * 24 * time.Hour)},
		{ID: "t-due", Title: "Налоги", Kind: model.TaskKindTask, Due: "2026-10-01"},
		{ID: "t-done", Title: "Готово", Kind: model.TaskKindTask, Due: "2026-09-01", Done: true},
		{ID: "t-shared", Title: "Чужая", Kind: model.TaskKindTask, Due: "2026-09-02", Role: model.TaskRoleMember},
	}
	// Завтра утро занято до 10:00 — час ставим в 10:00.
	in.Events = []model.Event{ev("2026-10-21", 420, 600, "Зал")}
	got := planSuggestions(in)
	var stale *model.Suggestion
	for i := range got {
		if got[i].Kind == model.SuggestStaleTask {
			stale = &got[i]
		}
	}
	if stale == nil || stale.Key != "stale_task:t-due" || stale.Action.Date != "2026-10-21" || stale.Action.Start != 600 ||
		stale.Action.End != 660 || stale.Title != "«Налоги» просрочена" {
		t.Fatalf("давняя задача: %+v", got)
	}
	// Про эту уже спрашивали — следующая по давности.
	in.Seen["stale_task:t-due"] = true
	got = planSuggestions(in)
	if len(got) == 0 || got[0].Key != "stale_task:t-old" || !strings.Contains(got[0].Title, "больше недели") {
		t.Fatalf("следующая: %+v", got)
	}
}

func TestSuggestPlanTasksAndDates(t *testing.T) {
	in := sgInput()
	in.Tasks = []model.Task{
		{ID: "a", Title: "Купить", Kind: model.TaskKindTask, Due: "2026-10-20"},
		{ID: "b", Title: "Позвонить", Kind: model.TaskKindTask},
		{ID: "c", Title: "Потом", Kind: model.TaskKindTask, Due: "2026-11-20"},
	}
	in.People = []model.Person{{ID: 7, Name: "Глеб", Birthday: "--10-24"}, {ID: 8, Name: "Аня", Birthday: "--12-01"}}
	in.Memories = []model.Memory{
		{ID: 3, Kind: model.MemoryDate, Text: "Годовщина свадьбы", Date: "--10-22", Confirmed: true},
		{ID: 4, Kind: model.MemoryDate, Text: "Догадка", Date: "--10-22", Confirmed: false},
	}
	got := planSuggestions(in)
	if kinds(got) != "date date plan_tasks" {
		t.Fatalf("виды: %q %+v", kinds(got), got)
	}
	if got[0].Action.Title != "Подарок: Глеб" || got[0].Action.Due != "2026-10-23" || !strings.HasPrefix(got[0].Body, "В субботу, 24 октября") {
		t.Errorf("день рождения: %+v", got[0])
	}
	if got[1].Key != "date:m3:2026-10-22" || !strings.HasPrefix(got[1].Body, "Послезавтра: Годовщина") {
		t.Errorf("дата из памяти: %+v", got[1])
	}
	if got[2].Action.Type != model.ActionChat || !strings.HasPrefix(got[2].Body, "2 задачи без времени") {
		t.Errorf("разложить задачи: %+v", got[2])
	}
	// Выходной — задачи не раскладываем (а задача со сроком во вторник уже просрочена);
	// память выключена — дат из неё нет; день рождения сегодня — уже не «скоро».
	in.Now = sgNow.AddDate(0, 0, 4)
	in.Profile.Memory = false
	if got := planSuggestions(in); kinds(got) != "stale_task" {
		t.Errorf("суббота: %q", kinds(got))
	}
}

func TestSuggestOverload(t *testing.T) {
	in := sgInput()
	// Четыре прошлые недели — по 4 часа встреч, эта — 7 часов.
	for w := 1; w <= 4; w++ {
		in.Events = append(in.Events, ev(addDays("2026-10-19", -7*w), 600, 840, fmt.Sprint("w", w)))
	}
	in.Events = append(in.Events, ev("2026-10-19", 540, 960, "Марафон"))
	got := planSuggestions(in)
	if kinds(got) != "overload" || got[0].Key != "overload:2026-10-19" || !strings.Contains(got[0].Body, "7 ч, а обычно около 4 ч") {
		t.Fatalf("перегрузка: %+v", got)
	}
	in.Now = sgNow.AddDate(0, 0, 2) // четверг — уже поздно
	if got := planSuggestions(in); len(got) != 0 {
		t.Errorf("четверг: %+v", got)
	}
}

func TestSuggestLimitsAndQuiet(t *testing.T) {
	in := sgInput()
	in.People = []model.Person{{ID: 1, Name: "А", Birthday: "--10-21"}, {ID: 2, Name: "Б", Birthday: "--10-22"}, {ID: 3, Name: "В", Birthday: "--10-23"}}
	in.Profile.Proactive = 2
	if got := planSuggestions(in); len(got) != 2 {
		t.Fatalf("лимит в день: %d", len(got))
	}
	in.Today = 1
	if got := planSuggestions(in); len(got) != 1 {
		t.Fatalf("с учётом сегодняшних: %d", len(got))
	}
	in.Today = 0
	in.Profile.Muted = []string{string(model.SuggestDate)}
	if got := planSuggestions(in); len(got) != 0 {
		t.Fatalf("вид выключен: %+v", got)
	}
	in.Profile.Muted = nil
	in.Notify.QuietFrom, in.Notify.QuietTo = 8*60, 10*60
	if got := planSuggestions(in); len(got) != 0 {
		t.Fatalf("тихие часы: %+v", got)
	}
	in.Notify = model.DefaultNotifySettings
	in.Now = time.Date(2026, 10, 20, 7, 10, 0, 0, sgNow.Location()) // только проснулся
	if got := planSuggestions(in); len(got) != 0 {
		t.Fatalf("сразу после подъёма: %+v", got)
	}
}

func TestSuggestionsAPI(t *testing.T) {
	s, h, _ := newPushServer(t)
	token := register(t, h, "alice")
	dev := newFakeDevice(t)
	doAs(t, h, token, "POST", "/api/push/subscriptions", dev.subscription("/a"))
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.FixedZone("MSK", 3*3600))
	s.cal.now = func() time.Time { return now }
	for i, title := range []string{"Планёрка", "Созвон", "Ревью", "Звонок"} {
		start := []int{600, 720, 810, 900}[i]
		doAs(t, h, token, "POST", "/api/events", fmt.Sprintf(`{"date":"2026-10-20","title":%q,"start":%d,"end":%d}`, title, start, start+[]int{120, 60, 90, 60}[i]))
	}
	doAs(t, h, token, "POST", "/api/people", `{"name":"Глеб","birthday":"--10-24"}`)

	s.remindAll(context.Background(), now)
	msgs := dev.messages()
	if len(msgs) != 2 || msgs[0].Kind != model.PushSuggest || msgs[0].SuggestionID == 0 || msgs[0].SuggestionAction != model.ActionTask {
		t.Fatalf("push: %+v", msgs)
	}
	// Повторный проход (и раньше, чем через suggestEvery, и позже) не дублирует.
	s.remindAll(context.Background(), now.Add(time.Minute))
	now = now.Add(time.Hour)
	s.remindAll(context.Background(), now)
	if len(dev.messages()) != 2 {
		t.Fatalf("повтор: %+v", dev.messages())
	}

	list := decode[[]model.Suggestion](t, doAs(t, h, token, "GET", "/api/suggestions", ""))
	if len(list) != 2 || list[0].Kind != model.SuggestDate || list[1].Kind != model.SuggestLunch {
		t.Fatalf("список: %+v", list)
	}
	// «Да» на обед — событие создано; второй раз — 409.
	list[0], list[1] = list[1], list[0]
	rec := doAs(t, h, token, "POST", fmt.Sprintf("/api/suggestions/%d/accept", list[0].ID), "")
	res := decode[acceptResult](t, rec)
	if rec.Code != 200 || res.Event == nil || res.Event.Title != "Обед" || res.Event.Start != 780 || res.Suggestion.Status != model.SuggestionAccepted {
		t.Fatalf("принять: %d %s", rec.Code, rec.Body)
	}
	if rec := doAs(t, h, token, "POST", fmt.Sprintf("/api/suggestions/%d/accept", list[0].ID), ""); rec.Code != http.StatusConflict {
		t.Fatalf("повторно: %d", rec.Code)
	}
	// «Нет, не предлагать такое» — вид попадает в muted.
	rec = doAs(t, h, token, "POST", fmt.Sprintf("/api/suggestions/%d/dismiss", list[1].ID), `{"mute":true}`)
	if rec.Code != 200 || decode[model.Suggestion](t, rec).Status != model.SuggestionDismissed {
		t.Fatalf("отказ: %d %s", rec.Code, rec.Body)
	}
	if p := decode[model.Profile](t, doAs(t, h, token, "GET", "/api/profile", "")); fmt.Sprint(p.Muted) != "[date]" {
		t.Fatalf("muted: %+v", p.Muted)
	}
	if list := decode[[]model.Suggestion](t, doAs(t, h, token, "GET", "/api/suggestions", "")); len(list) != 0 {
		t.Fatalf("после ответов: %+v", list)
	}
	// Чужое и несуществующее — 404.
	bob := register(t, h, "bob")
	if rec := doAs(t, h, bob, "POST", fmt.Sprintf("/api/suggestions/%d/dismiss", list0ID(list)), ""); rec.Code != http.StatusNotFound {
		t.Fatalf("чужое: %d", rec.Code)
	}
}

func list0ID(list []model.Suggestion) int64 {
	if len(list) > 0 {
		return list[0].ID
	}
	return 1
}
