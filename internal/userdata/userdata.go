// Package userdata keeps what belongs to one person and that Navidrome has no place for: what they opened
// recently, what they pinned, and the pictures they chose for their playlists. It lives on the server so the
// phone and the laptop show the same library. There is no database: one JSON file per user.
//
// Layout: <root>/<hash of the username>/{state.json, covers/<playlist id>.jpg}
package userdata

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image/jpeg"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// MaxRecents is how many recent items are remembered.
const MaxRecents = 50

// MaxCoverBytes is the largest playlist cover accepted. The web app resizes pictures to well under this.
const MaxCoverBytes = 2 << 20

const maxPins = 100

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidID reports whether id is a safe identifier (playlist IDs end up in file paths).
func ValidID(id string) bool { return idPattern.MatchString(id) }

// ValidType reports whether t is something the library can list.
func ValidType(t string) bool {
	switch t {
	case "playlist", "album", "artist", "song", "catalog_album", "spotify_album": // spotify_album: entries saved before MusicBrainz
		return true
	}
	return false
}

// Entry is one item of the library's Recent view. The web app sends everything it needs to draw the row and
// open it again, so the view does not have to ask Navidrome and the catalogue about every item.
type Entry struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Subtitle string `json:"subtitle,omitempty"`
	Cover    string `json:"cover,omitempty"`     // Navidrome cover art ID
	CoverURL string `json:"cover_url,omitempty"` // or a picture elsewhere (the catalogue)
	// Songs only, so a pinned song can be played directly
	Artist   string `json:"artist,omitempty"`
	ArtistID string `json:"artist_id,omitempty"`
	Album    string `json:"album,omitempty"`
	AlbumID  string `json:"album_id,omitempty"`
	Duration int    `json:"duration,omitempty"`
	At       int64  `json:"at,omitempty"` // when it was opened or pinned (Unix milliseconds)
}

// Validate rejects entries that could not have come from the web app.
func (e Entry) Validate() error {
	switch {
	case !ValidType(e.Type):
		return errors.New("unknown type")
	case !ValidID(e.ID):
		return errors.New("invalid id")
	case e.Name == "":
		return errors.New("name is required")
	case e.CoverURL != "" && !strings.HasPrefix(e.CoverURL, "https://"):
		return errors.New("cover_url must be https")
	}
	return nil
}

// State is everything stored for a user.
type State struct {
	Recents []Entry          `json:"recents"`
	Pins    []Entry          `json:"pins"`
	Avatar  int64            `json:"avatar,omitempty"` // when the profile picture was set, so its address changes with it
	Covers  map[string]int64 `json:"covers"`           // playlist ID → when its picture was set, used to refresh cached images
	// The background picture, like the avatar, and how the app looks (the web app's settings, which the server only
	// keeps), so every device of the account looks the same
	Wallpaper int64           `json:"wallpaper,omitempty"`
	Look      json.RawMessage `json:"look,omitempty"`
	LookAt    int64           `json:"look_at,omitempty"`
}

// Store keeps every user's state under a root folder.
type Store struct {
	Root string
	mu   sync.Mutex
}

// dir hashes the username, so any name Navidrome accepts is a safe folder name. Navidrome ignores case in usernames.
func (s *Store) dir(user string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(user)))
	return filepath.Join(s.Root, hex.EncodeToString(sum[:16]))
}

func (s *Store) read(user string) State { return readState(s.dir(user)) }

func readState(dir string) State {
	st := State{}
	if data, err := os.ReadFile(filepath.Join(dir, "state.json")); err == nil {
		json.Unmarshal(data, &st) // a damaged file is treated as an empty one
	}
	if st.Recents == nil {
		st.Recents = []Entry{}
	}
	if st.Pins == nil {
		st.Pins = []Entry{}
	}
	if st.Covers == nil {
		st.Covers = map[string]int64{}
	}
	return st
}

// write replaces the file atomically, so a crash can never leave half a state behind.
func (s *Store) write(user string, st State) error { return writeState(s.dir(user), st) }

func writeState(dir string, st State) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".state-*")
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
	return os.Rename(tmp.Name(), filepath.Join(dir, "state.json"))
}

func (s *Store) update(user string, change func(*State)) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.read(user)
	change(&st)
	return st, s.write(user, st)
}

// Get returns a user's state (an empty one if they have none yet).
func (s *Store) Get(user string) State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(user)
}

func without(list []Entry, kind, id string) []Entry {
	out := make([]Entry, 0, len(list))
	for _, e := range list {
		if e.Type != kind || e.ID != id {
			out = append(out, e)
		}
	}
	return out
}

// Touch moves an item to the front of the recents, adding it if it is new. A pinned copy gets the fresh details too.
func (s *Store) Touch(user string, e Entry) (State, error) {
	e.At = time.Now().UnixMilli()
	return s.update(user, func(st *State) {
		st.Recents = append([]Entry{e}, without(st.Recents, e.Type, e.ID)...)
		if len(st.Recents) > MaxRecents {
			st.Recents = st.Recents[:MaxRecents]
		}
		for i, p := range st.Pins {
			if p.Type == e.Type && p.ID == e.ID {
				e.At = p.At // pinning keeps its order
				st.Pins[i] = e
			}
		}
	})
}

