package api

import (
	"strings"
	"testing"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
	"github.com/mishzorikhin/ai-calendar/server/internal/store"
)

func TestAttendeesFlow(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st})
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	carl := register(t, h, "carl")

	if rec := doAs(t, h, alice, "POST", "/api/events", `{"date":"2026-10-21","title":"x","start":600,"end":660,"attendees":["nobody"]}`); rec.Code != 400 {
		t.Fatalf("неизвестный логин: %d", rec.Code)
	}
	ev := decode[model.Event](t, doAs(t, h, alice, "POST", "/api/events",
		`{"date":"2026-10-21","title":"Созвон","start":600,"end":660,"attendees":["@Bob","alice"]}`))
	if len(ev.Attendees) != 1 || ev.Attendees[0].Username != "bob" || ev.Attendees[0].Status != model.RSVPPending {
		t.Fatalf("приглашённые (себя не зовём): %+v", ev.Attendees)
	}
	// У Боба — приглашение только для чтения, уведомление о нём.
	day := decode[[]model.Event](t, doAs(t, h, bob, "GET", "/api/events?date=2026-10-21", ""))
	if len(day) != 1 || day[0].Invite == nil || day[0].Invite.From.Username != "alice" || !day[0].ReadOnly {
		t.Fatalf("день Боба: %+v", day)
	}
	notes := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", ""))
	if len(notes) != 1 || notes[0].EventID != ev.ID || notes[0].Date != "2026-10-21" || !strings.Contains(notes[0].Text, "Приглашение") {
		t.Fatalf("уведомление: %+v", notes)
	}
	// Карл ничего не видит; править и удалять чужое нельзя.
	if l := decode[[]model.Event](t, doAs(t, h, carl, "GET", "/api/events?date=2026-10-21", "")); len(l) != 0 {
		t.Fatalf("посторонний видит: %+v", l)
	}
	if rec := doAs(t, h, bob, "PATCH", "/api/events/"+ev.ID, `{"title":"взлом"}`); rec.Code != 404 {
		t.Fatalf("правка приглашённым: %d", rec.Code)
	}
	if rec := doAs(t, h, bob, "DELETE", "/api/events/"+ev.ID, ""); rec.Code != 404 {
		t.Fatalf("удаление приглашённым: %d", rec.Code)
	}
	if rec := doAs(t, h, carl, "POST", "/api/events/"+ev.ID+"/rsvp", `{"status":"accepted"}`); rec.Code != 404 {
		t.Fatalf("ответ без приглашения: %d", rec.Code)
	}
	if rec := doAs(t, h, bob, "POST", "/api/events/"+ev.ID+"/rsvp", `{"status":"maybe"}`); rec.Code != 400 {
		t.Fatalf("неверный ответ: %d", rec.Code)
	}
	// Боб принимает — Алиса видит статус и получает уведомление.
	if rec := doAs(t, h, bob, "POST", "/api/events/"+ev.ID+"/rsvp", `{"status":"accepted"}`); rec.Code != 200 {
		t.Fatalf("ответ: %d", rec.Code)
	}
	mine := decode[[]model.Event](t, doAs(t, h, alice, "GET", "/api/events?date=2026-10-21", ""))
	if len(mine) != 1 || mine[0].Attendees[0].Status != model.RSVPAccepted {
		t.Fatalf("статус у владельца: %+v", mine)
	}
	if n := decode[[]model.Notification](t, doAs(t, h, alice, "GET", "/api/notifications", "")); len(n) != 1 || !strings.Contains(n[0].Text, "Придёт") {
		t.Fatalf("уведомление владельцу: %+v", n)
	}
	// Перенос — Бобу «Перенесли»; отказ убирает встречу из его дня.
	doAs(t, h, alice, "PATCH", "/api/events/"+ev.ID, `{"start":720,"end":780}`)
	if n := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", "")); len(n) != 2 || !strings.Contains(n[0].Text, "Перенесли") {
		t.Fatalf("перенос: %+v", n)
	}
	doAs(t, h, bob, "POST", "/api/events/"+ev.ID+"/rsvp", `{"status":"declined"}`)
	if l := decode[[]model.Event](t, doAs(t, h, bob, "GET", "/api/events?date=2026-10-21", "")); len(l) != 0 {
		t.Fatalf("отклонённое осталось: %+v", l)
	}
	// Замена списка: Карл добавлен — ему приглашение; удаление события — отмена тем, кто не отказался.
	upd := decode[model.Event](t, doAs(t, h, alice, "PATCH", "/api/events/"+ev.ID, `{"attendees":["bob","carl"]}`))
	if len(upd.Attendees) != 2 || upd.Attendees[0].Status != model.RSVPDeclined {
		t.Fatalf("замена: %+v", upd.Attendees)
	}
	doAs(t, h, alice, "DELETE", "/api/events/"+ev.ID, "")
	cn := decode[[]model.Notification](t, doAs(t, h, carl, "GET", "/api/notifications", ""))
	bn := decode[[]model.Notification](t, doAs(t, h, bob, "GET", "/api/notifications", ""))
	if len(cn) != 2 || !strings.Contains(cn[0].Text, "Отменили") || len(bn) != 2 {
		t.Fatalf("отмена: carl=%+v bob=%+v", cn, bn)
	}
}

