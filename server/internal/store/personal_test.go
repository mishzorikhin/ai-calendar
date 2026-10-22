package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// testPersonal — общий сценарий профиля, памяти и людей для обоих хранилищ.
func testPersonal(t *testing.T, s Store) {
	t.Helper()
	ctx := userCtx(t, s)
	bob, err := s.CreateUser(context.Background(), "bob", "Bob", "hash")
	if err != nil {
		t.Fatal(err)
	}
	bctx := WithUser(context.Background(), bob)

	// Профиль: по умолчанию, сохранение, у другого — свой.
	p, err := s.Profile(ctx)
	if err != nil || p.WakeUp != 7*60 || !p.Memory || len(p.WorkDays) != 5 || p.Onboarded {
		t.Fatalf("профиль по умолчанию: %+v %v", p, err)
	}
	p.WorkStart, p.Onboarded, p.About = 10*60, true, "Сова"
	p.Protected = []model.ProtectedBlock{{Title: "Обед", Start: 13 * 60, End: 14 * 60, Days: []int{1, 2}}}
	if err := s.SetProfile(ctx, p); err != nil {
		t.Fatal(err)
	}
	got, err := s.Profile(ctx)
	if err != nil || got.WorkStart != 600 || !got.Onboarded || got.About != "Сова" || len(got.Protected) != 1 || got.Protected[0].Days[1] != 2 {
		t.Fatalf("профиль: %+v %v", got, err)
	}
	if bp, _ := s.Profile(bctx); bp.Onboarded || bp.WorkStart != 9*60 {
		t.Fatalf("чужой профиль: %+v", bp)
	}

	// Память: добавление, порядок (новые первыми), правка, чужие не видны, удаление.
	m1, err := s.AddMemory(ctx, model.Memory{Kind: model.MemoryRule, Text: "Не ставить встречи до 11", Source: model.SourceUser, Confirmed: true})
	if err != nil || m1.ID == 0 || m1.CreatedAt.IsZero() {
		t.Fatalf("факт: %+v %v", m1, err)
	}
	m2, err := s.AddMemory(ctx, model.Memory{Kind: model.MemoryHabit, Text: "Спорт по вторникам", Source: model.SourceInferred, Key: "habit:sport"})
	if err != nil {
		t.Fatal(err)
	}
	if list := s.Memories(ctx); len(list) != 2 || list[0].ID != m2.ID || list[1].Key != "" || list[0].Key != "habit:sport" {
		t.Fatalf("список: %+v", list)
	}
	yes := true
	text := "Спорт — вторник и четверг"
	upd, err := s.UpdateMemory(ctx, m2.ID, model.MemoryPatch{Confirmed: &yes, Text: &text})
	if err != nil || !upd.Confirmed || upd.Text != text || upd.Source != model.SourceInferred {
		t.Fatalf("правка: %+v %v", upd, err)
	}
	if _, err := s.UpdateMemory(bctx, m2.ID, model.MemoryPatch{Text: &text}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужой факт правится: %v", err)
	}
	if len(s.Memories(bctx)) != 0 {
		t.Fatal("чужие факты видны")
	}
	at := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	if err := s.TouchMemories(ctx, []int64{m1.ID}, at); err != nil {
		t.Fatal(err)
	}
	if list := s.Memories(ctx); !list[1].UsedAt.Equal(at) || !list[0].UsedAt.IsZero() {
		t.Fatalf("usedAt: %+v", list)
	}
	if err := s.DeleteMemory(bctx, m1.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужое удаление: %v", err)
	}
	if err := s.DeleteMemory(ctx, m1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddMemory(bctx, model.Memory{Kind: model.MemoryOther, Text: "x", Source: model.SourceUser}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteMemories(ctx); err != nil {
		t.Fatal(err)
	}
	if len(s.Memories(ctx)) != 0 || len(s.Memories(bctx)) != 1 {
		t.Fatal("«забыть всё» задело не те факты")
	}

	// Люди: создание, сортировка по имени, замена, удаление.
	gleb, err := s.SavePerson(ctx, model.Person{Name: "Глеб", Aliases: []string{"Глебушка"}, Relation: "коллега", MeetingMinutes: 45})
	if err != nil || gleb.ID == 0 {
		t.Fatalf("человек: %+v %v", gleb, err)
	}
	if _, err := s.SavePerson(ctx, model.Person{Name: "анна"}); err != nil {
		t.Fatal(err)
	}
	people := s.People(ctx)
	if len(people) != 2 || people[0].Name != "анна" || people[1].Aliases[0] != "Глебушка" {
		t.Fatalf("люди: %+v", people)
	}
	gleb.Place, gleb.Aliases = "Кофейня на Ленина", nil
	saved, err := s.SavePerson(ctx, gleb)
	if err != nil || saved.Place != "Кофейня на Ленина" || !saved.CreatedAt.Equal(gleb.CreatedAt) {
		t.Fatalf("замена: %+v %v", saved, err)
	}
	if _, err := s.SavePerson(bctx, gleb); !errors.Is(err, ErrNotFound) {
		t.Fatalf("чужая карточка: %v", err)
	}
	if err := s.DeletePerson(ctx, gleb.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePerson(ctx, gleb.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("повторное удаление: %v", err)
	}
	if len(s.People(ctx)) != 1 || len(s.People(bctx)) != 0 {
		t.Fatal("люди после удаления")
	}
}

func TestFilePersonal(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	testPersonal(t, s)
	// Всё переживает перезапуск.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userCtx(t, s2)
	if p, _ := s2.Profile(ctx); p.About != "Сова" || len(s2.People(ctx)) != 1 {
		t.Fatalf("после перезапуска: %+v", p)
	}
}

func TestMemoryLimit(t *testing.T) {
	s, _ := Open("")
	ctx := userCtx(t, s)
	for range model.MaxMemories {
		if _, err := s.AddMemory(ctx, model.Memory{Kind: model.MemoryOther, Text: "x", Source: model.SourceUser}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.AddMemory(ctx, model.Memory{Kind: model.MemoryOther, Text: "x", Source: model.SourceUser}); !errors.Is(err, ErrLimit) {
		t.Fatalf("предел: %v", err)
	}
}

func TestPostgresPersonal(t *testing.T) {
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
	testPersonal(t, s)
	actx := userCtx(t, s)
	for range model.MaxMemories - len(s.Memories(actx)) {
		if _, err := s.AddMemory(actx, model.Memory{Kind: model.MemoryOther, Text: "x", Source: model.SourceUser}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.AddMemory(actx, model.Memory{Kind: model.MemoryOther, Text: "x", Source: model.SourceUser}); !errors.Is(err, ErrLimit) {
		t.Fatalf("предел: %v", err)
	}
}
