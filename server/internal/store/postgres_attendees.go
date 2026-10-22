package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/mishzorikhin/ai-calendar/server/internal/model"
)

// eventColumnsAs — колонки события с префиксом таблицы (для запросов с JOIN).
func eventColumnsAs(prefix string) string {
	cols := strings.Split(eventColumns, ",")
	for i, c := range cols {
		cols[i] = prefix + strings.TrimSpace(c)
	}
	return strings.Join(cols, ", ")
}

func (s *pgStore) attendeesFor(ctx context.Context, ids []string) (map[string][]model.Attendee, error) {
	rows, err := s.pool.Query(ctx, `SELECT a.event_id, u.id, u.username, u.name, a.status
		FROM event_attendees a JOIN users u ON u.id = a.user_id
		WHERE a.event_id = ANY($1) ORDER BY a.created_at, u.id`, ids)
	if err != nil {
		return nil, fmt.Errorf("участники: %w", err)
	}
	defer rows.Close()
	out := map[string][]model.Attendee{}
	for rows.Next() {
		var id string
		var a model.Attendee
		if err := rows.Scan(&id, &a.UserID, &a.Username, &a.Name, &a.Status); err != nil {
			return nil, err
		}
		out[id] = append(out[id], a)
	}
	return out, rows.Err()
}

func (s *pgStore) SetAttendees(ctx context.Context, eventID string, users []model.User) ([]model.Attendee, error) {
	u, err := uid(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var owner int64
	if err := tx.QueryRow(ctx, `SELECT user_id FROM events WHERE id = $1 AND user_id = $2 FOR UPDATE`, eventID, u).Scan(&owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("участники: %w", err)
	}
	ids := make([]int64, len(users))
	for i, x := range users {
		ids[i] = x.ID
	}
	if _, err := tx.Exec(ctx, `DELETE FROM event_attendees WHERE event_id = $1 AND NOT (user_id = ANY($2))`, eventID, ids); err != nil {
		return nil, fmt.Errorf("участники: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO event_attendees (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, eventID, id); err != nil {
			return nil, fmt.Errorf("участники: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	m, err := s.attendeesFor(ctx, []string{eventID})
	return m[eventID], err
}

func (s *pgStore) Attendees(ctx context.Context, ids []string) map[string][]model.Attendee {
	u, err := uid(ctx)
	if err != nil || len(ids) == 0 {
		return nil
	}
	// Только события, которые пользователь создал или куда приглашён.
	rows, err := s.pool.Query(ctx, `SELECT e.id FROM events e WHERE e.id = ANY($1) AND (e.user_id = $2
		OR EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = $2))`, ids, u)
	if err != nil {
		return nil
	}
	allowed, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(allowed) == 0 {
		return nil
	}
	out, err := s.attendeesFor(ctx, allowed)
	if err != nil {
		return nil
	}
	return out
}

const inviteQuery = `SELECT %s, a.status, o.id, o.username, o.name
	FROM events e JOIN event_attendees a ON a.event_id = e.id JOIN users o ON o.id = e.user_id
	WHERE a.user_id = $1 AND %s`

func scanInvite(row pgx.Row) (model.Event, error) {
	var e model.Event
	var userID *int64
	var reminders, exdates *string
	var status model.RSVP
	var owner model.User
	err := row.Scan(&e.ID, &userID, &e.Date, &e.Title, &e.Subtitle, &e.Start, &e.End, &e.Badge, &e.Highlight, &e.CreatedAt,
		&e.Source, &e.ExternalID, &e.ETag, &e.ReadOnly, &e.AllDay, &reminders, &e.Repeat, &e.RepeatUntil, &exdates,
		&e.Notes, &e.URL, &e.Travel, &e.EndDate, &status, &owner.ID, &owner.Username, &owner.Name)
	if err != nil {
		return e, err
	}
	if userID != nil {
		e.UserID = *userID
	}
	if exdates != nil {
		if err := json.Unmarshal([]byte(*exdates), &e.ExDates); err != nil {
			return e, err
		}
	}
	e.Invite = &model.Invite{From: owner, Status: status}
	return e, nil
}

func (s *pgStore) InvitedEvents(ctx context.Context, from, to string) []model.Event {
	u, err := uid(ctx)
	if err != nil {
		return nil
	}
	where := `((e.repeat = '' AND e.end_date = '' AND e.date >= $2 AND e.date <= $3)
		OR (e.repeat <> '' AND e.date <= $3 AND (e.repeat_until = '' OR e.repeat_until >= $2))
		OR (e.end_date <> '' AND e.date <= $3 AND e.end_date >= $2))`
	rows, err := s.pool.Query(ctx, fmt.Sprintf(inviteQuery, eventColumnsAs("e."), where), u, from, to)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []model.Event
	for rows.Next() {
		e, err := scanInvite(rows)
		if err != nil {
			return nil
		}
		out = append(out, e)
	}
	return out
}

func (s *pgStore) InvitedEvent(ctx context.Context, id string) (model.Event, error) {
	u, err := uid(ctx)
	if err != nil {
		return model.Event{}, err
	}
	e, err := scanInvite(s.pool.QueryRow(ctx, fmt.Sprintf(inviteQuery, eventColumnsAs("e."), "e.id = $2"), u, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Event{}, ErrNotFound
	}
	if err != nil {
		return model.Event{}, fmt.Errorf("приглашение: %w", err)
	}
	return e, nil
}

func (s *pgStore) SetRSVP(ctx context.Context, eventID string, status model.RSVP) error {
	u, err := uid(ctx)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE event_attendees SET status = $3 WHERE event_id = $1 AND user_id = $2`, eventID, u, status)
	if err != nil {
		return fmt.Errorf("ответ на приглашение: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