func TestInvitesBusyTimeAndFeed(t *testing.T) {
	st, _ := store.Open("")
	h := New(Options{Store: st})
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	ev := decode[model.Event](t, doAs(t, h, alice, "POST", "/api/events",
		`{"date":"2026-10-21","title":"Планёрка","start":600,"end":660,"repeat":"daily","attendees":["bob"]}`))
	// Серия с приглашением видна Бобу каждый день; в его ленте .ics её нет.
	if l := decode[[]model.Event](t, doAs(t, h, bob, "GET", "/api/events?date=2026-10-25", "")); len(l) != 1 || l[0].ID != ev.ID {
		t.Fatalf("серия у приглашённого: %+v", l)
	}
	feed := decode[map[string]string](t, doAs(t, h, bob, "POST", "/api/feed", ""))
	body := do(t, h, "GET", feed["path"], "").Body.String()
	if strings.Contains(body, "Планёрка") {
		t.Fatal("чужая встреча не должна попадать в ленту приглашённого")
	}
}

func TestChatInviteTools(t *testing.T) {
	st, _ := store.Open("")
	llmc, _ := fakeChatLLMBodies(t, [][]string{
		{toolCall("create_event", `{"date":"2026-10-21","title":"Обед","start":"13:00","end":"14:00","attendees":["bob"]}`)},
		{textFrame("Позвал.")},
	})
	h := New(Options{Store: st, LLM: llmc})
	alice := register(t, h, "alice")
	bob := register(t, h, "bob")
	doAs(t, h, alice, "POST", "/api/chat", `{"text":"обед с бобом"}`)
	day := decode[[]model.Event](t, doAs(t, h, bob, "GET", "/api/events?date=2026-10-21", ""))
	if len(day) != 1 || day[0].Invite == nil {
		t.Fatalf("приглашение от ассистента: %+v", day)
	}
	// Боб отвечает через своего ассистента.
	llmc2, _ := fakeChatLLMBodies(t, [][]string{
		{toolCall("respond_invitation", `{"event_id":"`+day[0].ID+`","answer":"accepted"}`)},
		{textFrame("Ответил.")},
	})
	h2 := New(Options{Store: st, LLM: llmc2})
	doAs(t, h2, bob, "POST", "/api/chat", `{"text":"приду на обед"}`)
	mine := decode[[]model.Event](t, doAs(t, h, alice, "GET", "/api/events?date=2026-10-21", ""))
	if len(mine) != 1 || mine[0].Attendees[0].Status != model.RSVPAccepted {
		t.Fatalf("ответ через ассистента: %+v", mine)
	}
}
