// Package stats keeps what people play on this server, for the statistics page. There is no database: plays are lines of
// JSON in one file, appended as they happen and read once into memory. A home server's listening fits easily: a hundred
// thousand plays are a few tens of megabytes.
//
// Navidrome only tells each person their own play counts, so Eco counts plays itself as they pass through it
// (/rest/scrobble). What a person played before that is imported once from their own Navidrome counts (Import): those
// have a count and the day of the last play, but no date for each play.
package stats

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Play is one song played to the point it counts (half of it, or 30 seconds on a long one, as Navidrome counts it).
type Play struct {
	At       time.Time `json:"at"`
	User     string    `json:"user"`
	SongID   string    `json:"song"`
	Title    string    `json:"title"`
	Artists  []string  `json:"artists"`
	Album    string    `json:"album,omitempty"`
	AlbumID  string    `json:"album_id,omitempty"`
	Cover    string    `json:"cover,omitempty"`
	Genres   []string  `json:"genres,omitempty"`
	Duration int       `json:"duration"` // seconds
	// Count is more than one only for imported history, which has one line per song.
	Count int `json:"count,omitempty"`
	// Imported marks history from Navidrome: At is when the song was last played, not when each play was.
	Imported bool `json:"imported,omitempty"`
}

// times is how many plays the line stands for.
func (p Play) times() int {
	if p.Count > 1 {
		return p.Count
	}
	return 1
}

// sameAgain is how soon the same song from the same person counts as the same play: a client sending it twice.
const sameAgain = time.Minute

// Store is the file of plays.
type Store struct {
	Dir string

	mu       sync.Mutex
	loaded   bool
	plays    []Play
	imported map[string]time.Time // lower-case user → when their Navidrome history was imported
	last     map[string]time.Time // lower-case user + song → the last play counted
}

func (s *Store) playsPath() string    { return filepath.Join(s.Dir, "plays.jsonl") }
func (s *Store) importedPath() string { return filepath.Join(s.Dir, "imported.json") }

// key is how a user is told apart: Navidrome usernames do not depend on capitals.
func key(user string) string { return strings.ToLower(user) }

func (s *Store) load() error {
	if s.loaded {
		return nil
	}
	s.imported, s.last = map[string]time.Time{}, map[string]time.Time{}
	if data, err := os.ReadFile(s.importedPath()); err == nil {
		if err := json.Unmarshal(data, &s.imported); err != nil {
			return errors.New("the statistics file imported.json is unreadable")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.Open(s.playsPath())
	if errors.Is(err, os.ErrNotExist) {
		s.loaded = true
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	lines := bufio.NewScanner(f)
	lines.Buffer(make([]byte, 64<<10), 1<<20)
	for lines.Scan() {
		var p Play
		if json.Unmarshal(lines.Bytes(), &p) != nil || p.User == "" {
			continue // a line cut short when the server stopped mid-write: the rest still counts
		}
		s.plays = append(s.plays, p)
		if !p.Imported {
			s.last[key(p.User)+"|"+p.SongID] = p.At
		}
	}
	s.loaded = true
	return lines.Err()
}

func (s *Store) append(plays []Play) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(s.playsPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	var buf strings.Builder
	for _, p := range plays {
		line, _ := json.Marshal(p)
		buf.Write(line)
		buf.WriteByte('\n')
	}
	if _, err := f.WriteString(buf.String()); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// Add counts a play. It reports false when the same person's same song was counted less than a minute before.
func (s *Store) Add(p Play) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return false, err
	}
	k := key(p.User) + "|" + p.SongID
	if prev, ok := s.last[k]; ok && p.At.Sub(prev) < sameAgain && prev.Sub(p.At) < sameAgain {
		return false, nil
	}
	p.Count, p.Imported = 0, false
	if err := s.append([]Play{p}); err != nil {
		return false, err
	}
	s.plays = append(s.plays, p)
	s.last[k] = p.At
	return true, nil
}

// Imported reports whether this user's history was imported already.
func (s *Store) Imported(user string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.load() != nil {
		return true // the files cannot be read: importing again could count everything twice
	}
	_, ok := s.imported[key(user)]
	return ok
}

// Import adds what a user played before Eco counted, read from their Navidrome play counts at the time given. Plays Eco
// counted for them before then are already in those counts, so summaries leave them out. It happens once per user.
func (s *Store) Import(user string, at time.Time, history []Play) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	if _, ok := s.imported[key(user)]; ok {
		return nil
	}
	for i := range history {
		history[i].User, history[i].Imported = user, true
	}
	if len(history) > 0 {
		if err := s.append(history); err != nil {
			return err
		}
	}
	s.imported[key(user)] = at
	data, _ := json.Marshal(s.imported)
	tmp := s.importedPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.importedPath()); err != nil {
		return err
	}
	s.plays = append(s.plays, history...)
	return nil
}

// Snapshot returns every play, and when each user's history was imported, for Summarize. The slice must not be changed.
func (s *Store) Snapshot() ([]Play, map[string]time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return nil, nil, err
	}
	imported := make(map[string]time.Time, len(s.imported))
	for k, v := range s.imported {
		imported[k] = v
	}
	return s.plays[:len(s.plays):len(s.plays)], imported, nil
}
