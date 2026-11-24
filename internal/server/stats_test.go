package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
)

// fakeListening answers as a Navidrome with two songs, where "admin" is the administrator and the token "bad" is a wrong
// password. Each person's play counts are their own, and a scrobble adds to them at once, as in Navidrome: Ana played
// Espresso three times before Eco counted.
func fakeListening(t *testing.T) *httptest.Server {
	t.Helper()
	songs := map[string]map[string]any{
		"titi":     {"id": "titi", "title": "Tití Me Preguntó", "artist": "Bad Bunny", "album": "Un Verano Sin Ti", "albumId": "uvst", "duration": 240, "genre": "Reggaeton"},
		"espresso": {"id": "espresso", "title": "Espresso", "artist": "Sabrina Carpenter", "album": "Espresso", "albumId": "esp", "duration": 175, "genre": "Pop"},
	}
	var mu sync.Mutex
	counts := map[string]int{"ana|espresso": 3}
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		q := r.URL.Query()
		ok := map[string]any{"status": "ok"}
		switch {
		case q.Get("t") == "bad":
			ok = map[string]any{"status": "failed", "error": map[string]any{"code": 40, "message": "Wrong username or password"}}
		case strings.HasSuffix(r.URL.Path, "/scrobble") || strings.HasSuffix(r.URL.Path, "/scrobble.view"):
			if q.Get("submission") != "false" {
				counts[q.Get("u")+"|"+q.Get("id")]++
			}
		case strings.HasSuffix(r.URL.Path, "/getUser"):
			ok["user"] = map[string]any{"adminRole": q.Get("u") == "admin"}
		case strings.HasSuffix(r.URL.Path, "/getSong"):
			ok["song"] = songs[q.Get("id")]
		case strings.HasSuffix(r.URL.Path, "/search3"):
			var list []map[string]any
			if q.Get("songOffset") == "0" {
				for _, s := range songs {
					copied := map[string]any{}
					for k, v := range s {
						copied[k] = v
					}
					if n := counts[q.Get("u")+"|"+s["id"].(string)]; n > 0 {
						copied["playCount"], copied["played"] = n, "2026-10-01T20:00:00Z"
					}
					list = append(list, copied)
				}
			}
			ok["searchResult3"] = map[string]any{"song": list}
		}
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": ok})
	}))
	t.Cleanup(nd.Close)
	return nd
}

func listeningServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{NavidromeURL: fakeListening(t).URL, MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), StatsDir: filepath.Join(dir, "stats"), MusicDir: filepath.Join(dir, "music")}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Handler()
}

// waitForPlays waits for the plays counted in the background.
func waitForPlays(t *testing.T, s *Server, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		plays, _, _ := s.stats.Snapshot()
		if len(plays) >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d plays counted, want %d", len(plays), want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type statsAnswer struct {
	Admin   bool     `json:"admin"`
	People  []string `json:"people"`
	Summary struct {
		Totals struct {
			Plays, Listeners int
		} `json:"totals"`
		Songs []struct {
			Name  string `json:"name"`
			Plays int    `json:"plays"`
		} `json:"songs"`
		Listeners []struct {
			User string `json:"user"`
		} `json:"listeners"`
		Recent []struct {
			User string `json:"user"`
		} `json:"recent"`
	} `json:"summary"`
}

func statsOf(t *testing.T, h http.Handler, user, query string) statsAnswer {
	t.Helper()
	rec := as(t, h, user, "GET", "/api/stats?"+query, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var out statsAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPlaysPassingThroughAreCounted(t *testing.T) {
	s, h := listeningServer(t)
	if rec := as(t, h, "ana", "GET", "/rest/scrobble?id=titi&submission=true&f=json", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("Navidrome's answer must reach the app: %d %s", rec.Code, rec.Body)
	}
	// What Ana played before is imported once, before her first play counts
	waitForPlays(t, s, 2)
	// "Now playing" is not a play, and a wrong password counts nothing
	as(t, h, "ana", "GET", "/rest/scrobble?id=espresso&submission=false&f=json", "")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/rest/scrobble?id=espresso&u=luis&t=bad&s=salt&f=json", nil))
	as(t, h, "luis", "GET", "/rest/scrobble.view?id=espresso&f=json", "")
	waitForPlays(t, s, 3)
	time.Sleep(100 * time.Millisecond) // the plays that must not count have had their chance
	plays, _, _ := s.stats.Snapshot()
	if len(plays) != 3 {
		t.Fatalf("plays = %+v", plays)
	}
	everyone := statsOf(t, h, "admin", "range=all")
	if everyone.Summary.Totals.Plays != 5 || everyone.Summary.Totals.Listeners != 2 || len(everyone.People) != 2 {
		t.Errorf("everyone: %+v", everyone)
	}
	if everyone.Summary.Songs[0].Name != "Espresso" || everyone.Summary.Songs[0].Plays != 4 {
		t.Errorf("top songs: %+v", everyone.Summary.Songs)
	}
	// Imported history has no dates: the last week only holds what Eco counted
	if week := statsOf(t, h, "admin", "range=7d"); week.Summary.Totals.Plays != 2 {
		t.Errorf("week: %+v", week.Summary.Totals)
	}
}

// Accounts do not see each other: someone who is not an administrator only ever gets their own numbers.
func TestOnlyAnAdministratorSeesOtherPeoplesListening(t *testing.T) {
	s, h := listeningServer(t)
	as(t, h, "ana", "GET", "/rest/scrobble?id=titi&f=json", "")
	waitForPlays(t, s, 2)
	as(t, h, "luis", "GET", "/rest/scrobble?id=espresso&f=json", "")
	waitForPlays(t, s, 3)
	for _, query := range []string{"range=all", "range=all&user=ana", "range=all&user="} {
		got := statsOf(t, h, "luis", query)
		if got.Admin || got.People != nil || len(got.Summary.Listeners) != 0 || got.Summary.Totals.Plays != 1 || got.Summary.Songs[0].Name != "Espresso" {
			t.Errorf("%s: %+v", query, got)
		}
		for _, r := range got.Summary.Recent {
			if r.User != "luis" {
				t.Errorf("%s: Luis sees a play of %s", query, r.User)
			}
		}
	}
	if got := statsOf(t, h, "admin", "range=all&user=ana"); got.Summary.Totals.Plays != 4 || len(got.Summary.Listeners) != 0 {
		t.Errorf("an administrator looking at Ana: %+v", got.Summary.Totals)
	}
}
