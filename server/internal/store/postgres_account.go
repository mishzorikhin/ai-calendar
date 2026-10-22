package store

import (
	"context"
	"fmt"

	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Аккаунт в PostgreSQL. Удаление пользователя убирает его данные каскадом (ON DELETE CASCADE).

func (s *pgStore) Sessions(ctx context.Context) []model.Session {
	u, err := uid(ctx)
	if err != nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT left(token_hash, $2), label, created_at, last_seen FROM sessions
		WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen DESC, token_hash`, u, SessionIDLen)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []model.Session
	for rows.Next() {
		var sess model.Session
		if err := rows.Scan(&sess.ID, &sess.Label, &sess.CreatedAt, &sess.LastSeen); err != nil {
			return nil
		}
		out = append(out, sess)
	}
	return out
}

func (s *pgStore) DeleteSessionByID(ctx context.Context, id string) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	if len(id) != SessionIDLen {
		return ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND left(token_hash, $3) = $2`, u, id, SessionIDLen)
	if err != nil {
		return fmt.Errorf("сессия: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *pgStore) DeleteOtherSessions(ctx context.Context, keepHash string) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, u, keepHash)
	return err
}

func (s *pgStore) SetPassword(ctx context.Context, passHash string) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE users SET pass_hash = $2 WHERE id = $1`, u, passHash)
	if err != nil {
		return fmt.Errorf("пароль: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *pgStore) DeleteUser(ctx context.Context) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u)
	if err != nil {
		return fmt.Errorf("удаление аккаунта: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
