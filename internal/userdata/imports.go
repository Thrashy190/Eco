package userdata

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/imports"
)

// Import is a list of songs brought from elsewhere and the Navidrome playlist that shows it, or, for liked songs, the
// person's favourites. It belongs to one user.
type Import struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	PlaylistID string        `json:"playlist_id,omitempty"`
	Rows       []imports.Row `json:"rows"`
	// Linked are the songs eco put in the playlist, or made favourites: anything else there was added by hand, and a
	// favourite taken away by hand is not given back.
	Linked []string `json:"linked,omitempty"`
	// Favorites sends the list to the person's favourites instead of a playlist.
	Favorites bool `json:"favorites,omitempty"`
	// Unordered says songs became favourites after the rest, so the favourites no longer read like the list.
	Unordered bool  `json:"unordered,omitempty"`
	UpdatedAt int64 `json:"updated_at"`
}

// ImportID is the same for the same name, so importing a newer file of a list updates it instead of adding another.
func ImportID(name string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(name))))
	return hex.EncodeToString(sum[:8])
}

const maxImports = 200

func (s *Store) importsPath(user string) string { return filepath.Join(s.dir(user), "imports.json") }

func (s *Store) readImports(user string) []Import {
	var list []Import
	if data, err := os.ReadFile(s.importsPath(user)); err == nil {
		json.Unmarshal(data, &list) // a damaged file is treated as an empty one
	}
	return list
}

func (s *Store) writeImports(user string, list []Import) error {
	return writeJSON(s.dir(user), "imports.json", list)
}

// Imports lists a user's imports, the most recent first.
func (s *Store) Imports(user string) []Import {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.readImports(user)
	sort.SliceStable(list, func(i, j int) bool { return list[i].UpdatedAt > list[j].UpdatedAt })
	return list
}

// Import returns one of a user's imports. Somebody else's looks exactly like one that does not exist.
func (s *Store) Import(user, id string) (Import, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, imp := range s.readImports(user) {
		if imp.ID == id {
			return imp, true
		}
	}
	return Import{}, false
}

// SaveImport adds an import or replaces the one with the same ID.
func (s *Store) SaveImport(user string, imp Import) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	imp.UpdatedAt = time.Now().UnixMilli()
	list := s.readImports(user)
	for i := range list {
		if list[i].ID == imp.ID {
			list[i] = imp
			return s.writeImports(user, list)
		}
	}
	if len(list) >= maxImports {
		return errors.New("too many imported lists")
	}
	return s.writeImports(user, append(list, imp))
}

// SaveImportWith changes one of a user's imports, or makes it with that ID, reading and writing in one go: work running
// in the background on the same import is never overwritten by an older copy.
func (s *Store) SaveImportWith(user, id string, change func(*Import)) (Import, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.readImports(user)
	at := -1
	for i := range list {
		if list[i].ID == id {
			at = i
		}
	}
	if at < 0 {
		if len(list) >= maxImports {
			return Import{}, errors.New("too many imported lists")
		}
		list, at = append(list, Import{ID: id}), len(list)
	}
	change(&list[at])
	list[at].UpdatedAt = time.Now().UnixMilli()
	return list[at], s.writeImports(user, list)
}

// UpdateImport changes one of a user's imports in place, if it is still there.
func (s *Store) UpdateImport(user, id string, change func(*Import)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.readImports(user)
	for i := range list {
		if list[i].ID == id {
			change(&list[i])
			return s.writeImports(user, list)
		}
	}
	return nil
}

// DeleteImport forgets an import. Its playlist stays.
func (s *Store) DeleteImport(user, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.readImports(user)
	kept := make([]Import, 0, len(list))
	for _, imp := range list {
		if imp.ID != id {
			kept = append(kept, imp)
		}
	}
	return s.writeImports(user, kept)
}
