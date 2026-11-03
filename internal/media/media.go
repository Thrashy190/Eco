// Package media stores what is not music: podcasts, audiobooks and anything else imported from a YouTube link.
// Only the audio is kept. It lives next to the music library, not inside it, because Navidrome would mix these
// files in with your songs (artists, albums, random mixes). eco serves them itself.
//
// Layout: <root>/<kind>/<id>/{media.m4a, media.jpg, meta.json}
package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

// Kinds are the categories a user can file an import under, and the folders they live in.
var Kinds = []string{"podcast", "audiobook", "other"}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,24}$`)

// ValidID reports whether id is a safe identifier (it ends up in file paths).
func ValidID(id string) bool { return idPattern.MatchString(id) }

// ValidKind reports whether kind is one of Kinds.
func ValidKind(kind string) bool {
	for _, k := range Kinds {
		if k == kind {
			return true
		}
	}
	return false
}

// Item is one imported file. File and Thumb are names inside the item's folder.
type Item struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Channel  string `json:"channel"`
	Source   string `json:"source"`
	Duration int    `json:"duration"`
	Size     int64  `json:"size"`
	AddedAt  int64  `json:"added_at"`
	File     string `json:"file"`
	Thumb    string `json:"thumb,omitempty"`
}

// Store keeps items under a root folder.
type Store struct{ Root string }

// Dir is the folder of an item. The caller must have validated both arguments.
func (s Store) Dir(kind, id string) string { return filepath.Join(s.Root, kind, id) }

// Save writes the metadata of an item whose files are already in its folder.
func (s Store) Save(it Item) error {
	if !ValidID(it.ID) || !ValidKind(it.Kind) {
		return fmt.Errorf("invalid media item %q/%q", it.Kind, it.ID)
	}
	data, err := json.MarshalIndent(it, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.Dir(it.Kind, it.ID), "meta.json"), data, 0o644)
}

func (s Store) read(kind, id string) (Item, error) {
	var it Item
	data, err := os.ReadFile(filepath.Join(s.Dir(kind, id), "meta.json"))
	if err != nil {
		return it, err
	}
	return it, json.Unmarshal(data, &it)
}

// Find looks an item up by ID in any category.
func (s Store) Find(id string) (Item, error) {
	if !ValidID(id) {
		return Item{}, errors.New("invalid id")
	}
	for _, kind := range Kinds {
		if it, err := s.read(kind, id); err == nil {
			return it, nil
		}
	}
	return Item{}, fs.ErrNotExist
}

// List returns the items of a category (all categories when kind is empty), newest first.
func (s Store) List(kind string) []Item {
	kinds := Kinds
	if kind != "" {
		kinds = []string{kind}
	}
	var items []Item
	for _, k := range kinds {
		entries, _ := os.ReadDir(filepath.Join(s.Root, k))
		for _, e := range entries {
			if it, err := s.read(k, e.Name()); err == nil {
				items = append(items, it)
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].AddedAt > items[j].AddedAt })
	return items
}

// Delete removes an item and its files.
func (s Store) Delete(id string) error {
	it, err := s.Find(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(s.Dir(it.Kind, it.ID))
}

// Path returns the absolute path of one of an item's files.
func (s Store) Path(it Item, name string) string {
	return filepath.Join(s.Dir(it.Kind, it.ID), filepath.Base(name))
}
