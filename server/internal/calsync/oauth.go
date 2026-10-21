package calsync

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// OAuthApp — зарегистрированное приложение у Google или Microsoft.
type OAuthApp struct {
	ClientID     string
	ClientSecret string
	AuthURL      string
	TokenURL     string
	Scopes       []string
	// ExtraAuth — дополнительные параметры страницы согласия (offline-доступ и т. п.).
	ExtraAuth url.Values
	// APIBase — корень REST API календаря.
	APIBase string
}

// GoogleApp — настройки Google Календаря (Calendar API v3).
func GoogleApp(clientID, secret string) *OAuthApp {
	return &OAuthApp{
		ClientID:     clientID,
		ClientSecret: secret,
		AuthURL:      "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		Scopes:       []string{"openid", "email", "https://www.googleapis.com/auth/calendar.events"},
		// offline + consent — чтобы Google выдал refresh_token и при повторном подключении.
		ExtraAuth: url.Values{"access_type": {"offline"}, "prompt": {"consent"}, "include_granted_scopes": {"true"}},
		APIBase:   "https://www.googleapis.com/calendar/v3",
	}
}

// OutlookApp — настройки Outlook / Microsoft 365 (Microsoft Graph).
func OutlookApp(clientID, secret string) *OAuthApp {
	return &OAuthApp{
		ClientID:     clientID,
		ClientSecret: secret,
		AuthURL:      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		TokenURL:     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		Scopes:       []string{"openid", "email", "offline_access", "Calendars.ReadWrite"},
		ExtraAuth:    url.Values{"prompt": {"select_account"}},
		APIBase:      "https://graph.microsoft.com/v1.0",
	}
}

// Token — OAuth-токены; хранятся зашифрованными в Integration.Secret.
type Token struct {
	Access  string    `json:"access"`
	Refresh string    `json:"refresh"`
	Expiry  time.Time `json:"expiry"`
}

