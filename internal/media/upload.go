package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Files sent from a device: an episode or a book someone has, rather than a YouTube link. They arrive in pieces,
// because a single request through Cloudflare stops at 100 MB and a book is often more; a piece that failed is sent
// again from where the server says it got to. Pieces wait in <root>/.uploads/<id>/ (hidden: List never reads it)
// and the finished file moves into its item's folder with a rename.

// Upload is a file on its way.
type Upload struct {
	ID         string `json:"id"`
	User       string `json:"user"`
	Kind       string `json:"kind"`
	Collection string `json:"collection,omitempty"`
	Name       string `json:"name"` // the file's name on the device, for its title when its tags have none
	Size       int64  `json:"size"`
	Created    int64  `json:"created"`
	Received   int64  `json:"received"` // from the file itself, not saved
}

// ChunkSize is the most one piece may carry: well under Cloudflare's 100 MB.
const ChunkSize = 32 << 20

// MaxOpenUploads is how many files one person may be sending at once.
const MaxOpenUploads = 4

var (
	ErrNoUpload    = errors.New("no such upload")
	ErrWrongOffset = errors.New("that piece is not the next one")
)

// Each upload has its own lock: a piece takes a while to arrive, and must not hold up anything else.
var uploadLocks sync.Map

func lockUpload(id string) func() {
	m, _ := uploadLocks.LoadOrStore(id, &sync.Mutex{})
	m.(*sync.Mutex).Lock()
	return m.(*sync.Mutex).Unlock
}

func (s Store) uploadDir(id string) string  { return filepath.Join(s.Root, ".uploads", id) }
func (s Store) uploadData(id string) string { return filepath.Join(s.uploadDir(id), "data") }

func (s Store) writeUpload(u Upload) error {
	u.Received = 0
	data, err := json.Marshal(u)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.uploadDir(u.ID), "upload.json"), data, 0o644)
}

// StartUpload makes room for a file of size bytes, at most max.
func (s Store) StartUpload(u Upload, max int64) (Upload, error) {
	if !ValidKind(u.Kind) {
		return Upload{}, fmt.Errorf("kind must be one of: %s", strings.Join(Kinds, ", "))
	}
	if u.Size <= 0 {
		return Upload{}, errors.New("the file is empty")
	}
	if u.Size > max {
		return Upload{}, fmt.Errorf("the file is larger than this server accepts (%d MB)", max>>20)
	}
	open := 0
	for _, other := range s.Uploads() {
		if strings.EqualFold(other.User, u.User) {
			open++
		}
	}
	if open >= MaxOpenUploads {
		return Upload{}, errors.New("finish or cancel the files you are already sending first")
	}
	u.ID, u.Created, u.Name = newID(), time.Now().Unix(), Clip(filepath.Base(u.Name), 200)
	if err := os.MkdirAll(s.uploadDir(u.ID), 0o755); err != nil {
		return Upload{}, err
	}
	if err := os.WriteFile(s.uploadData(u.ID), nil, 0o644); err != nil {
		return Upload{}, err
	}
	return u, s.writeUpload(u)
}

// GetUpload reads an upload of user's. Someone else's answers exactly like one that does not exist.
func (s Store) GetUpload(id, user string) (Upload, error) {
	var u Upload
	if !ValidID(id) {
		return u, ErrNoUpload
	}
	data, err := os.ReadFile(filepath.Join(s.uploadDir(id), "upload.json"))
	if err != nil || json.Unmarshal(data, &u) != nil || !strings.EqualFold(u.User, user) {
		return Upload{}, ErrNoUpload
	}
	if st, err := os.Stat(s.uploadData(id)); err == nil {
		u.Received = st.Size()
	}
	return u, nil
}

