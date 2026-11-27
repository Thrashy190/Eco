package userdata

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
)

// People on one server can see each other, by the maintainer's choice: a profile with a name, pictures, public
// playlists, favourites and what someone plays most. Everything shows unless its owner hides it (Privacy); the server
// checks that on every request. Someone appears once they have signed in to Eco: Navidrome only lists accounts to an
// administrator.

// Privacy is what a person keeps from the others. The zero value shows everything.
type Privacy struct {
	HideProfile   bool `json:"hide_profile,omitempty"` // nobody else sees them at all
	HideListening bool `json:"hide_listening,omitempty"`
	HideFavorites bool `json:"hide_favorites,omitempty"`
	HideTop       bool `json:"hide_top,omitempty"`
}

// Person is what the list of people needs about one of them.
type Person struct {
	User        string  `json:"user"`
	DisplayName string  `json:"display_name,omitempty"`
	SeenAt      int64   `json:"seen_at,omitempty"`
	Avatar      int64   `json:"avatar,omitempty"`
	Banner      int64   `json:"banner,omitempty"`
	Privacy     Privacy `json:"-"`
}

func personOf(st State) Person {
	return Person{User: st.User, DisplayName: st.DisplayName, SeenAt: st.SeenAt, Avatar: st.Avatar, Banner: st.Banner, Privacy: st.Privacy}
}

// Seen records that someone signed in, under the spelling they used.
func (s *Store) Seen(user string) error {
	_, err := s.update(user, func(st *State) {
		st.User = user
		st.SeenAt = time.Now().UnixMilli()
	})
	return err
}

// People lists everyone who has signed in to Eco, most recently seen first. Hidden profiles are included: the caller
// decides, since a person always sees their own.
func (s *Store) People() ([]Person, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	folders, err := os.ReadDir(s.Root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Person
	for _, folder := range folders {
		if !folder.IsDir() {
			continue
		}
		st := readState(filepath.Join(s.Root, folder.Name()))
		if st.User != "" {
			out = append(out, personOf(st))
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SeenAt > out[j].SeenAt })
	return out, nil
}

// Person returns someone who has signed in to Eco, by username in any case.
func (s *Store) Person(user string) (Person, bool) {
	st := s.Get(user)
	if st.User == "" || !strings.EqualFold(st.User, user) {
		return Person{}, false
	}
	return personOf(st), true
}

// MaxDisplayName is the longest name shown to others, in characters.
const MaxDisplayName = 60

// ErrBadName means a display name is too long or holds characters that are not text.
var ErrBadName = errors.New("the name must be at most 60 characters of text")

func cleanDisplayName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len([]rune(name)) > MaxDisplayName || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return "", ErrBadName
	}
	return name, nil
}

// SetProfile changes the name others see (empty shows the username) and what they may see.
func (s *Store) SetProfile(user, name string, privacy Privacy) (State, error) {
	name, err := cleanDisplayName(name)
	if err != nil {
		return State{}, err
	}
	return s.update(user, func(st *State) {
		st.DisplayName = name
		st.Privacy = privacy
	})
}

// BannerPath is where the cover of a person's profile is stored.
func (s *Store) BannerPath(user string) string { return filepath.Join(s.dir(user), "banner.jpg") }

// SetBanner stores the cover of a person's profile, under the same rules as any other picture.
func (s *Store) SetBanner(user string, image []byte) (State, error) {
	if err := saveJPEG(s.BannerPath(user), image); err != nil {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Banner = time.Now().UnixMilli() })
}

// RemoveBanner deletes the cover of a person's profile.
func (s *Store) RemoveBanner(user string) (State, error) {
	if err := os.Remove(s.BannerPath(user)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Banner = 0 })
}

// Favorites is a copy of a person's favourites (Navidrome's stars), newest first, for the others to see: Eco cannot
// ask Navidrome for someone else's. It is taken with the person's own credentials whenever they use Eco.
type Favorites struct {
	Songs []string `json:"songs"`
	At    int64    `json:"at"` // when the copy was taken
}

func (s *Store) favoritesPath(user string) string {
	return filepath.Join(s.dir(user), "favorites.json")
}

// SetFavorites replaces the copy of a person's favourites.
func (s *Store) SetFavorites(user string, songs []string) error {
	data, err := json.Marshal(Favorites{Songs: songs, At: time.Now().UnixMilli()})
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path := s.favoritesPath(user)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// FavoritesOf returns the copy of a person's favourites; an empty one if none was taken yet.
func (s *Store) FavoritesOf(user string) Favorites {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Favorites{Songs: []string{}}
	if data, err := os.ReadFile(s.favoritesPath(user)); err == nil {
		json.Unmarshal(data, &out) // a damaged file is treated as an empty one
	}
	if out.Songs == nil {
		out.Songs = []string{}
	}
	return out
}
