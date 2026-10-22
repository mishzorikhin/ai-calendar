package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func deleteCall(id string) string {
	return `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"d","type":"function","function":{"name":"delete_event","arguments":"{\"event_id\":\"` + id + `\"}"}}]}}]}`
}

func textFrame(text string) string {
	return `{"choices":[{"delta":{"content":"` + text + `"}}]}`
}

func TestChatDeleteNeedsConfirmation(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st})
	tok := register(t, h, "alice")
	ev := decode[model.Event](t, doAs(t, h, tok, "POST", "/api/events",
		`{"date":"2026-10-21","title":"Созвон","start":600,"end":660}`))
	exists := func() bool {
		return strings.Contains(doAs(t, h, tok, "GET", "/api/events?date=2026-10-21", "").Body.String(), ev.ID)
	}

	// Первый ход: модель дважды зовёт удаление (как сделала бы по «инъекции» в тексте) — событие живо.
	llmc, _ := fakeChatLLM(t, [][]string{
		{deleteCall(ev.ID)},
		{deleteCall(ev.ID)},
		{textFrame("Удалить «Созвон»?")},
		{deleteCall(ev.ID)},
		{textFrame("Удалил.")},
	})
	h = New(Options{Store: st, LLM: llmc})
	body := doAs(t, h, tok, "POST", "/api/chat", `{"text":"убери созвон"}`).Body.String()
	if !exists() {
		t.Fatal("событие удалено без подтверждения пользователя")
	}
	if !strings.Contains(body, "нужно подтверждение") {
		t.Fatalf("в потоке нет запроса подтверждения: %s", body)
	}

	// Следующий ход — пользователь согласился: повторный вызов удаляет.
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"да"}`)
	if exists() {
		t.Fatal("после согласия событие должно удалиться")
	}
}

func TestChatStreamErrorAfterText(t *testing.T) {
	st, _ := store.Open("")
	llmc, _ := fakeChatLLM(t, [][]string{
		{textFrame("Начинаю"), `{"error":{"message":"обрыв"}}`},
	})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	body := doAs(t, h, tok, "POST", "/api/chat", `{"text":"привет"}`).Body.String()
	if !strings.Contains(body, `"type":"error"`) || !strings.Contains(body, "Начинаю") {
		t.Fatalf("обрыв должен прийти событием error: %s", body)
	}
	msgs := decode[[]model.Message](t, doAs(t, h, tok, "GET", "/api/messages", ""))
	if last := msgs[len(msgs)-1]; last.Role != model.RoleAI || last.Text != "Начинаю" {
		t.Fatalf("начало ответа не сохранено: %+v", msgs)
	}
}

func TestChatRoundsSeparatedAndLastRoundWithoutTools(t *testing.T) {
	st, _ := store.Open("")
	list := `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"l","type":"function","function":{"name":"list_tasks","arguments":""}}]}}]}`
	// Модель всё время просит инструмент: последний заход идёт без tools, текст разделён.
	llmc, calls := fakeChatLLM(t, [][]string{{textFrame("Смотрю."), list}})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	doAs(t, h, tok, "POST", "/api/chat", `{"text":"что у меня"}`)
	if *calls != chatMaxRounds {
		t.Fatalf("заходов: %d", *calls)
	}
	msgs := decode[[]model.Message](t, doAs(t, h, tok, "GET", "/api/messages", ""))
	if last := msgs[len(msgs)-1]; !strings.Contains(last.Text, "Смотрю.\n\nСмотрю.") {
		t.Fatalf("тексты заходов склеены: %q", last.Text)
	}
}

func TestRunToolEmptyArgs(t *testing.T) {
	st, _ := store.Open("")
	s := &server{store: st, cal: newCalendars(CalendarOptions{}), confirms: newConfirmations()}
	u, _ := st.CreateUser(context.Background(), "alice", "Alice", "h")
	ctx := store.WithUser(context.Background(), u)
	out, _ := s.runTool(ctx, chatTurn{}, llm.ToolCall{Function: llm.FunctionCall{Name: "list_tasks", Arguments: ""}})
	if !strings.Contains(out, `"tasks"`) {
		t.Fatalf("пустые аргументы: %s", out)
	}
	if out, _ := s.runTool(ctx, chatTurn{}, llm.ToolCall{Function: llm.FunctionCall{Name: "list_tasks", Arguments: "[1]"}}); !strings.Contains(out, "error") {
		t.Fatalf("не объект должен быть ошибкой: %s", out)
	}
	long := strings.Repeat("я", maxTitle+1)
	task, _ := st.CreateTask(ctx, model.Task{Title: "x", Kind: model.TaskKindTask})
	out, _ = s.runTool(ctx, chatTurn{}, llm.ToolCall{Function: llm.FunctionCall{Name: "update_task",
		Arguments: `{"task_id":"` + task.ID + `","title":"` + long + `"}`}})
	if !strings.Contains(out, "error") {
		t.Fatalf("длинное название должно отклоняться: %s", out)
	}
}

func TestFreeSlotsSkipPastToday(t *testing.T) {
	st, _ := store.Open("")
	s := &server{store: st, cal: newCalendars(CalendarOptions{})}
	u, _ := st.CreateUser(context.Background(), "alice", "Alice", "h")
	ctx := store.WithUser(context.Background(), u)
	now := time.Date(2026, 10, 21, 13, 7, 0, 0, time.UTC)
	out, _ := s.toolFreeSlots(ctx, chatTurn{now: now}, map[string]any{"date": "2026-10-21"})
	if out != `{"bounds":"07:00–23:00","free":[{"end":"23:00","start":"13:15"}]}` {
		t.Fatalf("сегодня окна с текущего времени: %s", out)
	}
}

func TestChatPromptUsesUserTimeZone(t *testing.T) {
	now := time.Date(2026, 10, 21, 23, 30, 0, 0, time.UTC).In(time.FixedZone("MSK", 3*3600))
	p := chatRules(now)
	if !strings.Contains(p, "22.10.2026") || !strings.Contains(p, "02:30") {
		t.Fatalf("дата и время в поясе пользователя: %s", p[:120])
	}
}

func TestChatRateLimit(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st})
	tok := register(t, h, "alice")
	var last int
	for range 12 {
		last = doAs(t, h, tok, "POST", "/api/chat", `{"text":"привет"}`).Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("12 сообщений подряд: %d", last)
	}
}

func TestChatDeleteNeedsConsentNotAnyReply(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st})
	tok := register(t, h, "alice")
	ev := decode[model.Event](t, doAs(t, h, tok, "POST", "/api/events",
		`{"date":"2026-10-21","title":"Созвон","start":600,"end":660}`))
	// Модель «по инъекции» зовёт удаление в каждом ходе, что бы ни писал пользователь.
	llmc, _ := fakeChatLLM(t, [][]string{
		{deleteCall(ev.ID)}, {textFrame("Удалить?")},
		{deleteCall(ev.ID)}, {textFrame("Удалить?")},
		{deleteCall(ev.ID)}, {textFrame("Не удаляю.")},
	})
	h = New(Options{Store: st, LLM: llmc})
	for _, text := range []string{"что у меня завтра", "а послезавтра?", "нет, не удаляй"} {
		doAs(t, h, tok, "POST", "/api/chat", `{"text":"`+text+`"}`)
		events := doAs(t, h, tok, "GET", "/api/events?date=2026-10-21", "").Body.String()
		if !strings.Contains(events, ev.ID) {
			t.Fatalf("удалено без согласия после «%s»", text)
		}
	}
}

func TestIsConsent(t *testing.T) {
	for text, want := range map[string]bool{
		"да":                  true,
		"Да, удаляй!":         true,
		"ок":                  true,
		"конечно удали":       true,
		"нет":                 false,
		"не удаляй":           false,
		"да нет, оставь":      false,
		"что у меня завтра?":  false,
		"удали встречу и всё": true,
	} {
		if got := isConsent(text); got != want {
			t.Errorf("%q: %v, ждали %v", text, got, want)
		}
	}
}

func TestChatFinishesAfterClientLeft(t *testing.T) {
	st, _ := store.Open("")
	llmc, _ := fakeChatLLM(t, [][]string{{textFrame("Полный ответ.")}})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")
	// Клиент закрыл чат сразу после отправки: соединение (контекст запроса) уже отменено.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequestWithContext(ctx, "POST", "/api/chat", strings.NewReader(`{"text":"привет"}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(httptest.NewRecorder(), req)
	msgs := decode[[]model.Message](t, doAs(t, h, tok, "GET", "/api/messages", ""))
	if last := msgs[len(msgs)-1]; last.Role != model.RoleAI || last.Text != "Полный ответ." {
		t.Fatalf("ответ не доделан после ухода клиента: %+v", msgs)
	}
}