// Uploads lists every file on its way, of everyone.
func (s Store) Uploads() []Upload {
	entries, _ := os.ReadDir(filepath.Join(s.Root, ".uploads"))
	var out []Upload
	for _, e := range entries {
		var u Upload
		if data, err := os.ReadFile(filepath.Join(s.uploadDir(e.Name()), "upload.json")); err == nil && json.Unmarshal(data, &u) == nil {
			out = append(out, u)
		}
	}
	return out
}

// AppendUpload adds the piece that starts at offset. A piece sent again after a failure (an offset already passed)
// is refused with ErrWrongOffset, and the answer says where to go on from.
func (s Store) AppendUpload(id, user string, offset int64, piece io.Reader) (Upload, error) {
	defer lockUpload(id)()
	u, err := s.GetUpload(id, user)
	if err != nil {
		return u, err
	}
	if offset != u.Received {
		return u, ErrWrongOffset
	}
	f, err := os.OpenFile(s.uploadData(id), os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return u, err
	}
	room := u.Size - u.Received
	if room > ChunkSize {
		room = ChunkSize
	}
	n, err := io.Copy(f, io.LimitReader(piece, room+1))
	closeErr := f.Close()
	if err == nil && n > room {
		err = errors.New("that piece is larger than the file said it would be")
	}
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Truncate(s.uploadData(id), u.Received) // the next try starts from where this one did
		return u, err
	}
	u.Received += n
	return u, nil
}

// TakeUpload hands over a complete upload's file to be checked and filed, and forgets the upload.
// The caller moves or removes the returned folder.
func (s Store) TakeUpload(id, user string) (Upload, string, error) {
	defer lockUpload(id)()
	u, err := s.GetUpload(id, user)
	if err != nil {
		return u, "", err
	}
	if u.Received != u.Size {
		return u, "", fmt.Errorf("the file is not all here yet (%d of %d bytes)", u.Received, u.Size)
	}
	os.Remove(filepath.Join(s.uploadDir(id), "upload.json")) // no longer an upload, whatever happens next
	return u, s.uploadDir(id), nil
}

// CancelUpload throws away a file on its way.
func (s Store) CancelUpload(id, user string) error {
	defer lockUpload(id)()
	if _, err := s.GetUpload(id, user); err != nil {
		return err
	}
	return os.RemoveAll(s.uploadDir(id))
}

// CleanUploads removes files that stopped arriving long ago, and the folders of uploads that were taken but never
// filed (a crash in between).
func (s Store) CleanUploads(olderThan time.Duration) {
	entries, _ := os.ReadDir(filepath.Join(s.Root, ".uploads"))
	limit := time.Now().Add(-olderThan)
	for _, e := range entries {
		dir := s.uploadDir(e.Name())
		info, err := os.Stat(filepath.Join(dir, "data"))
		if errors.Is(err, fs.ErrNotExist) {
			info, err = e.Info()
		}
		if err == nil && info.ModTime().Before(limit) {
			os.RemoveAll(dir)
		}
	}
}

// NewItemID is an ID for an uploaded item: never the same as a YouTube video's, which are 11 characters.
func NewItemID() string { return "up" + newID() }

// FileItem moves a checked file (and its picture, if any) into a new item's folder, and saves the item.
func (s Store) FileItem(it Item, from, file, thumb string) error {
	if !ValidID(it.ID) || !ValidKind(it.Kind) {
		return fmt.Errorf("invalid media item %q/%q", it.Kind, it.ID)
	}
	dir := s.Dir(it.Kind, it.ID)
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return err
	}
	if err := os.Rename(from, dir); err != nil {
		return err
	}
	if err := os.Rename(filepath.Join(dir, "data"), filepath.Join(dir, file)); err != nil {
		os.RemoveAll(dir)
		return err
	}
	it.File = file
	if thumb != "" {
		if _, err := os.Stat(filepath.Join(dir, thumb)); err == nil {
			it.Thumb = thumb
		}
	}
	if err := s.Save(it); err != nil {
		os.RemoveAll(dir)
		return err
	}
	return nil
}
