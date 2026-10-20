package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeAPI поднимает OpenAI-совместимый сервер. stream — ответ на стриминговый
// запрос (SSE-фреймы data:); когда nil, стриминг отвечает статусом streamStatus.
func fakeAPI(t *testing.T, streamStatus int, stream []string, plain string, gotBody *map[string]any) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if gotBody != nil {
			*gotBody = req
		}
		if req["stream"] == true {
			if stream == nil {
				w.WriteHeader(streamStatus)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			for _, frame := range stream {
				fmt.Fprintf(w, "data: %s\n\n", frame)
			}
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, plain)
	}))
	t.Cleanup(srv.Close)
	return New(Config{BaseURL: srv.URL, APIKey: "key", Model: "test"}, 5*time.Second)
}

func TestChatStream(t *testing.T) {
	frames := []string{
		`{"choices":[{"delta":{"content":"При"}}]}`,
		`{"choices":[{"delta":{"content":"вет!"}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"create_event","arguments":"{\"da"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"te\":\"2026-10-21\"}"}}]}}]}`,
	}
	var deltas []string
	c := fakeAPI(t, 0, frames, "", nil)
	msg, err := c.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}}, nil, func(d string) {
		deltas = append(deltas, d)
	})
	if err != nil {
		t.Fatal(err)
	}
	if msg.Role != "assistant" || msg.Content != "Привет!" {
		t.Fatalf("сообщение: %+v", msg)
	}
	if len(deltas) != 2 {
		t.Fatalf("дельты: %v", deltas)
	}
	if len(msg.ToolCalls) != 1 {
		t.Fatalf("вызовы: %+v", msg.ToolCalls)
	}
	call := msg.ToolCalls[0]
	if call.ID != "call-1" || call.Function.Name != "create_event" || call.Function.Arguments != `{"date":"2026-10-21"}` {
		t.Fatalf("вызов: %+v", call)
	}
	// Index — служебное поле, в запросы сериализоваться не должно.
	if raw, _ := json.Marshal(call); strings.Contains(string(raw), `"index"`) {
		t.Fatalf("index утёк в JSON: %s", raw)
	}
}

func TestChatFallsBackToPlain(t *testing.T) {
	// Стриминг не поддержан (400) — повторный обычный запрос отвечает целиком.
	plain := `{"choices":[{"message":{"role":"assistant","content":"Готово"}}]}`
	var lastReq map[string]any
	c := fakeAPI(t, http.StatusBadRequest, nil, plain, &lastReq)
	var deltas []string
	msg, err := c.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}}, nil, func(d string) {
		deltas = append(deltas, d)
	})
	if err != nil {
		t.Fatal(err)
	}
	if msg.Content != "Готово" || len(deltas) != 1 {
		t.Fatalf("ответ: %+v дельты %v", msg, deltas)
	}
	if lastReq["stream"] != false {
		t.Fatalf("повтор должен быть без stream: %v", lastReq)
	}
}

func TestChatErrors(t *testing.T) {
	c := fakeAPI(t, http.StatusInternalServerError, nil, `{"error":"boom"}`, nil)
	if _, err := c.Chat(context.Background(), []Message{{Role: "user", Content: "x"}}, nil, func(string) {}); err == nil {
		t.Fatal("ошибка API должна возвращаться")
	}
	if (&Client{}).Ready() {
		t.Fatal("клиент без ключа не готов")
	}
	if (*Client)(nil).Ready() {
		t.Fatal("nil-клиент не готов")
	}
}