// Forget removes an item from the recents. It stays pinned if it was.
func (s *Store) Forget(user, kind, id string) (State, error) {
	return s.update(user, func(st *State) { st.Recents = without(st.Recents, kind, id) })
}

// ErrTooManyPins is returned when a user tries to pin past the limit.
var ErrTooManyPins = errors.New("too many pinned items")

// Pin adds an item to the front of the pinned list. Pinning something already pinned moves it to the front.
func (s *Store) Pin(user string, e Entry) (State, error) {
	e.At = time.Now().UnixMilli()
	var failure error
	st, err := s.update(user, func(st *State) {
		rest := without(st.Pins, e.Type, e.ID)
		if len(rest) >= maxPins {
			failure = ErrTooManyPins
			return
		}
		st.Pins = append([]Entry{e}, rest...)
	})
	if failure != nil {
		return st, failure
	}
	return st, err
}

// Unpin removes an item from the pinned list.
func (s *Store) Unpin(user, kind, id string) (State, error) {
	return s.update(user, func(st *State) { st.Pins = without(st.Pins, kind, id) })
}

// ForgetEverywhere removes an item from every user's recents and pins, when it no longer exists for anyone.
func (s *Store) ForgetEverywhere(kind, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	folders, err := os.ReadDir(s.Root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var failed error
	for _, folder := range folders {
		if !folder.IsDir() {
			continue
		}
		path := filepath.Join(s.Root, folder.Name())
		st := readState(path)
		recents, pins := without(st.Recents, kind, id), without(st.Pins, kind, id)
		if len(recents) == len(st.Recents) && len(pins) == len(st.Pins) {
			continue
		}
		st.Recents, st.Pins = recents, pins
		if err := writeState(path, st); err != nil {
			failed = err
		}
	}
	return failed
}

// CoverPath is where a playlist's picture is stored. The caller must have validated the ID.
func (s *Store) CoverPath(user, playlistID string) string {
	return filepath.Join(s.dir(user), "covers", playlistID+".jpg")
}

// SetCover stores a playlist's picture. Only real JPEG files of a sensible size are kept: the web app converts
// whatever the user picks, and refusing anything else means eco never serves an uploaded file it cannot vouch for.
func (s *Store) SetCover(user, playlistID string, image []byte) (State, error) {
	if err := saveJPEG(s.CoverPath(user, playlistID), image); err != nil {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Covers[playlistID] = time.Now().UnixMilli() })
}

func saveJPEG(path string, image []byte) error {
	if len(image) > MaxCoverBytes {
		return errors.New("the picture is too large")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(image))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
		return errors.New("the picture must be a JPEG of at most 4096×4096 pixels")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, image, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// AvatarPath is where a user's profile picture is stored. The username is hashed, so any name is safe here.
func (s *Store) AvatarPath(user string) string { return filepath.Join(s.dir(user), "avatar.jpg") }

// SetAvatar stores a user's profile picture, under the same rules as a playlist's.
func (s *Store) SetAvatar(user string, image []byte) (State, error) {
	if err := saveJPEG(s.AvatarPath(user), image); err != nil {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Avatar = time.Now().UnixMilli() })
}

// RemoveAvatar deletes a user's profile picture.
func (s *Store) RemoveAvatar(user string) (State, error) {
	if err := os.Remove(s.AvatarPath(user)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Avatar = 0 })
}

// WallpaperPath is where a user's background picture is stored.
func (s *Store) WallpaperPath(user string) string { return filepath.Join(s.dir(user), "wallpaper.jpg") }

// SetWallpaper stores a user's background picture, under the same rules as any other picture.
func (s *Store) SetWallpaper(user string, image []byte) (State, error) {
	if err := saveJPEG(s.WallpaperPath(user), image); err != nil {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Wallpaper = time.Now().UnixMilli() })
}

// RemoveWallpaper deletes a user's background picture.
func (s *Store) RemoveWallpaper(user string) (State, error) {
	if err := os.Remove(s.WallpaperPath(user)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return State{}, err
	}
	return s.update(user, func(st *State) { st.Wallpaper = 0 })
}

// MaxLookBytes is the most a user's look may take: a few dozen settings need a fraction of it.
const MaxLookBytes = 32 << 10

// ErrBadLook means the look is not a JSON object of a sensible size.
var ErrBadLook = errors.New("the look must be a JSON object of at most 32 KB")

// SetLook keeps how the app looks for a user. The server does not read it: the web app checks every value it applies.
// It returns when it was saved.
func (s *Store) SetLook(user string, look []byte) (int64, error) {
	var object map[string]json.RawMessage
	if len(look) > MaxLookBytes || json.Unmarshal(look, &object) != nil || object == nil {
		return 0, ErrBadLook
	}
	at := time.Now().UnixMilli()
	_, err := s.update(user, func(st *State) {
		st.Look = json.RawMessage(look)
		st.LookAt = at
	})
	return at, err
}

// AvatarVersion says when a user's picture was set, 0 if there is none.
func (s *Store) AvatarVersion(user string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(user).Avatar
}

// RemoveCover deletes a playlist's picture.
func (s *Store) RemoveCover(user, playlistID string) (State, error) {
	if err := os.Remove(s.CoverPath(user, playlistID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return State{}, err
	}
	return s.update(user, func(st *State) { delete(st.Covers, playlistID) })
}