// AuthCodeURL — страница согласия, куда отправляем пользователя.
func (a *OAuthApp) AuthCodeURL(state, redirect string) string {
	q := url.Values{
		"client_id":     {a.ClientID},
		"redirect_uri":  {redirect},
		"response_type": {"code"},
		"scope":         {strings.Join(a.Scopes, " ")},
		"state":         {state},
	}
	for k, v := range a.ExtraAuth {
		q[k] = v
	}
	sep := "?"
	if strings.Contains(a.AuthURL, "?") {
		sep = "&"
	}
	return a.AuthURL + sep + q.Encode()
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

func (a *OAuthApp) tokenRequest(ctx context.Context, n *Net, form url.Values) (tokenResponse, error) {
	form.Set("client_id", a.ClientID)
	form.Set("client_secret", a.ClientSecret)
	h := http.Header{"Content-Type": {"application/x-www-form-urlencoded"}, "Accept": {"application/json"}}
	resp, data, err := n.Do(ctx, http.MethodPost, a.TokenURL, h, []byte(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	var tr tokenResponse
	_ = json.Unmarshal(data, &tr)
	if resp.StatusCode != http.StatusOK || tr.AccessToken == "" {
		if tr.Error == "invalid_grant" || resp.StatusCode == http.StatusUnauthorized {
			return tokenResponse{}, ErrAuth
		}
		msg := tr.Description
		if msg == "" {
			msg = tr.Error
		}
		if msg == "" {
			msg = fmt.Sprintf("ответ %d", resp.StatusCode)
		}
		return tokenResponse{}, fmt.Errorf("вход не удался: %s", msg)
	}
	return tr, nil
}

// Exchange меняет код с страницы согласия на токены; email — адрес аккаунта из id_token.
func (a *OAuthApp) Exchange(ctx context.Context, n *Net, code, redirect string) (tok Token, email string, err error) {
	tr, err := a.tokenRequest(ctx, n, url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {redirect},
	})
	if err != nil {
		return Token{}, "", err
	}
	if tr.RefreshToken == "" {
		return Token{}, "", errors.New("сервис не выдал постоянный доступ — отзовите доступ приложения в аккаунте и подключите заново")
	}
	tok = Token{Access: tr.AccessToken, Refresh: tr.RefreshToken, Expiry: expiry(tr.ExpiresIn)}
	return tok, idTokenEmail(tr.IDToken), nil
}

func expiry(seconds int) time.Time {
	if seconds <= 0 {
		seconds = 3600
	}
	return time.Now().Add(time.Duration(seconds) * time.Second)
}

// idTokenEmail достаёт e-mail из id_token. Подпись не проверяем: токен получен
// напрямую от провайдера по TLS в ответ на наш запрос, а e-mail нужен только для подписи в UI.
func idTokenEmail(idToken string) string {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"`
	}
	if json.Unmarshal(raw, &claims) != nil {
		return ""
	}
	if claims.Email != "" {
		return claims.Email
	}
	return claims.PreferredUsername
}

// TokenSource выдаёт действующий access-токен, обновляя его по refresh-токену.
// Save вызывается, когда токены поменялись, — чтобы сохранить их в хранилище.
type TokenSource struct {
	App  *OAuthApp
	Net  *Net
	Save func(Token) error

	mu  sync.Mutex
	tok Token
}

// NewTokenSource — источник токенов с начальным значением.
func NewTokenSource(app *OAuthApp, n *Net, tok Token, save func(Token) error) *TokenSource {
	return &TokenSource{App: app, Net: n, Save: save, tok: tok}
}

func (t *TokenSource) access(ctx context.Context, force bool) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !force && t.tok.Access != "" && time.Until(t.tok.Expiry) > time.Minute {
		return t.tok.Access, nil
	}
	if t.tok.Refresh == "" {
		return "", ErrAuth
	}
	tr, err := t.App.tokenRequest(ctx, t.Net, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {t.tok.Refresh},
	})
	if err != nil {
		return "", err
	}
	t.tok.Access = tr.AccessToken
	t.tok.Expiry = expiry(tr.ExpiresIn)
	if tr.RefreshToken != "" {
		t.tok.Refresh = tr.RefreshToken // Microsoft выдаёт новый refresh-токен при каждом обновлении
	}
	if t.Save != nil {
		if err := t.Save(t.tok); err != nil {
			return "", err
		}
	}
	return t.tok.Access, nil
}

// restDo — JSON-запрос к API с Bearer-токеном; при 401 токен обновляется и запрос повторяется.
func restDo(ctx context.Context, ts *TokenSource, method, target string, header http.Header, in, out any) (int, error) {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return 0, err
		}
	}
	for attempt := range 2 {
		token, err := ts.access(ctx, attempt > 0)
		if err != nil {
			return 0, err
		}
		h := header.Clone()
		if h == nil {
			h = http.Header{}
		}
		h.Set("Authorization", "Bearer "+token)
		h.Set("Accept", "application/json")
		if body != nil {
			h.Set("Content-Type", "application/json")
		}
		resp, data, err := ts.Net.Do(ctx, method, target, h, body)
		if err != nil {
			return 0, err
		}
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			continue
		}
		switch {
		case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
			return resp.StatusCode, ErrAuth
		case resp.StatusCode == http.StatusPreconditionFailed:
			return resp.StatusCode, ErrConflict
		case resp.StatusCode >= 300:
			return resp.StatusCode, &StatusError{Status: resp.StatusCode, What: apiName(target)}
		}
		if out != nil && len(bytes.TrimSpace(data)) > 0 {
			if err := json.Unmarshal(data, out); err != nil {
				return resp.StatusCode, fmt.Errorf("%s: непонятный ответ: %w", apiName(target), err)
			}
		}
		return resp.StatusCode, nil
	}
	return 0, ErrAuth
}

func apiName(target string) string {
	switch {
	case strings.Contains(target, "googleapis.com"):
		return "Google Календарь"
	case strings.Contains(target, "graph.microsoft.com"):
		return "Outlook"
	}
	return "Календарь"
}
