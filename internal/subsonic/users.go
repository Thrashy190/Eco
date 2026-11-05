package subsonic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
)

// User is an account in Navidrome.
type User struct {
	Username  string `json:"username"`
	AdminRole bool   `json:"adminRole"`
}

// Users lists the accounts. Navidrome only answers an administrator.
func (c *Client) Users(ctx context.Context, cred Cred) ([]User, error) {
	r, err := c.call(ctx, cred, "getUsers", url.Values{})
	if err != nil {
		return nil, err
	}
	return r.Body.Users.List, nil
}

// ErrWrongPassword means the administrator's own password was not accepted.
var ErrWrongPassword = errors.New("wrong password")

// ErrUserExists means that username is already taken.
var ErrUserExists = errors.New("username taken")

func (c *Client) postJSON(ctx context.Context, path, bearer string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("x-nd-authorization", "Bearer "+bearer)
	}
	return c.HTTP.Do(req)
}

// CreateUser adds a regular account. Subsonic's createUser is not implemented in Navidrome, and its own API only takes a
// session opened with a password, which Eco never keeps. So the administrator's password comes with each request, opens
// a session for this one call and is forgotten, along with the session. Errors never contain a password.
func (c *Client) CreateUser(ctx context.Context, admin, adminPassword, username, name, password string) error {
	resp, err := c.postJSON(ctx, "/auth/login", "", map[string]string{"username": admin, "password": adminPassword})
	if err != nil {
		return errors.New("could not reach Navidrome")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return ErrWrongPassword
	}
	var session struct {
		Token string `json:"token"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&session) != nil || session.Token == "" {
		return fmt.Errorf("could not sign in to Navidrome (HTTP %d)", resp.StatusCode)
	}

	created, err := c.postJSON(ctx, "/api/user", session.Token, map[string]any{"userName": username, "name": name, "email": "", "password": password, "isAdmin": false})
	if err != nil {
		return errors.New("could not reach Navidrome")
	}
	defer created.Body.Close()
	if created.StatusCode < 300 {
		return nil
	}
	var refusal struct {
		Errors map[string]string `json:"errors"`
	}
	if json.NewDecoder(created.Body).Decode(&refusal) == nil && refusal.Errors["userName"] == "ra.validation.unique" {
		return ErrUserExists
	}
	return fmt.Errorf("could not create the account (HTTP %d)", created.StatusCode)
}
