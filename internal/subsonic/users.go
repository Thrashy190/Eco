package subsonic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// Accounts. Subsonic is no help here: in Navidrome getUsers answers with only yourself and createUser is not implemented.
// Its own API can do both, but only takes a session opened with a password, which Eco never keeps. So an administrator
// confirms their password to open a session, and the rest uses that. Errors here never contain a password.

// Account is a user in Navidrome.
type Account struct {
	UserName     string `json:"userName"`
	Name         string `json:"name"`
	IsAdmin      bool   `json:"isAdmin"`
	LastAccessAt string `json:"lastAccessAt"`
}

var (
	// ErrWrongPassword means the password was not accepted.
	ErrWrongPassword = errors.New("wrong password")
	// ErrUserExists means that username is already taken.
	ErrUserExists = errors.New("username taken")
	// ErrSessionOver means Navidrome no longer accepts the session.
	ErrSessionOver = errors.New("session over")
)

func (c *Client) native(ctx context.Context, method, path, session string, body any) (*http.Response, error) {
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, &payload)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set("x-nd-authorization", "Bearer "+session)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, errors.New("could not reach Navidrome")
	}
	return resp, nil
}

// OpenSession signs in to Navidrome's own API and returns the session.
func (c *Client) OpenSession(ctx context.Context, user, password string) (string, error) {
	resp, err := c.native(ctx, http.MethodPost, "/auth/login", "", map[string]string{"username": user, "password": password})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return "", ErrWrongPassword
	}
	var opened struct {
		Token string `json:"token"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&opened) != nil || opened.Token == "" {
		return "", fmt.Errorf("could not sign in to Navidrome (HTTP %d)", resp.StatusCode)
	}
	return opened.Token, nil
}

// Accounts lists every account.
func (c *Client) Accounts(ctx context.Context, session string) ([]Account, error) {
	resp, err := c.native(ctx, http.MethodGet, "/api/user", session, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrSessionOver
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("could not list the accounts (HTTP %d)", resp.StatusCode)
	}
	var out []Account
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, errors.New("could not read the accounts")
	}
	return out, nil
}

// CreateAccount adds a regular account.
func (c *Client) CreateAccount(ctx context.Context, session, username, name, password string) error {
	resp, err := c.native(ctx, http.MethodPost, "/api/user", session, map[string]any{"userName": username, "name": name, "email": "", "password": password, "isAdmin": false})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return ErrSessionOver
	}
	if resp.StatusCode < 300 {
		return nil
	}
	var refusal struct {
		Errors map[string]string `json:"errors"`
	}
	if json.NewDecoder(resp.Body).Decode(&refusal) == nil && refusal.Errors["userName"] == "ra.validation.unique" {
		return ErrUserExists
	}
	return fmt.Errorf("could not create the account (HTTP %d)", resp.StatusCode)
}
