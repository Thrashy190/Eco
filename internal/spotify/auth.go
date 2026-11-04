package spotify

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

const tokenURL = "https://accounts.spotify.com/api/token"

// Scopes needed to read liked songs and (private) playlists.
const Scopes = "user-library-read playlist-read-private playlist-read-collaborative"

type tokenResponse struct {
	AccessToken  string  `json:"access_token"`
	RefreshToken string  `json:"refresh_token"`
	Scope        string  `json:"scope"`
	ExpiresIn    float64 `json:"expires_in"`
	ExpiresAt    float64 `json:"expires_at"`
}

func requestToken(ctx context.Context, form url.Values, basicID, basicSecret string) (tokenResponse, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if basicID != "" {
		req.SetBasicAuth(basicID, basicSecret)
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return tokenResponse{}, err
	}
	defer resp.Body.Close()
	var t tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&t); err != nil || t.AccessToken == "" {
		return t, fmt.Errorf("spotify rejected the credentials (HTTP %d)", resp.StatusCode)
	}
	t.ExpiresAt = float64(time.Now().Unix()) + t.ExpiresIn
	return t, nil
}

// AppCredentials authenticates as the app itself (no user): enough for search and track metadata.
type AppCredentials struct {
	ID, Secret string
	mu         sync.Mutex
	token      string
	expires    time.Time
}

// Token implements TokenSource.
func (a *AppCredentials) Token(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if time.Now().Before(a.expires) {
		return a.token, nil
	}
	if a.ID == "" || a.Secret == "" {
		return "", errors.New("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set")
	}
	t, err := requestToken(ctx, url.Values{"grant_type": {"client_credentials"}}, a.ID, a.Secret)
	if err != nil {
		return "", err
	}
	a.token, a.expires = t.AccessToken, time.Now().Add(time.Duration(t.ExpiresIn-60)*time.Second)
	return a.token, nil
}

// UserLogin authenticates as the user with the Authorization Code + PKCE flow and caches the
// token in CacheFile. The cache keeps the format of the previous Python tool, so existing logins survive.
type UserLogin struct {
	ClientID, RedirectURI, CacheFile string
	// Interactive allows opening the browser when there is no valid cached login.
	Interactive bool
	mu          sync.Mutex
}

func (u *UserLogin) load() (tokenResponse, bool) {
	var t tokenResponse
	data, err := os.ReadFile(u.CacheFile)
	if err != nil || json.Unmarshal(data, &t) != nil {
		return t, false
	}
	have := map[string]bool{}
	for _, s := range strings.Fields(t.Scope) {
		have[s] = true
	}
	for _, s := range strings.Fields(Scopes) {
		if !have[s] { // an older login without the playlist scopes is useless
			return t, false
		}
	}
	return t, true
}

func (u *UserLogin) save(t tokenResponse) error {
	data, _ := json.Marshal(t)
	return os.WriteFile(u.CacheFile, data, 0o600)
}

// Token implements TokenSource.
func (u *UserLogin) Token(ctx context.Context) (string, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if t, ok := u.load(); ok {
		if t.ExpiresAt > float64(time.Now().Unix()+60) {
			return t.AccessToken, nil
		}
		fresh, err := requestToken(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {t.RefreshToken}, "client_id": {u.ClientID}}, "", "")
		if err == nil {
			if fresh.RefreshToken == "" {
				fresh.RefreshToken = t.RefreshToken
			}
			if fresh.Scope == "" {
				fresh.Scope = t.Scope
			}
			return fresh.AccessToken, u.save(fresh)
		}
		fmt.Fprintln(os.Stderr, "Your Spotify login expired; signing in again.")
	}
	if !u.Interactive {
		return "", errors.New("no Spotify user login: run `eco likes export` once to sign in")
	}
	t, err := u.authorize(ctx)
	if err != nil {
		return "", err
	}
	return t.AccessToken, u.save(t)
}

func randomString(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (u *UserLogin) authorize(ctx context.Context) (tokenResponse, error) {
	verifier, state := randomString(64), randomString(16)
	sum := sha256.Sum256([]byte(verifier))
	authURL := "https://accounts.spotify.com/authorize?" + url.Values{
		"client_id": {u.ClientID}, "response_type": {"code"}, "redirect_uri": {u.RedirectURI}, "scope": {Scopes},
		"code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "state": {state},
	}.Encode()

	redirect, err := url.Parse(u.RedirectURI)
	if err != nil {
		return tokenResponse{}, err
	}
	ln, err := net.Listen("tcp", redirect.Host)
	if err != nil {
		return tokenResponse{}, fmt.Errorf("cannot listen on %s for the Spotify callback: %w", redirect.Host, err)
	}
	got := make(chan url.Values, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != redirect.Path {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, "<h2>Done, you can go back to the terminal.</h2>")
		select {
		case got <- r.URL.Query():
		default:
		}
	})}
	go srv.Serve(ln)
	defer srv.Close()

	fmt.Fprintf(os.Stderr, "Open this link to let Eco read your liked songs and playlists:\n  %s\n\n", authURL)
	openBrowser(authURL)

	select {
	case q := <-got:
		if e := q.Get("error"); e != "" || q.Get("state") != state {
			return tokenResponse{}, fmt.Errorf("authorization cancelled or invalid (%s)", e)
		}
		return requestToken(ctx, url.Values{"grant_type": {"authorization_code"}, "code": {q.Get("code")}, "redirect_uri": {u.RedirectURI}, "client_id": {u.ClientID}, "code_verifier": {verifier}}, "", "")
	case <-ctx.Done():
		return tokenResponse{}, ctx.Err()
	case <-time.After(5 * time.Minute):
		return tokenResponse{}, errors.New("timed out waiting for the Spotify login")
	}
}

func openBrowser(link string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", link)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", link)
	default:
		cmd = exec.Command("xdg-open", link)
	}
	cmd.Start() // best effort: the link is printed too
}
