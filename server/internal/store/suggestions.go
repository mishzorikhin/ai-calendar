package store

import (
	"cmp"
	"context"
	"slices"
	"time"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// suggestionKeep — сколько хранить предложения: ключи старше уже не пересекаются с новыми
// (в ключ входит дата или неделя), а у «давней задачи» задача к тому времени закрыта или забыта.
const suggestionKeep = 60 * 24 * time.Hour

func (s *fileStore) AddSuggestion(ctx context.Context, sg model.Suggestion) (model.Suggestion, bool, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Suggestion{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.d.Suggestions = slices.DeleteFunc(s.d.Suggestions, func(x model.Suggestion) bool {
		return now.Sub(x.CreatedAt) > suggestionKeep
	})
	if slices.ContainsFunc(s.d.Suggestions, func(x model.Suggestion) bool { return x.UserID == uid && x.Key == sg.Key }) {
		return model.Suggestion{}, false, nil
	}
	s.d.NextSuggestionID++
	sg.ID, sg.UserID, sg.Status = s.d.NextSuggestionID, uid, model.SuggestionPending
	if sg.CreatedAt.IsZero() {
		sg.CreatedAt = now
	}
	s.d.Suggestions = append(s.d.Suggestions, sg)
	return sg, true, s.save()
}

func (s *fileStore) Suggestions(ctx context.Context, since time.Time) []model.Suggestion {
	uid, err := s.uid(ctx)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.Suggestion
	for _, x := range s.d.Suggestions {
		if x.UserID == uid && !x.CreatedAt.Before(since) {
			out = append(out, x)
		}
	}
	slices.SortFunc(out, func(a, b model.Suggestion) int { return cmp.Compare(b.ID, a.ID) })
	return out
}

func (s *fileStore) AnswerSuggestion(ctx context.Context, id int64, status string) (model.Suggestion, error) {
	uid, err := s.uid(ctx)
	if err != nil {
		return model.Suggestion{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.d.Suggestions, func(x model.Suggestion) bool { return x.ID == id && x.UserID == uid })
	if i < 0 {
		return model.Suggestion{}, ErrNotFound
	}
	if s.d.Suggestions[i].Status != model.SuggestionPending {
		return model.Suggestion{}, ErrConflict
	}
	s.d.Suggestions[i].Status = status
	return s.d.Suggestions[i], s.save()
}
