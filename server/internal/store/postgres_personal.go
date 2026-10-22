package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// Персонализация в PostgreSQL: профиль (JSONB), память ассистента, карточки людей.

func (s *pgStore) Profile(ctx context.Context) (model.Profile, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Profile{}, err
	}
	var raw string
	err = s.pool.QueryRow(ctx, `SELECT data::text FROM profiles WHERE user_id = $1`, u).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.DefaultProfile(), nil
	}
	if err != nil {
		return model.Profile{}, fmt.Errorf("профиль: %w", err)
	}
	var p model.Profile
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return model.Profile{}, fmt.Errorf("профиль: %w", err)
	}
	return p, nil
}

func (s *pgStore) SetProfile(ctx context.Context, p model.Profile) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO profiles (user_id, data) VALUES ($1, $2::jsonb)
		ON CONFLICT (user_id) DO UPDATE SET data = $2::jsonb`, u, string(raw))
	if err != nil {
		return fmt.Errorf("профиль: %w", err)
	}
	return nil
}

const memoryColumns = `id, user_id, kind, text, date, source, confirmed, key, rejected, created_at, updated_at, used_at`

func scanMemory(row pgx.CollectableRow) (model.Memory, error) {
	var m model.Memory
	err := row.Scan(&m.ID, &m.UserID, &m.Kind, &m.Text, &m.Date, &m.Source, &m.Confirmed, &m.Key, &m.Rejected,
		&m.CreatedAt, &m.UpdatedAt, &m.UsedAt)
	return m, err
}

func (s *pgStore) Memories(ctx context.Context) []model.Memory {
	u, err := uid(ctx)
	if err != nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT `+memoryColumns+` FROM memories WHERE user_id = $1 ORDER BY id DESC`, u)
	if err != nil {
		return nil
	}
	out, err := pgx.CollectRows(rows, scanMemory)
	if err != nil {
		return nil
	}
	return out
}

func (s *pgStore) AddMemory(ctx context.Context, m model.Memory) (model.Memory, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Memory{}, err
	}
	now := time.Now()
	m.UserID, m.CreatedAt, m.UpdatedAt = u, now, now
	// Предел проверяется в той же команде: два параллельных запроса не превысят его вместе
	// (при READ COMMITTED возможен перебор на единицы — приемлемо для мягкого предела).
	err = s.pool.QueryRow(ctx, `INSERT INTO memories (user_id, kind, text, date, source, confirmed, key, rejected, created_at, updated_at)
		SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $9 WHERE (SELECT count(*) FROM memories WHERE user_id = $1) < $10
		RETURNING id, created_at, updated_at`,
		u, m.Kind, m.Text, m.Date, m.Source, m.Confirmed, m.Key, m.Rejected, now, model.MaxMemories).Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Memory{}, ErrLimit
	}
	if err != nil {
		return model.Memory{}, fmt.Errorf("память: %w", err)
	}
	return m, nil
}

