package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/media"
)

// fakeAccounts answers as a Navidrome where only the user "admin" is an administrator.
func fakeAccounts(t *testing.T) *httptest.Server {
	t.Helper()
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/getUser") {
			admin := r.URL.Query().Get("u") == "admin"
			json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok", "user": map[string]any{"adminRole": admin}}})
			return
		}
		w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
	}))
	t.Cleanup(nd.Close)
	return nd
}

func accountsServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{NavidromeURL: fakeAccounts(t).URL, MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music")}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Handler()
}

func as(t *testing.T, h http.Handler, user, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path+sep+"u="+user+"&t=token&s=salt", strings.NewReader(body)))
	return rec
}

func TestOnlyAdminsDelete(t *testing.T) {
	s, h := accountsServer(t)
	item := media.Item{ID: "dQw4w9WgXcQ", Kind: "podcast", Title: "Episode", File: "media.m4a"}
	if err := os.MkdirAll(s.media.Dir(item.Kind, item.ID), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.media.Save(item); err != nil {
		t.Fatal(err)
	}

	for _, target := range []string{"/api/media/" + item.ID, "/api/admin/songs/some-song"} {
		if rec := as(t, h, "ana", "DELETE", target, ""); rec.Code != http.StatusForbidden {
			t.Errorf("a normal user deleting %s: %d %s", target, rec.Code, rec.Body)
		}
	}
	if _, err := s.media.Find(item.ID); err != nil {
		t.Fatal("a normal user's request removed the item")
	}
	if rec := as(t, h, "admin", "DELETE", "/api/media/"+item.ID, ""); rec.Code != http.StatusOK {
		t.Errorf("admin deleting: %d %s", rec.Code, rec.Body)
	}
	if _, err := s.media.Find(item.ID); err == nil {
		t.Error("the item is still there")
	}
}

func TestMeTellsWhoIsAdmin(t *testing.T) {
	s, h := accountsServer(t)
	s.cfg.Version = "v1.3.0"
	if body := as(t, h, "ana", "GET", "/api/me", "").Body.String(); !strings.Contains(body, `"version":"v1.3.0"`) {
		t.Errorf("the version is missing: %s", body)
	}
	for user, want := range map[string]bool{"admin": true, "ana": false} {
		var out struct {
			Admin bool `json:"admin"`
		}
		json.Unmarshal(as(t, h, user, "GET", "/api/me", "").Body.Bytes(), &out)
		if out.Admin != want {
			t.Errorf("%s: admin = %v", user, out.Admin)
		}
	}
}

func TestJobsAreOnlyVisibleToWhoAskedForThem(t *testing.T) {
	s, h := accountsServer(t)
	block := make(chan struct{})
	t.Cleanup(func() { close(block) })
	s.jobs = jobs.NewManager(context.Background(), func(ctx context.Context, _ jobs.Job, _ any, _ func(func(*jobs.Job))) error { <-block; return nil })
	s.jobs.Submit("7kW0cpKgSVsEqcc8xgbSb0", "ana", nil)

	list := func(user string) string { return as(t, h, user, "GET", "/api/jobs", "").Body.String() }
	if !strings.Contains(list("ana"), "7kW0cpKgSVsEqcc8xgbSb0") {
		t.Error("ana does not see her own download")
	}
	if strings.Contains(list("diego"), "7kW0cpKgSVsEqcc8xgbSb0") {
		t.Error("diego sees ana's download")
	}
	// Two people asking for one song share the job, and both follow it
	s.jobs.Submit("7kW0cpKgSVsEqcc8xgbSb0", "diego", nil)
	if !strings.Contains(list("diego"), "7kW0cpKgSVsEqcc8xgbSb0") {
		t.Error("diego cannot follow the song he asked for")
	}
	if strings.Contains(list("diego"), `"user"`) {
		t.Error("a job reveals who else asked for it")
	}
}

// One real stream per user, through the real handlers: nothing may cross from one account to the other.
func TestConnectThroughTheServerStaysWithinOneUser(t *testing.T) {
	_, handler := accountsServer(t)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	open := func(user, device string) chan string {
		req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/connect/events?u="+user+"&t=x&s=y&name=Test&device="+device, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		lines := make(chan string, 64)
		go func() {
			sc := bufio.NewScanner(resp.Body)
			for sc.Scan() {
				lines <- sc.Text()
			}
		}()
		return lines
	}
	post := func(user, device, path, body string) int {
		req, _ := http.NewRequestWithContext(ctx, "POST", srv.URL+path+"?u="+user+"&t=x&s=y&device="+device, strings.NewReader(body))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}
	waitFor := func(lines chan string, text string) bool {
		for {
			select {
			case l := <-lines:
				if strings.Contains(l, text) {
					return true
				}
			case <-time.After(700 * time.Millisecond):
				return false
			}
		}
	}

	phone, laptop, stranger := open("diego", "diego-phone"), open("diego", "diego-laptop"), open("ana", "ana-laptop1")
	if !waitFor(phone, "diego-phone") || !waitFor(laptop, "diego-laptop") || !waitFor(stranger, "ana-laptop1") {
		t.Fatal("the devices did not connect")
	}

	if code := post("diego", "diego-phone", "/api/connect/command", `{"target":"diego-laptop","action":"pause"}`); code != 200 {
		t.Fatalf("command: %d", code)
	}
	if !waitFor(laptop, `"action":"pause"`) {
		t.Error("the laptop did not receive the command")
	}
	if code := post("diego", "diego-phone", "/api/connect/command", `{"target":"ana-laptop1","action":"pause"}`); code != http.StatusNotFound {
		t.Errorf("a command to another user's device: %d", code)
	}
	if code := post("diego", "ana-laptop1", "/api/connect/state", `{"song":"spoofed"}`); code != http.StatusNotFound {
		t.Errorf("reporting as another user's device: %d", code)
	}
	if code := post("diego", "diego-phone", "/api/connect/command", `{"target":"diego-laptop","action":"rm -rf"}`); code != http.StatusBadRequest {
		t.Errorf("an unknown action: %d", code)
	}
	if code := post("diego", "diego-phone", "/api/connect/state", `{"song":"my private song"}`); code != 200 {
		t.Fatalf("state: %d", code)
	}
	if !waitFor(laptop, "my private song") {
		t.Error("the laptop did not see what plays")
	}
	if waitFor(stranger, "my private song") {
		t.Error("another user saw what diego is playing")
	}
}
