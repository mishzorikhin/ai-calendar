package api

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/llm"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func imageJSON(text string, size int) string {
	img := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(make([]byte, size))
	return `{"text":"` + text + `","image":"` + img + `"}`
}

func TestChatImage(t *testing.T) {
	st, _ := store.Open("")
	llmc, bodies := fakeChatLLMBodies(t, [][]string{{textFrame("Вижу афишу: концерт в субботу в 19:00.")}})
	h := New(Options{Store: st, LLM: llmc})
	tok := register(t, h, "alice")

	rec := doAs(t, h, tok, "POST", "/api/chat", imageJSON("", 600<<10))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "концерт") {
		t.Fatalf("чат с картинкой: %d %s", rec.Code, rec.Body)
	}
	body := (*bodies)[0]
	if !strings.Contains(body, `"type":"image_url"`) || !strings.Contains(body, "Посмотри на картинку.") {
		t.Fatalf("картинка не ушла модели: %.300s", body)
	}
	// В истории — пометка, а не картинка.
	msgs := decode[[]model.Message](t, doAs(t, h, tok, "GET", "/api/messages", ""))
	var mine []string
	for _, m := range msgs {
		if m.Role == model.RoleUser {
			mine = append(mine, m.Text)
		}
	}
	if len(mine) != 1 || mine[0] != imageMark {
		t.Fatalf("история: %q", mine)
	}

	for name, body := range map[string]string{
		"не картинка":   `{"text":"x","image":"data:text/plain;base64,AAAA"}`,
		"битый base64":  `{"text":"x","image":"data:image/png;base64,@@@"}`,
		"больше 1,5 МБ": imageJSON("x", maxImageBytes+1),
		"пусто":         `{"text":"  "}`,
	} {
		if rec := doAs(t, h, tok, "POST", "/api/chat", body); rec.Code != 400 {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	// Тело больше 2,5 МБ — 413.
	if rec := doAs(t, h, tok, "POST", "/api/chat", imageJSON("x", 2<<20)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("огромное тело: %d", rec.Code)
	}
}

func TestChatImageRejected(t *testing.T) {
	// Модель без зрения отвечает 400 на запрос с картинкой.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"image input is not supported"}`, http.StatusBadRequest)
	}))
	t.Cleanup(srv.Close)
	st, _ := store.Open("")
	h := New(Options{Store: st, LLM: llm.New(llm.Config{BaseURL: srv.URL, APIKey: "k", Model: "m"}, 2*time.Second)})
	tok := register(t, h, "alice")
	rec := doAs(t, h, tok, "POST", "/api/chat", imageJSON("что тут", 1000))
	if !strings.Contains(rec.Body.String(), "не приняла запрос с картинкой") {
		t.Fatalf("ответ: %s", rec.Body)
	}
	// Без картинки та же ошибка — обычное «модель не ответила».
	rec = doAs(t, h, tok, "POST", "/api/chat", `{"text":"привет"}`)
	if strings.Contains(rec.Body.String(), "картинк") || !strings.Contains(rec.Body.String(), "Модель не ответила") {
		t.Fatalf("без картинки: %s", rec.Body)
	}
}
