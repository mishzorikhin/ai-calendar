// Package llm — клиент OpenAI-совместимого API: диалог с инструментами.
// Ответ стримится по токенам (SSE), вызовы инструментов собираются из дельт;
// если провайдер стриминг не поддерживает, запрос повторяется без него.
package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Config — параметры подключения (переменные окружения LLM_*).
type Config struct {
	BaseURL string // например, https://api.neuraldeep.ru/v1
	APIKey  string
	Model   string // например, qwen3.6-unlim-noreason
}

// Client — клиент чат-комплитов. Готов к работе, если заданы ключ и модель.
type Client struct {
	cfg    Config
	http   *http.Client // обычные запросы — с общим таймаутом
	stream *http.Client // стриминг — без него, бюджет задаёт контекст вызова
}

// New собирает клиента; timeout — бюджет одного нестримингового запроса.
func New(cfg Config, timeout time.Duration) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: timeout}, stream: &http.Client{}}
}

// Ready сообщает, настроен ли клиент.
func (c *Client) Ready() bool { return c != nil && c.cfg.APIKey != "" && c.cfg.Model != "" }

// Message — сообщение диалога в формате чат-API.
type Message struct {
	Role       string     `json:"role"` // system | user | assistant | tool
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`   // у assistant
	ToolCallID string     `json:"tool_call_id,omitempty"` // у tool — id вызова
}

// FunctionCall — имя инструмента и его аргументы (JSON-строка).
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolCall — вызов инструмента, который просит выполнить модель.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // всегда "function"
	Function FunctionCall `json:"function"`
	Index    int          `json:"-"` // позиция в потоке дельт; в запросы не уходит
}

// FunctionSpec — описание инструмента для модели.
type FunctionSpec struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"` // JSON Schema
}

// Tool — инструмент, доступный модели.
type Tool struct {
	Type     string       `json:"type"` // "function"
	Function FunctionSpec `json:"function"`
}

type chatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Tools       []Tool    `json:"tools,omitempty"`
	Temperature float64   `json:"temperature"`
	Stream      bool      `json:"stream"`
}

// httpError — ответ API с неуспешным статусом.
type httpError struct{ status int }

func (e *httpError) Error() string {
	return fmt.Sprintf("LLM вернула статус %d", e.status)
}

// roundTimeout — бюджет одного захода в модель внутри агентского цикла.
const roundTimeout = 90 * time.Second

// Chat — один заход в модель: текст ответа идёт в onDelta по мере генерации,
// возвращается собранное сообщение с полным текстом и вызовами инструментов.
func (c *Client) Chat(ctx context.Context, messages []Message, tools []Tool, onDelta func(string)) (Message, error) {
	if !c.Ready() {
		return Message{}, errors.New("LLM не настроена")
	}
	ctx, cancel := context.WithTimeout(ctx, roundTimeout)
	defer cancel()
	body := chatRequest{Model: c.cfg.Model, Messages: messages, Tools: tools, Temperature: 0.4, Stream: true}
	msg, err := c.streamRound(ctx, body, onDelta)
	var he *httpError
	if errors.As(err, &he) {
		// Провайдер мог не принять stream — повторяем обычным ответом.
		body.Stream = false
		return c.round(ctx, body, onDelta)
	}
	return msg, err
}

func (c *Client) do(ctx context.Context, body chatRequest, client *http.Client) (*http.Response, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if body.Stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("запрос к LLM: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, &httpError{res.StatusCode}
	}
	return res, nil
}

// streamRound читает SSE-поток: контент уходит в onDelta, tool calls копятся по индексу.
func (c *Client) streamRound(ctx context.Context, body chatRequest, onDelta func(string)) (Message, error) {
	res, err := c.do(ctx, body, c.stream)
	if err != nil {
		return Message{}, err
	}
	defer res.Body.Close()

	out := Message{Role: "assistant"}
	order := []int{}
	calls := map[int]*ToolCall{}

	reader := bufio.NewReader(res.Body)
	for {
		line, err := reader.ReadString('\n')
		if payload, ok := strings.CutPrefix(strings.TrimSpace(line), "data:"); ok {
			payload = strings.TrimSpace(payload)
			if payload == "[DONE]" {
				break
			}
			// Свежий chunk на каждый кадр: unmarshal не затирает отсутствующие поля.
			var chunk struct {
				Choices []struct {
					Delta struct {
						Content   string     `json:"content"`
						ToolCalls []ToolCall `json:"tool_calls"`
					} `json:"delta"`
				} `json:"choices"`
				Error *struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if json.Unmarshal([]byte(payload), &chunk) == nil {
				if chunk.Error != nil {
					return Message{}, fmt.Errorf("LLM: %s", chunk.Error.Message)
				}
				if len(chunk.Choices) > 0 {
					delta := chunk.Choices[0].Delta
					if delta.Content != "" {
						out.Content += delta.Content
						onDelta(delta.Content)
					}
					for _, tc := range delta.ToolCalls {
						slot, ok := calls[tc.Index]
						if !ok {
							slot = &ToolCall{Type: "function"}
							calls[tc.Index] = slot
							order = append(order, tc.Index)
						}
						slot.ID += tc.ID
						slot.Function.Name += tc.Function.Name
						slot.Function.Arguments += tc.Function.Arguments
					}
				}
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return Message{}, fmt.Errorf("чтение потока LLM: %w", err)
		}
	}
	for _, i := range order {
		out.ToolCalls = append(out.ToolCalls, *calls[i])
	}
	return out, nil
}

// round — нестриминговый заход: весь ответ приходит одним JSON.
func (c *Client) round(ctx context.Context, body chatRequest, onDelta func(string)) (Message, error) {
	res, err := c.do(ctx, body, c.http)
	if err != nil {
		return Message{}, err
	}
	defer res.Body.Close()
	var cr struct {
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(res.Body).Decode(&cr); err != nil {
		return Message{}, fmt.Errorf("разбор ответа LLM: %w", err)
	}
	if len(cr.Choices) == 0 {
		return Message{}, errors.New("пустой ответ LLM")
	}
	msg := cr.Choices[0].Message
	msg.Role = "assistant"
	if msg.Content != "" {
		onDelta(msg.Content)
	}
	return msg, nil
}
