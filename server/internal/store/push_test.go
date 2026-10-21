package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// testPush — общий сценарий Web Push для файлового и PostgreSQL-хранилища.
func testPush(t *testing.T, s Store) {
	t.Helper()
	ctx := context.Background()
	alice := userCtx(t, s)
	bob, err := s.CreateUser(ctx, "bob", "Bob", "hash")
	if err != nil {
		t.Fatal(err)
	}
	bctx := WithUser(ctx, bob)

	// Напоминания события: nil — по умолчанию, [] — без напоминаний; оба переживают чтение.
	ev, err := s.CreateEvent(alice, model.Event{Date: "2026-10-20", Title: "Звонок", Start: 600, End: 660, Badge: model.BadgeRoutine})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Event(alice, ev.ID); got.Reminders != nil {
		t.Fatalf("по умолчанию: %#v", got.Reminders)
	}
	if _, err := s.UpdateEvent(alice, ev.ID, model.EventPatch{Reminders: &[]int{}}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Event(alice, ev.ID); got.Reminders == nil || len(got.Reminders) != 0 {
		t.Fatalf("без напоминаний: %#v", got.Reminders)
	}
	if _, err := s.UpdateEvent(alice, ev.ID, model.EventPatch{Reminders: &[]int{30, 0}}); err != nil {
		t.Fatal(err)
	}
	if got := s.EventsOn(alice, "2026-10-20"); len(got) != 1 || !slices.Equal(got[0].Reminders, []int{30, 0}) {
		t.Fatalf("напоминания: %+v", got)
	}
	ev2, err := s.CreateEvent(alice, model.Event{Date: "2026-10-21", Title: "Йога", Start: 600, End: 660, Badge: model.BadgeRoutine, Reminders: []int{5}})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Event(alice, ev2.ID); !slices.Equal(got.Reminders, []int{5}) {
		t.Fatalf("создание с напоминанием: %#v", got.Reminders)
	}
	if _, err := s.UpdateEvent(alice, ev2.ID, model.EventPatch{Reminders: new([]int)}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Event(alice, ev2.ID); got.Reminders != nil {
		t.Fatalf("возврат к умолчанию: %#v", got.Reminders)
	}

	// Подписки: свои у каждого; адрес переходит к тому, кто подписался последним.
	sub := func(endpoint string) model.PushSubscription {
		return model.PushSubscription{Endpoint: endpoint, P256DH: "key-" + endpoint, Auth: "auth"}
	}
	if err := s.SavePushSubscription(alice, sub("https://push.example/a")); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePushSubscription(alice, sub("https://push.example/shared")); err != nil {
		t.Fatal(err)
	}
	if got := s.PushSubscriptions(alice); len(got) != 2 || got[0].P256DH != "key-https://push.example/a" {
		t.Fatalf("подписки alice: %+v", got)
	}
	if err := s.SavePushSubscription(bctx, sub("https://push.example/shared")); err != nil {
		t.Fatal(err)
	}
	if got := s.PushSubscriptions(alice); len(got) != 1 || got[0].Endpoint != "https://push.example/a" {
		t.Fatalf("устройство перешло к bob, у alice: %+v", got)
	}
	if got := s.PushSubscriptions(bctx); len(got) != 1 || got[0].UserID != bob.ID {
		t.Fatalf("подписки bob: %+v", got)
	}
	ids := s.PushUserIDs(ctx)
	slices.Sort(ids)
	if len(ids) != 2 {
		t.Fatalf("PushUserIDs: %v", ids)
	}
	// Чужую подписку удалить нельзя (тихо), свою — можно, повторно — не ошибка.
	if err := s.DeletePushSubscription(alice, "https://push.example/shared"); err != nil {
		t.Fatal(err)
	}
	if len(s.PushSubscriptions(bctx)) != 1 {
		t.Fatal("alice удалила подписку bob")
	}
	if err := s.DeletePushSubscription(bctx, "https://push.example/shared"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePushSubscription(bctx, "https://push.example/shared"); err != nil {
		t.Fatal(err)
	}
	if ids := s.PushUserIDs(ctx); len(ids) != 1 {
		t.Fatalf("PushUserIDs после отписки: %v", ids)
	}
	// Предел устройств: самые старые забываются.
	for i := range MaxPushSubscriptions + 2 {
		if err := s.SavePushSubscription(alice, sub(fmt.Sprintf("https://push.example/n%d", i))); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond) // разное время создания для PostgreSQL
	}
	got := s.PushSubscriptions(alice)
	if len(got) != MaxPushSubscriptions || slices.ContainsFunc(got, func(p model.PushSubscription) bool {
		return p.Endpoint == "https://push.example/a" || p.Endpoint == "https://push.example/n0"
	}) {
		t.Fatalf("предел подписок: %d", len(got))
	}

	// Настройки: по умолчанию, затем свои; у bob — свои.
	if ns, err := s.NotifySettings(alice); err != nil || !reflect.DeepEqual(ns, model.DefaultNotifySettings) {
		t.Fatalf("настройки по умолчанию: %+v %v", ns, err)
	}
	want := model.NotifySettings{EventReminder: -1, TaskTime: 600, Digest: 480, Evening: 1200, QuietFrom: 1380, QuietTo: 420,
		BadgeReminders: map[model.Badge]int{model.BadgeSport: 60, model.BadgeWork: -1}}
	if err := s.SetNotifySettings(alice, want); err != nil {
		t.Fatal(err)
	}
	if ns, _ := s.NotifySettings(alice); !reflect.DeepEqual(ns, want) {
		t.Fatalf("настройки: %+v", ns)
	}
	if ns, _ := s.NotifySettings(bctx); !reflect.DeepEqual(ns, model.DefaultNotifySettings) {
		t.Fatalf("настройки bob: %+v", ns)
	}

	// Отметки напоминаний: второй раз — false, у другого пользователя ключ свой, старые забываются.
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	if ok, err := s.ClaimReminder(alice, "evt-1", now); !ok || err != nil {
		t.Fatalf("первая отметка: %v %v", ok, err)
	}
	if ok, _ := s.ClaimReminder(alice, "evt-1", now); ok {
		t.Fatal("повторная отметка должна вернуть false")
	}
	if ok, _ := s.ClaimReminder(bctx, "evt-1", now); !ok {
		t.Fatal("у bob свой ключ")
	}
	later := now.Add(ReminderMemory + time.Hour)
	if ok, _ := s.ClaimReminder(alice, "evt-2", later); !ok {
		t.Fatal("новая отметка")
	}
	if ok, _ := s.ClaimReminder(alice, "evt-1", later); !ok {
		t.Fatal("старая отметка должна забыться")
	}

	// Отложенные уведомления: забираются по сроку один раз, у каждого свой предел.
	msg := model.PushMessage{Kind: model.PushEvent, Title: "Звонок", URL: "/#day/2026-10-20", Tag: "evt-1"}
	if _, err := s.AddSnooze(alice, now.Add(10*time.Minute), msg); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddSnooze(bctx, now.Add(time.Hour), msg); err != nil {
		t.Fatal(err)
	}
	if due := s.TakeDueSnoozes(ctx, now.Add(5*time.Minute)); len(due) != 0 {
		t.Fatalf("рано: %+v", due)
	}
	due := s.TakeDueSnoozes(ctx, now.Add(10*time.Minute))
	if len(due) != 1 || due[0].UserID != alice.Value(ctxUserKey{}).(model.User).ID || due[0].Message != msg {
		t.Fatalf("срок: %+v", due)
	}
	if due := s.TakeDueSnoozes(ctx, now.Add(10*time.Minute)); len(due) != 0 {
		t.Fatalf("забирается один раз: %+v", due)
	}
	for range MaxSnoozes - 1 {
		if _, err := s.AddSnooze(bctx, now.Add(2*time.Hour), msg); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.AddSnooze(bctx, now, msg); !errors.Is(err, ErrLimit) {
		t.Fatalf("предел отложенных: %v", err)
	}
	if _, err := s.AddSnooze(alice, now, msg); err != nil {
		t.Fatalf("предел у каждого свой: %v", err)
	}

	// Список отложенных — свои, ближайшие первыми; отмена — только своих.
	list := s.Snoozes(alice)
	if len(list) != 1 || list[0].Message.Title != "Звонок" {
		t.Fatalf("отложенные alice: %+v", list)
	}
	z, err := s.AddSnooze(alice, now.Add(-time.Hour), model.PushMessage{Kind: model.PushReminder, Title: "Раньше"})
	if err != nil || z.ID == 0 {
		t.Fatalf("id отложенного: %+v %v", z, err)
	}
	if list := s.Snoozes(alice); len(list) != 2 || list[0].Message.Title != "Раньше" {
		t.Fatalf("порядок отложенных: %+v", list)
	}
	if err := s.DeleteSnooze(bctx, z.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужое отложенное: %v", err)
	}
	if err := s.DeleteSnooze(alice, z.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSnooze(alice, z.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("повторная отмена: %v", err)
	}

	// Повторяющиеся события: правило, конец и убранные дни сохраняются; RepeatingEvents — по началу серии.
	rep, err := s.CreateEvent(alice, model.Event{Date: "2026-10-20", Title: "Йога", Start: 1140, End: 1200, Badge: model.BadgeSport,
		Repeat: model.RepeatWeekly, RepeatUntil: "2026-12-31"})
	if err != nil {
		t.Fatal(err)
	}
	skip := "2026-10-27"
	if _, err := s.UpdateEvent(alice, rep.ID, model.EventPatch{SkipDate: &skip}); err != nil {
		t.Fatal(err)
	}
	ser, _ := s.Event(alice, rep.ID)
	if ser.Repeat != model.RepeatWeekly || ser.RepeatUntil != "2026-12-31" || fmt.Sprint(ser.ExDates) != "[2026-10-27]" {
		t.Fatalf("серия: %+v", ser)
	}
	if list := s.RepeatingEvents(alice, "2026-10-01", "2026-10-19"); len(list) != 0 {
		t.Fatalf("серия ещё не началась: %+v", list)
	}
	if list := s.RepeatingEvents(alice, "2027-01-01", "2027-01-31"); len(list) != 0 {
		t.Fatalf("серия уже закончилась: %+v", list)
	}
	if list := s.RepeatingEvents(alice, "2026-12-01", "2027-01-01"); len(list) != 1 || list[0].ID != rep.ID {
		t.Fatalf("RepeatingEvents: %+v", list)
	}
	if list := s.RepeatingEvents(bctx, "2026-12-01", "2027-01-01"); len(list) != 0 {
		t.Fatalf("чужие серии: %+v", list)
	}
	none := model.RepeatNone
	if _, err := s.UpdateEvent(alice, rep.ID, model.EventPatch{Repeat: &none}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Event(alice, rep.ID); got.Repeat != "" || got.RepeatUntil != "" || got.ExDates != nil {
		t.Fatalf("повтор снят: %+v", got)
	}

	// Подпись устройства сохраняется.
	if err := s.SavePushSubscription(alice, model.PushSubscription{Endpoint: "https://push.example/label", P256DH: "k", Auth: "a", Label: "Chrome · Android"}); err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(s.PushSubscriptions(alice), func(p model.PushSubscription) bool { return p.Label == "Chrome · Android" }) {
		t.Fatal("подпись устройства потерялась")
	}

	// Ключ сервера создаётся один раз.
	calls := 0
	gen := func() (string, error) { calls++; return fmt.Sprintf("key-%d", calls), nil }
	k1, err := s.ServerKey(ctx, "vapid", gen)
	if err != nil {
		t.Fatal(err)
	}
	k2, _ := s.ServerKey(ctx, "vapid", gen)
	if k1 != "key-1" || k2 != k1 || calls != 1 {
		t.Fatalf("ключ: %q %q, вызовов %d", k1, k2, calls)
	}
}

func TestFilePush(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	testPush(t, s)

	// Подписки, настройки и ключ переживают перезапуск.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userCtx(t, s2)
	if len(s2.PushSubscriptions(ctx)) != MaxPushSubscriptions {
		t.Fatal("подписки после перезапуска")
	}
	if ns, _ := s2.NotifySettings(ctx); ns.Digest != 480 {
		t.Fatalf("настройки после перезапуска: %+v", ns)
	}
	if k, _ := s2.ServerKey(ctx, "vapid", func() (string, error) { return "new", nil }); k != "key-1" {
		t.Fatalf("ключ после перезапуска: %q", k)
	}
}

func TestPostgresPush(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL не задан")
	}
	ctx := context.Background()
	s, err := OpenPostgres(ctx, dsn, "")
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	defer s.(*pgStore).pool.Close()
	mustWipe(ctx, t, s)
	testPush(t, s)
}

// Настройки, сохранённые до тихих часов и вечерней сводки, читаются со значениями по умолчанию,
// а не с нулями («в 0:00»).
func TestFileNotifySettingsUpgrade(t *testing.T) {
	dir := t.TempDir()
	raw := `{"users":[{"id":1,"username":"alice","name":"Alice","passHash":"h"}],"nextUserId":2,
		"notifySettings":{"1":{"eventReminder":5,"taskTime":540,"digest":480}}}`
	if err := os.WriteFile(dir+"/data.json", []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ns, err := s.NotifySettings(userCtx(t, s))
	if err != nil {
		t.Fatal(err)
	}
	want := model.NotifySettings{EventReminder: 5, TaskTime: 540, Digest: 480, Evening: -1, QuietFrom: -1, QuietTo: -1}
	if !reflect.DeepEqual(ns, want) {
		t.Fatalf("старые настройки: %+v", ns)
	}
}
