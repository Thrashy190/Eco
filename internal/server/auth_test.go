package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
)

// The web app signs people out on a 401 and the TV asks to be paired again, so a Navidrome that is restarting (an
// update, a crash) must not look like a wrong password. Only codes 40 and 41 mean the sign-in was refused.
func TestNavidromeNotAnsweringIsNotAWrongPassword(t *testing.T) {
	reply := func(status int, body string) func() string {
		return func() string {
			nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				w.Write([]byte(body))
			}))
			t.Cleanup(nd.Close)
			return nd.URL
		}
	}
	unreachable := func() string {
		nd := httptest.NewServer(http.NotFoundHandler())
		url := nd.URL
		nd.Close()
		return url
	}

	cases := []struct {
		name string
		url  func() string
		want int
	}{
		{"wrong password", reply(200, `{"subsonic-response":{"status":"failed","error":{"code":40,"message":"Wrong username or password"}}}`), http.StatusUnauthorized},
		{"token not supported", reply(200, `{"subsonic-response":{"status":"failed","error":{"code":41,"message":"Token authentication not supported for LDAP users."}}}`), http.StatusUnauthorized},
		{"wrong password, other wording", reply(200, `{"subsonic-response":{"status":"failed","error":{"code":40,"message":"Invalid credentials"}}}`), http.StatusUnauthorized},
		{"generic error", reply(200, `{"subsonic-response":{"status":"failed","error":{"code":0,"message":"database is locked"}}}`), http.StatusBadGateway},
		{"not Subsonic", reply(200, `<html>Sign in</html>`), http.StatusBadGateway},
		{"bad gateway page", reply(502, `<html>Bad Gateway</html>`), http.StatusBadGateway},
		{"unreachable", unreachable, http.StatusBadGateway},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			navidrome := c.url()
			cfg := &config.Config{NavidromeURL: navidrome, MediaDir: t.TempDir(), UsersDir: t.TempDir()}
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
			if err != nil {
				t.Fatal(err)
			}
			rec := call(t, s.Handler(), "GET", "/api/me/library", "")
			if rec.Code != c.want {
				t.Errorf("status = %d, want %d (%s)", rec.Code, c.want, rec.Body)
			}
			body := rec.Body.String()
			if c.want == http.StatusBadGateway && strings.Contains(strings.ToLower(body), "wrong username or password") {
				t.Errorf("body blames the password: %s", body)
			}
			// Go's errors for a failed request carry its URL, which holds the credentials (t, s) and Navidrome's address
			if strings.Contains(body, "token") || strings.Contains(body, "salt") || strings.Contains(body, strings.TrimPrefix(navidrome, "http://")) {
				t.Errorf("body gives away the request: %s", body)
			}
		})
	}
}

// A sign-in Navidrome could not check is not remembered as good: once Navidrome answers again, the same credentials are
// checked again, and refused if they are wrong.
func TestNavidromeNotAnsweringRemembersNothing(t *testing.T) {
	var answer atomic.Value
	answer.Store("down")
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch answer.Load() {
		case "down":
			w.WriteHeader(http.StatusBadGateway)
		case "refused":
			w.Write([]byte(`{"subsonic-response":{"status":"failed","error":{"code":40,"message":"Wrong username or password"}}}`))
		default:
			w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
		}
	}))
	t.Cleanup(nd.Close)
	cfg := &config.Config{NavidromeURL: nd.URL, MediaDir: t.TempDir(), UsersDir: t.TempDir()}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	for _, step := range []struct {
		navidrome string
		want      int
	}{{"down", http.StatusBadGateway}, {"refused", http.StatusUnauthorized}, {"ok", http.StatusOK}} {
		answer.Store(step.navidrome)
		if rec := call(t, h, "GET", "/api/me/library", ""); rec.Code != step.want {
			t.Fatalf("Navidrome %s: status = %d, want %d (%s)", step.navidrome, rec.Code, step.want, rec.Body)
		}
	}
}
