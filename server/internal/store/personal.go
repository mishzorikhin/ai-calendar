package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Персонализация в файловом хранилище: профиль, память ассистента, карточки людей.

func (s *fileStore) Profile(ctx context.Context) (model.Profile, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Profile{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if p, ok := s.d.Profiles[uid]; ok {
		return cloneProfile(p), nil
	}
	return model.DefaultProfile(), nil
}

// cloneProfile — копия профиля без общих срезов с хранилищем.
func cloneProfile(p model.Profile) model.Profile {
	p.WorkDays = slices.Clone(p.WorkDays)
	p.Muted = slices.Clone(p.Muted)
	blocks := make([]model.ProtectedBlock, len(p.Protected))
	for i, b := range p.Protected {
		b.Days = slices.Clone(b.Days)
		blocks[i] = b
	}
	p.Protected = blocks
	return p
}

func (s *fileStore) SetProfile(ctx context.Context, p model.Profile) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.d.Profiles == nil {
		s.d.Profiles = map[int64]model.Profile{}
	}
	s.d.Profiles[uid] = cloneProfile(p)
	return s.save()
}

func (s *fileStore) Memories(ctx context.Context) []model.Memory {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Memory
	for _, m := range s.d.Memories {
		if m.UserID == uid {
			out = append(out, m)
		}
	}
	slices.SortFunc(out, func(a, b model.Memory) int { return cmp.Compare(b.ID, a.ID) })
	return out
}

func (s *fileStore) AddMemory(ctx context.Context, m model.Memory) (model.Memory, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Memory{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, x := range s.d.Memories {
		if x.UserID == uid {
			n++
		}
	}
	if n >= model.MaxMemories {
		return model.Memory{}, ErrLimit
	}
	s.d.NextMemoryID++
	now := s.now()
	m.ID, m.UserID, m.CreatedAt, m.UpdatedAt = s.d.NextMemoryID, uid, now, now
	s.d.Memories = append(s.d.Memories, m)
	return m, s.save()
}

func (s *fileStore) UpdateMemory(ctx context.Context, id int64, patch model.MemoryPatch) (model.Memory, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Memory{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Memories, func(m model.Memory) bool { return m.ID == id && m.UserID == uid })
	if i < 0 {
		return model.Memory{}, ErrNotFound
	}
	s.d.Memories[i].Apply(patch)
	s.d.Memories[i].UpdatedAt = s.now()
	return s.d.Memories[i], s.save()
}

func (s *fileStore) DeleteMemory(ctx context.Context, id int64) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Memories, func(m model.Memory) bool { return m.ID == id && m.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	s.d.Memories = slices.Delete(s.d.Memories, i, i+1)
	return s.save()
}

func (s *fileStore) DeleteMemories(ctx context.Context) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.d.Memories = slices.DeleteFunc(s.d.Memories, func(m model.Memory) bool { return m.UserID == uid })
	return s.save()
}

func (s *fileStore) TouchMemories(ctx context.Context, ids []int64, at time.Time) error {
	uid, err := s.uid(ctx)
	if err != nil || len(ids) == 0 {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Memories {
		if m := &s.d.Memories[i]; m.UserID == uid && slices.Contains(ids, m.ID) {
			m.UsedAt = at
		}
	}
	return s.save()
}

func (s *fileStore) People(ctx context.Context) []model.Person {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Person
	for _, p := range s.d.People {
		if p.UserID == uid {
			p.Aliases = slices.Clone(p.Aliases)
			out = append(out, p)
		}
	}
	slices.SortFunc(out, comparePeople)
	return out
}

// comparePeople — по имени без учёта регистра, при равенстве — по id.
func comparePeople(a, b model.Person) int {
	return cmp.Or(strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)), cmp.Compare(a.ID, b.ID))
}

func (s *fileStore) SavePerson(ctx context.Context, p model.Person) (model.Person, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Person{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	p.UserID, p.UpdatedAt = uid, now
	p.Aliases = slices.Clone(p.Aliases)
	if p.ID == 0 {
		n := 0
		for _, x := range s.d.People {
			if x.UserID == uid {
				n++
			}
		}
		if n >= model.MaxPeople {
			return model.Person{}, ErrLimit
		}
		s.d.NextPersonID++
		p.ID, p.CreatedAt = s.d.NextPersonID, now
		s.d.People = append(s.d.People, p)
		return p, s.save()
	}
	i := slices.IndexFunc(s.d.People, func(x model.Person) bool { return x.ID == p.ID && x.UserID == uid })
	if i < 0 {
		return model.Person{}, ErrNotFound
	}
	p.CreatedAt = s.d.People[i].CreatedAt
	s.d.People[i] = p
	return p, s.save()
}

func (s *fileStore) DeletePerson(ctx context.Context, id int64) error {
	uid, err := s.uid(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.People, func(p model.Person) bool { return p.ID == id && p.UserID == uid })
	if i < 0 {
		return ErrNotFound
	}
	s.d.People = slices.Delete(s.d.People, i, i+1)
	return s.save()
}
