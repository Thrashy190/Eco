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

// Import is a list of songs brought from elsewhere and the Navidrome playlist that shows it. It belongs to one user.
type Import struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	PlaylistID string        `json:"playlist_id,omitempty"`
	Rows       []imports.Row `json:"rows"`
	Linked     []string      `json:"linked,omitempty"` // songs eco put in the playlist: anything else there was added by hand
	UpdatedAt  int64         `json:"updated_at"`
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
	dir := s.dir(user)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(list)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".imports-*")
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
	return os.Rename(tmp.Name(), s.importsPath(user))
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