func (s *pgStore) UpdateMemory(ctx context.Context, id int64, patch model.MemoryPatch) (model.Memory, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Memory{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT `+memoryColumns+` FROM memories WHERE id = $1 AND user_id = $2`, id, u)
	if err != nil {
		return model.Memory{}, fmt.Errorf("память: %w", err)
	}
	m, err := pgx.CollectExactlyOneRow(rows, scanMemory)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Memory{}, ErrNotFound
	}
	if err != nil {
		return model.Memory{}, fmt.Errorf("память: %w", err)
	}
	m.Apply(patch)
	m.UpdatedAt = time.Now()
	_, err = s.pool.Exec(ctx, `UPDATE memories SET kind=$3, text=$4, date=$5, confirmed=$6, rejected=$7, updated_at=$8
		WHERE id=$1 AND user_id=$2`, id, u, m.Kind, m.Text, m.Date, m.Confirmed, m.Rejected, m.UpdatedAt)
	if err != nil {
		return model.Memory{}, fmt.Errorf("память: %w", err)
	}
	return m, nil
}

func (s *pgStore) DeleteMemory(ctx context.Context, id int64) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM memories WHERE id = $1 AND user_id = $2`, id, u)
	if err != nil {
		return fmt.Errorf("память: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *pgStore) DeleteMemories(ctx context.Context) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM memories WHERE user_id = $1`, u)
	return err
}

func (s *pgStore) TouchMemories(ctx context.Context, ids []int64, at time.Time) error {
	u, err := uid(ctx)
	if err != nil || len(ids) == 0 {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE memories SET used_at = $3 WHERE user_id = $1 AND id = ANY($2)`, u, ids, at)
	return err
}

const personColumns = `id, user_id, name, aliases::text, relation, place, meeting_minutes, birthday, notes, username, created_at, updated_at`

func scanPerson(row pgx.CollectableRow) (model.Person, error) {
	var p model.Person
	var aliases *string
	err := row.Scan(&p.ID, &p.UserID, &p.Name, &aliases, &p.Relation, &p.Place, &p.MeetingMinutes, &p.Birthday,
		&p.Notes, &p.Username, &p.CreatedAt, &p.UpdatedAt)
	if err == nil && aliases != nil {
		err = json.Unmarshal([]byte(*aliases), &p.Aliases)
	}
	return p, err
}

func (s *pgStore) People(ctx context.Context) []model.Person {
	u, err := uid(ctx)
	if err != nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT `+personColumns+` FROM people WHERE user_id = $1`, u)
	if err != nil {
		return nil
	}
	out, err := pgx.CollectRows(rows, scanPerson)
	if err != nil {
		return nil
	}
	slices.SortFunc(out, comparePeople)
	return out
}

// aliasesJSON — значение колонки aliases: пустой список — NULL.
func aliasesJSON(a []string) (*string, error) {
	if len(a) == 0 {
		return nil, nil
	}
	raw, err := json.Marshal(a)
	v := string(raw)
	return &v, err
}

func (s *pgStore) SavePerson(ctx context.Context, p model.Person) (model.Person, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Person{}, err
	}
	aliases, err := aliasesJSON(p.Aliases)
	if err != nil {
		return model.Person{}, err
	}
	now := time.Now()
	p.UserID, p.UpdatedAt = u, now
	if p.ID == 0 {
		p.CreatedAt = now
		err = s.pool.QueryRow(ctx, `INSERT INTO people (user_id, name, aliases, relation, place, meeting_minutes, birthday, notes, username, created_at, updated_at)
			SELECT $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $10 WHERE (SELECT count(*) FROM people WHERE user_id = $1) < $11
			RETURNING id, created_at, updated_at`,
			u, p.Name, aliases, p.Relation, p.Place, p.MeetingMinutes, p.Birthday, p.Notes, p.Username, now, model.MaxPeople).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return model.Person{}, ErrLimit
		}
		if err != nil {
			return model.Person{}, fmt.Errorf("карточка человека: %w", err)
		}
		return p, nil
	}
	err = s.pool.QueryRow(ctx, `UPDATE people SET name=$3, aliases=$4::jsonb, relation=$5, place=$6, meeting_minutes=$7,
			birthday=$8, notes=$9, username=$10, updated_at=$11
		WHERE id=$1 AND user_id=$2 RETURNING created_at, updated_at`,
		p.ID, u, p.Name, aliases, p.Relation, p.Place, p.MeetingMinutes, p.Birthday, p.Notes, p.Username, now).Scan(&p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Person{}, ErrNotFound
	}
	if err != nil {
		return model.Person{}, fmt.Errorf("карточка человека: %w", err)
	}
	return p, nil
}

func (s *pgStore) DeletePerson(ctx context.Context, id int64) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM people WHERE id = $1 AND user_id = $2`, id, u)
	if err != nil {
		return fmt.Errorf("карточка человека: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
