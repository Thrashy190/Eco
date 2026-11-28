package userdata

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// What a person keeps about podcasts and audiobooks, in spoken.json: where they are in each item, and their marks.
// A mark is a bookmark, a moment to come back to, and a note when it has text. Notes are private unless the person
// shares one: then everyone who opens that item sees it, with their name.

// Progress is where someone is in one item. At is when that was true, in milliseconds on the device that said so:
// an older report (a phone coming back online) never replaces a newer one.
type Progress struct {
	Position float64 `json:"position"`
	Finished bool    `json:"finished,omitempty"`
	At       int64   `json:"at"`
}

// Mark is a bookmark or a note at a moment of an item.
type Mark struct {
	ID      string  `json:"id"`
	Item    string  `json:"item"` // the media item's ID
	At      float64 `json:"at"`   // seconds into it
	Note    string  `json:"note,omitempty"`
	Shared  bool    `json:"shared,omitempty"`
	Created int64   `json:"created"`
	Updated int64   `json:"updated"`
}

// SharedMark is someone else's shared note, with who wrote it.
type SharedMark struct {
	Mark
	User string `json:"user"`
	Name string `json:"name,omitempty"`
}

type spoken struct {
	Progress map[string]Progress `json:"progress"`
	Marks    []Mark              `json:"marks"`
}

const (
	MaxNote  = 5000
	maxMarks = 5000
	// Kept for items heard in the last while: a long-forgotten one needs no place.
	maxProgress = 2000
)

func (s *Store) spokenPath(user string) string { return filepath.Join(s.dir(user), "spoken.json") }

func readSpoken(path string) spoken {
	sp := spoken{}
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &sp)
	}
	if sp.Progress == nil {
		sp.Progress = map[string]Progress{}
	}
	if sp.Marks == nil {
		sp.Marks = []Mark{}
	}
	return sp
}

func (s *Store) changeSpoken(user string, change func(*spoken) error) (spoken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sp := readSpoken(s.spokenPath(user))
	if err := change(&sp); err != nil {
		return sp, err
	}
	data, err := json.Marshal(sp)
	if err != nil {
		return sp, err
	}
	return sp, writeFile(s.spokenPath(user), data)
}

// writeFile replaces a file atomically.
func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// AllProgress returns where the person is in every item they started.
func (s *Store) AllProgress(user string) map[string]Progress {
	s.mu.Lock()
	defer s.mu.Unlock()
	return readSpoken(s.spokenPath(user)).Progress
}

// SetProgress records where the person is in an item, unless the store already knows something newer.
// It returns what is kept.
func (s *Store) SetProgress(user, item string, p Progress) (Progress, error) {
	if !ValidID(item) || p.Position < 0 || math.IsNaN(p.Position) || math.IsInf(p.Position, 0) {
		return Progress{}, errors.New("invalid progress")
	}
	if p.At <= 0 {
		p.At = time.Now().UnixMilli()
	}
	var kept Progress
	_, err := s.changeSpoken(user, func(sp *spoken) error {
		if old, ok := sp.Progress[item]; ok && old.At > p.At {
			kept = old
			return nil
		}
		sp.Progress[item], kept = p, p
		trimProgress(sp.Progress)
		return nil
	})
	return kept, err
}

// ForgetProgress removes an item from the person's progress: they start it over as if new.
func (s *Store) ForgetProgress(user, item string) error {
	_, err := s.changeSpoken(user, func(sp *spoken) error { delete(sp.Progress, item); return nil })
	return err
}

func trimProgress(all map[string]Progress) {
	if len(all) <= maxProgress {
		return
	}
	ids := make([]string, 0, len(all))
	for id := range all {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return all[ids[i]].At > all[ids[j]].At })
	for _, id := range ids[maxProgress:] {
		delete(all, id)
	}
}

func markID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func cleanNote(note string) string {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > MaxNote {
		note = string([]rune(note)[:MaxNote])
	}
	return note
}

// Marks returns the person's marks: of one item in the order they come in it, or all of them newest first.
func (s *Store) Marks(user, item string) []Mark {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Mark{}
	for _, m := range readSpoken(s.spokenPath(user)).Marks {
		if item == "" || m.Item == item {
			out = append(out, m)
		}
	}
	if item == "" {
		sort.SliceStable(out, func(i, j int) bool { return out[i].Created > out[j].Created }) // the newest first
	} else {
		sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	}
	return out
}

// AddMark keeps a new bookmark (or note, with text) for the person.
func (s *Store) AddMark(user string, m Mark) (Mark, error) {
	if !ValidID(m.Item) || m.At < 0 || math.IsNaN(m.At) || math.IsInf(m.At, 0) {
		return Mark{}, errors.New("invalid bookmark")
	}
	now := time.Now().UnixMilli()
	m.ID, m.Note, m.Created, m.Updated = markID(), cleanNote(m.Note), now, now
	m.At = math.Round(m.At*10) / 10
	m.Shared = m.Shared && m.Note != ""
	_, err := s.changeSpoken(user, func(sp *spoken) error {
		if len(sp.Marks) >= maxMarks {
			return errors.New("you have as many bookmarks as can be kept; delete some first")
		}
		sp.Marks = append(sp.Marks, m)
		return nil
	})
	return m, err
}

// ErrNoMark is returned for a mark the person does not have, whoever else might.
var ErrNoMark = errors.New("no such bookmark")

// EditMark changes a mark's text and whether it is shared. A mark with no text cannot be shared.
func (s *Store) EditMark(user, id string, note *string, shared *bool) (Mark, error) {
	var out Mark
	_, err := s.changeSpoken(user, func(sp *spoken) error {
		for i := range sp.Marks {
			if sp.Marks[i].ID != id {
				continue
			}
			m := &sp.Marks[i]
			if note != nil {
				m.Note = cleanNote(*note)
			}
			if shared != nil {
				m.Shared = *shared
			}
			m.Shared = m.Shared && m.Note != ""
			m.Updated = time.Now().UnixMilli()
			out = *m
			return nil
		}
		return ErrNoMark
	})
	return out, err
}

// DeleteMark removes one of the person's marks.
func (s *Store) DeleteMark(user, id string) error {
	_, err := s.changeSpoken(user, func(sp *spoken) error {
		for i, m := range sp.Marks {
			if m.ID == id {
				sp.Marks = append(sp.Marks[:i], sp.Marks[i+1:]...)
				return nil
			}
		}
		return ErrNoMark
	})
	return err
}

// SharedMarks returns the notes other people shared on an item, in the order they come in it, with their names.
func (s *Store) SharedMarks(viewer, item string) []SharedMark {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []SharedMark{}
	folders, _ := os.ReadDir(s.Root)
	mine := s.dir(viewer)
	for _, folder := range folders {
		path := filepath.Join(s.Root, folder.Name())
		if !folder.IsDir() || path == mine {
			continue
		}
		var found []Mark
		for _, m := range readSpoken(filepath.Join(path, "spoken.json")).Marks {
			if m.Item == item && m.Shared && m.Note != "" {
				found = append(found, m)
			}
		}
		if len(found) == 0 {
			continue
		}
		st := readState(path)
		if st.User == "" {
			continue // nobody to say it is from
		}
		for _, m := range found {
			out = append(out, SharedMark{Mark: m, User: st.User, Name: st.DisplayName})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}
