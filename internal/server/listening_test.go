package server

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/connect"
)

// report says what a device of user plays, as the app does.
func report(t *testing.T, h http.Handler, user, device, state string) {
	t.Helper()
	if rec := as(t, h, user, "POST", "/api/connect/state?device="+device, state); rec.Code != http.StatusOK {
		t.Fatalf("report: %d %s", rec.Code, rec.Body)
	}
}

const playingAlpha = `{"song":{"id":"a","title":"Alpha","artist":"X","album":"One","albumId":"a-One","starred":"2024-01-01T00:00:00Z"},"playing":true,"position":12,"volume":0.4,"upcoming":[{"id":"secret","title":"Next"}]}`

// listeningStream reads someone's stream of who plays what, one event at a time.
type listeningStream struct {
	t      *testing.T
	events chan [2]string
}

func watchListening(t *testing.T, h http.Handler, user string) *listeningStream {
	t.Helper()
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	resp, err := http.Get(server.URL + "/api/listening/events?u=" + user + "&t=token&s=salt")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	stream := &listeningStream{t, make(chan [2]string, 16)}
	go func() {
		lines := bufio.NewScanner(resp.Body)
		name := ""
		for lines.Scan() {
			line := lines.Text()
			if after, ok := strings.CutPrefix(line, "event: "); ok {
				name = after
			} else if after, ok := strings.CutPrefix(line, "data: "); ok {
				stream.events <- [2]string{name, after}
			}
		}
	}()
	return stream
}

func (s *listeningStream) next() (string, string) {
	s.t.Helper()
	select {
	case e := <-s.events:
		return e[0], e[1]
	case <-time.After(2 * time.Second):
		s.t.Fatal("no event")
		return "", ""
	}
}

func (s *listeningStream) nextAbout() listeningOut {
	s.t.Helper()
	name, data := s.next()
	var out listeningOut
	if name != "listening" || json.Unmarshal([]byte(data), &out) != nil {
		s.t.Fatalf("event %s: %s", name, data)
	}
	return out
}

// Everyone on the server sees what the others play as it happens, and only the song: none of the rest a device
// reports (its queue, volume, someone's hearts). Hiding it answers like nothing playing; hiding the whole profile sends
// nothing at all.
func TestPeopleSeeWhatOthersPlay(t *testing.T) {
	_, s := libraryServerOf(t, song("a", "Alpha", "X", "One"))
	h := s.Handler()
	for _, user := range []string{"ana", "luis"} {
		as(t, h, user, "GET", "/api/me/library", "")
	}
	_, leave, err := s.hub.Join("ana", connect.Info{ID: "ana-phone-1"})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = s.hub.Join("luis", connect.Info{ID: "luis-phone-1"})
	if err != nil {
		t.Fatal(err)
	}
	report(t, h, "ana", "ana-phone-1", playingAlpha)

	rec := as(t, h, "luis", "GET", "/api/listening", "")
	body := rec.Body.String()
	if !strings.Contains(body, `"title":"Alpha"`) || !strings.Contains(body, `"position":12`) {
		t.Fatalf("luis does not see ana playing: %s", body)
	}
	for _, private := range []string{"secret", "volume", "starred", "upcoming"} {
		if strings.Contains(body, private) {
			t.Errorf("a device's %s reached someone else: %s", private, body)
		}
	}

	luis := watchListening(t, h, "luis")
	if name, data := luis.next(); name != "snapshot" || !strings.Contains(data, `"user":"ana"`) {
		t.Fatalf("first event: %s %s", name, data)
	}
	// The same song a moment later is no news; another song is
	report(t, h, "ana", "ana-phone-1", strings.Replace(playingAlpha, `"position":12`, `"position":13`, 1))
	report(t, h, "ana", "ana-phone-1", `{"song":{"id":"b","title":"Beta","artist":"X"},"playing":true,"position":0}`)
	if got := luis.nextAbout(); got.User != "ana" || got.Song == nil || got.Song.Title != "Beta" {
		t.Errorf("another song: %+v", got)
	}
	report(t, h, "ana", "ana-phone-1", `{"song":{"id":"b","title":"Beta","artist":"X"},"playing":false,"position":30}`)
	if got := luis.nextAbout(); got.Song != nil {
		t.Errorf("paused, still shown: %+v", got.Song)
	}

	// Hidden: like nothing playing
	report(t, h, "ana", "ana-phone-1", playingAlpha)
	if got := luis.nextAbout(); got.Song == nil {
		t.Error("playing again, not shown")
	}
	as(t, h, "ana", "PUT", "/api/me/profile", `{"privacy":{"hide_listening":true}}`)
	if got := luis.nextAbout(); got.User != "ana" || got.Song != nil {
		t.Errorf("hidden listening still shown: %+v", got)
	}
	if body := as(t, h, "luis", "GET", "/api/listening", "").Body.String(); strings.Contains(body, "Alpha") {
		t.Errorf("hidden listening in the list: %s", body)
	}
	if body := as(t, h, "ana", "GET", "/api/listening", "").Body.String(); !strings.Contains(body, "Alpha") {
		t.Errorf("ana cannot see her own: %s", body)
	}

	// A hidden profile sends nothing: the next thing Luis hears is about himself
	as(t, h, "ana", "PUT", "/api/me/profile", `{"privacy":{"hide_profile":true}}`)
	report(t, h, "ana", "ana-phone-1", `{"song":{"id":"c","title":"Gamma"},"playing":true,"position":0}`)
	report(t, h, "luis", "luis-phone-1", playingAlpha)
	if got := luis.nextAbout(); got.User != "luis" {
		t.Errorf("luis heard about a hidden profile: %+v", got)
	}

	// A device that leaves takes its song with it
	as(t, h, "ana", "PUT", "/api/me/profile", `{}`)
	if got := luis.nextAbout(); got.User != "ana" || got.Song == nil || got.Song.Title != "Gamma" {
		t.Errorf("shown again: %+v", got)
	}
	leave()
	if got := luis.nextAbout(); got.User != "ana" || got.Song != nil {
		t.Errorf("after the device left: %+v", got)
	}
}

func TestNewsIsASongChangeOrASeek(t *testing.T) {
	at := time.Now()
	a := connect.Listening{Song: connect.NowSong{ID: "a", Title: "A"}, Position: 10, At: at}
	later := a
	later.Position, later.At = 25, at.Add(15*time.Second)
	if news(a, true, later, true) {
		t.Error("the song moving on with the clock is no news")
	}
	seek := later
	seek.Position = 90
	if !news(a, true, seek, true) {
		t.Error("a seek is news")
	}
	other := later
	other.Song = connect.NowSong{ID: "b", Title: "B"}
	if !news(a, true, other, true) || !news(a, true, connect.Listening{}, false) || news(connect.Listening{}, false, connect.Listening{}, false) {
		t.Error("starting, stopping and another song")
	}
}
