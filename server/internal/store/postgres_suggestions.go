package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Предложения ассистента в PostgreSQL; уникальность ключа держит индекс (user_id, key).

const suggestionColumns = `id, user_id, kind, key, title, body, action::text, status, created_at, expires_at`

func scanSuggestion(row pgx.Row) (model.Suggestion, error) {
	var sg model.Suggestion
	var action string
	if err := row.Scan(&sg.ID, &sg.UserID, &sg.Kind, &sg.Key, &sg.Title, &sg.Body, &action, &sg.Status,
		&sg.CreatedAt, &sg.ExpiresAt); err != nil {
		return sg, err
	}
	return sg, json.Unmarshal([]byte(action), &sg.Action)
}

func (s *pgStore) AddSuggestion(ctx context.Context, sg model.Suggestion) (model.Suggestion, bool, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Suggestion{}, false, err
	}
	action, err := json.Marshal(sg.Action)
	if err != nil {
		return model.Suggestion{}, false, err
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM suggestions WHERE created_at < now() - $1::interval`,
		fmt.Sprintf("%d seconds", int(suggestionKeep.Seconds()))); err != nil {
		return model.Suggestion{}, false, fmt.Errorf("предложения: %w", err)
	}
	created := sg.CreatedAt
	if created.IsZero() {
		created = time.Now()
	}
	out, err := scanSuggestion(s.pool.QueryRow(ctx, `
		INSERT INTO suggestions (user_id, kind, key, title, body, action, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
		ON CONFLICT (user_id, key) DO NOTHING
		RETURNING `+suggestionColumns,
		u, sg.Kind, sg.Key, sg.Title, sg.Body, string(action), model.SuggestionPending, created, sg.ExpiresAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Suggestion{}, false, nil
	}
	if err != nil {
		return model.Suggestion{}, false, fmt.Errorf("предложение: %w", err)
	}
	return out, true, nil
}

func (s *pgStore) Suggestions(ctx context.Context, since time.Time) []model.Suggestion {
	u, err := uid(ctx)
	if err != nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT `+suggestionColumns+` FROM suggestions
		WHERE user_id = $1 AND created_at >= $2 ORDER BY id DESC`, u, since)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []model.Suggestion
	for rows.Next() {
		sg, err := scanSuggestion(rows)
		if err != nil {
			return nil
		}
		out = append(out, sg)
	}
	return out
}

func (s *pgStore) AnswerSuggestion(ctx context.Context, id int64, status string) (model.Suggestion, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Suggestion{}, err
	}
	sg, err := scanSuggestion(s.pool.QueryRow(ctx, `UPDATE suggestions SET status = $3
		WHERE id = $1 AND user_id = $2 AND status = $4 RETURNING `+suggestionColumns,
		id, u, status, model.SuggestionPending))
	if errors.Is(err, pgx.ErrNoRows) {
		// Не нашлось ждущего: либо его нет, либо на него уже ответили.
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM suggestions WHERE id = $1 AND user_id = $2)`, id, u).Scan(&exists); err != nil {
			return model.Suggestion{}, fmt.Errorf("предложение: %w", err)
		}
		if exists {
			return model.Suggestion{}, ErrConflict
		}
		return model.Suggestion{}, ErrNotFound
	}
	if err != nil {
		return model.Suggestion{}, fmt.Errorf("предложение: %w", err)
	}
	return sg, nil
}
