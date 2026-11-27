package connect

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// What someone plays is the song of their device that reported last while playing, and a report older than a minute
// says nothing: playing devices report every 15 seconds.
func TestListeningPicksTheDeviceThatPlays(t *testing.T) {
	h := NewHub()
	for _, id := range []string{"phone-0001", "laptop-001", "tv-0000001"} {
		if _, _, err := h.Join("ana", Info{ID: id}); err != nil {
			t.Fatal(err)
		}
	}
	state := func(title string, playing bool) json.RawMessage {
		return json.RawMessage(`{"song":{"id":"` + strings.ToLower(title) + `","title":"` + title + `"},"playing":` + map[bool]string{true: "true", false: "false"}[playing] + `,"position":3}`)
	}
	if _, ok := h.Listening("ana"); ok {
		t.Fatal("nothing reported yet")
	}
	h.Report("ana", "phone-0001", state("Alpha", true))
	h.Report("ana", "laptop-001", state("Beta", false))
	if got, ok := h.Listening("ANA"); !ok || got.Song.Title != "Alpha" || got.Position != 3 {
		t.Errorf("got %+v %v, want the phone's Alpha", got, ok)
	}
	h.Report("ana", "tv-0000001", state("Gamma", true))
	if got, _ := h.Listening("ana"); got.Song.Title != "Gamma" {
		t.Errorf("got %s, want the newest playing report", got.Song.Title)
	}
	h.mu.Lock()
	got, ok := h.listening("ana", time.Now().Add(2*time.Minute))
	h.mu.Unlock()
	if ok {
		t.Errorf("stale reports still play: %+v", got)
	}
	if _, ok := h.Listening("luis"); ok {
		t.Error("someone else's devices")
	}
}

func TestReadPlayingKeepsOnlyTheSong(t *testing.T) {
	long := strings.Repeat("x", 500)
	song, _, ok := readPlaying(json.RawMessage(`{"song":{"id":"a","title":"` + long + `","starred":"2024"},"playing":true,"upcoming":[1]}`))
	if !ok || len([]rune(song.Title)) != maxText {
		t.Errorf("title not cut: %d", len(song.Title))
	}
	for _, bad := range []string{`{}`, `not json`, `{"song":null,"playing":true}`, `{"song":{"id":"a"},"playing":true}`, `{"song":{"id":"a","title":"A"},"playing":false}`} {
		if _, _, ok := readPlaying(json.RawMessage(bad)); ok {
			t.Errorf("%s read as playing", bad)
		}
	}
}
