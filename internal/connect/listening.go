package connect

import (
	"encoding/json"
	"strings"
	"time"
)

// What someone is listening to, for the people on the same server to see (server/listening.go). Devices report far more
// to each other; only the song and whether it plays are read here, and nothing else of a report leaves the account.

// fresh is how long a report says what a device plays. Playing devices report every 15 seconds, so one silent for longer
// is asleep or gone, whatever it said last.
const fresh = time.Minute

// maxText keeps one person's report from filling everybody's screens.
const maxText = 200

// NowSong is the song a device plays, as it described it.
type NowSong struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist,omitempty"`
	ArtistID string  `json:"artistId,omitempty"`
	Album    string  `json:"album,omitempty"`
	AlbumID  string  `json:"albumId,omitempty"`
	Cover    string  `json:"cover,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	MediaID  string  `json:"mediaId,omitempty"` // imported audio, which Eco serves itself
	Kind     string  `json:"kind,omitempty"`
}

// Listening is what one person plays: the song of their device that reported last while playing.
type Listening struct {
	Song     NowSong
	Position float64   // seconds into the song when it was reported
	At       time.Time // when it was reported
}

func cut(text string) string {
	text = strings.TrimSpace(text)
	if runes := []rune(text); len(runes) > maxText {
		return string(runes[:maxText])
	}
	return text
}

// readPlaying reads the song a device reports playing. ok is false when it plays nothing.
func readPlaying(state json.RawMessage) (song NowSong, position float64, ok bool) {
	var report struct {
		Song     *NowSong `json:"song"`
		Playing  bool     `json:"playing"`
		Position float64  `json:"position"`
	}
	if json.Unmarshal(state, &report) != nil || report.Song == nil || !report.Playing {
		return NowSong{}, 0, false
	}
	s := *report.Song
	s.ID, s.Title, s.Artist, s.ArtistID = cut(s.ID), cut(s.Title), cut(s.Artist), cut(s.ArtistID)
	s.Album, s.AlbumID, s.Cover, s.MediaID, s.Kind = cut(s.Album), cut(s.AlbumID), cut(s.Cover), cut(s.MediaID), cut(s.Kind)
	if s.ID == "" || s.Title == "" {
		return NowSong{}, 0, false
	}
	return s, max(report.Position, 0), true
}

// Listening returns what this person plays now, if anything: among their devices that are playing and reported within
// the last minute, the one that reported last.
func (h *Hub) Listening(user string) (Listening, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.listening(user, time.Now())
}

func (h *Hub) listening(user string, now time.Time) (Listening, bool) {
	var best Listening
	found := false
	for _, c := range h.users[key(user)] {
		if c.state == nil || now.Sub(c.at) > fresh || (found && !c.at.After(best.At)) {
			continue
		}
		if song, position, ok := readPlaying(c.state); ok {
			best, found = Listening{Song: song, Position: position, At: c.at}, true
		}
	}
	return best, found
}

// OnChange is told about a person whose devices changed what they play, or left. It runs on its own goroutine.
func (h *Hub) OnChange(fn func(user string)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.changed = fn
}

// tell calls the OnChange function; h.mu must be held.
func (h *Hub) tell(user string) {
	if fn := h.changed; fn != nil {
		go fn(user)
	}
}
