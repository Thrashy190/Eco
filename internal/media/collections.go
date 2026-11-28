package media

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// A Collection is what episodes and parts belong to: a podcast show or an audiobook. Everyone shares them, like the
// rest of the library; whoever made one (or an administrator) may change it.
type Collection struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"` // "podcast" or "audiobook"
	Title       string  `json:"title"`
	Author      string  `json:"author"`             // the host of a show, the writer of a book
	Narrator    string  `json:"narrator,omitempty"` // books only
	Series      string  `json:"series,omitempty"`   // books only
	SeriesIndex float64 `json:"series_index,omitempty"`
	Description string  `json:"description,omitempty"`
	CreatedBy   string  `json:"created_by,omitempty"` // empty for the ones grouped from older items
	CreatedAt   int64   `json:"created_at"`
	UpdatedAt   int64   `json:"updated_at"`
	Cover       int64   `json:"cover,omitempty"` // when its own picture was last set; 0 uses its first item's
	// Books that go with this one (a series, the same world), books only. Kept on both sides: linking A to B lists A on
	// B too, so either page shows the other and either can undo it.
	Related []string `json:"related,omitempty"`
}

// Kinds that have collections. "other" stays a flat list.
var collectionKinds = map[string]bool{"podcast": true, "audiobook": true}

// HasCollections reports whether items of kind belong to a show or a book.
func HasCollections(kind string) bool { return collectionKinds[kind] }

// Text limits, in characters. A description can be long (a book's blurb, a show's notes) but not unbounded.
const (
	maxTitle       = 200
	maxDescription = 5000
	maxRelated     = 50
)

// mu serialises every write of a collection or a chapter list: two imports from one channel at once must not make
// two shows, and two people marking chapters at once must not lose one.
var mu sync.Mutex

func (s Store) collectionDir(id string) string { return filepath.Join(s.Root, "collections", id) }

// CoverPath is where a collection's own picture lives. The caller must have validated id.
func (s Store) CoverPath(id string) string { return filepath.Join(s.collectionDir(id), "cover.jpg") }

func newID() string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 12)
	rand.Read(b)
	for i := range b {
		b[i] = letters[int(b[i])%len(letters)]
	}
	return string(b)
}

// Clip trims text and keeps at most max characters, cutting on a character boundary.
func Clip(text string, max int) string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return strings.TrimSpace(string([]rune(text)[:max]))
}

// Clean checks what a person typed and trims it. Fields that do not apply to the kind are emptied.
func (c *Collection) Clean() error {
	if !HasCollections(c.Kind) {
		return fmt.Errorf("kind must be podcast or audiobook")
	}
	c.Title, c.Author = Clip(c.Title, maxTitle), Clip(c.Author, maxTitle)
	c.Narrator, c.Series = Clip(c.Narrator, maxTitle), Clip(c.Series, maxTitle)
	c.Description = Clip(c.Description, maxDescription)
	if c.Title == "" {
		return errors.New("give it a title")
	}
	if c.Kind == "podcast" {
		c.Narrator, c.Series, c.SeriesIndex, c.Related = "", "", 0, nil
	}
	seen := map[string]bool{c.ID: true}
	related := []string{}
	for _, id := range c.Related {
		if ValidID(id) && !seen[id] && len(related) < maxRelated {
			seen[id] = true
			related = append(related, id)
		}
	}
	c.Related = related
	if len(related) == 0 {
		c.Related = nil
	}
	if c.SeriesIndex < 0 || c.SeriesIndex > 10000 || c.Series == "" {
		c.SeriesIndex = 0
	}
	return nil
}

func (s Store) writeCollection(c Collection) error {
	if !ValidID(c.ID) {
		return fmt.Errorf("invalid collection %q", c.ID)
	}
	dir := s.collectionDir(c.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, "collection.json.tmp")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, "collection.json"))
}

// Collection reads one show or book.
func (s Store) Collection(id string) (Collection, error) {
	var c Collection
	if !ValidID(id) {
		return c, fs.ErrNotExist
	}
	data, err := os.ReadFile(filepath.Join(s.collectionDir(id), "collection.json"))
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(data, &c)
}

// Collections lists the shows or books of one kind, by title.
func (s Store) Collections(kind string) []Collection {
	entries, _ := os.ReadDir(filepath.Join(s.Root, "collections"))
	out := []Collection{}
	for _, e := range entries {
		if c, err := s.Collection(e.Name()); err == nil && c.Kind == kind {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out
}

// CreateCollection stores a new show or book made by user.
func (s Store) CreateCollection(c Collection, user string) (Collection, error) {
	if err := c.Clean(); err != nil {
		return Collection{}, err
	}
	now := time.Now().Unix()
	c.ID, c.CreatedBy, c.CreatedAt, c.UpdatedAt, c.Cover = newID(), user, now, now, 0
	mu.Lock()
	defer mu.Unlock()
	c.Related = s.existing(c)
	if err := s.writeCollection(c); err != nil {
		return Collection{}, err
	}
	return c, s.linkBack(c, nil)
}

// UpdateCollection replaces what a person may edit, keeping who made it, when, and its kind.
func (s Store) UpdateCollection(id string, edit Collection) (Collection, error) {
	mu.Lock()
	defer mu.Unlock()
	c, err := s.Collection(id)
	if err != nil {
		return Collection{}, err
	}
	edit.ID, edit.Kind, edit.CreatedBy, edit.CreatedAt, edit.Cover = c.ID, c.Kind, c.CreatedBy, c.CreatedAt, c.Cover
	if edit.Related == nil { // left out: unchanged. An empty list unlinks every book
		edit.Related = c.Related
	}
	if err := edit.Clean(); err != nil {
		return Collection{}, err
	}
	edit.Related = s.existing(edit)
	edit.UpdatedAt = time.Now().Unix()
	if err := s.writeCollection(edit); err != nil {
		return Collection{}, err
	}
	return edit, s.linkBack(edit, c.Related)
}

// existing keeps the related books that are there and of the same kind. The caller holds mu.
func (s Store) existing(c Collection) []string {
	var out []string
	for _, id := range c.Related {
		if o, err := s.Collection(id); err == nil && o.Kind == c.Kind && o.ID != c.ID {
			out = append(out, id)
		}
	}
	return out
}

// linkBack makes the other side agree: books c now lists list c, and books it listed before (was) no longer do. The
// caller holds mu.
func (s Store) linkBack(c Collection, was []string) error {
	now := map[string]bool{}
	for _, id := range c.Related {
		now[id] = true
	}
	touched := map[string]bool{}
	for _, id := range append(append([]string{}, c.Related...), was...) {
		if touched[id] {
			continue
		}
		touched[id] = true
		o, err := s.Collection(id)
		if err != nil || o.Kind != c.Kind {
			continue
		}
		has := false
		keep := o.Related[:0:0]
		for _, r := range o.Related {
			if r == c.ID {
				has = true
				if !now[id] {
					continue
				}
			}
			keep = append(keep, r)
		}
		if now[id] && !has && len(keep) < maxRelated {
			keep = append(keep, c.ID)
		}
		if len(keep) == len(o.Related) && has == now[id] {
			continue
		}
		o.Related = keep
		if len(keep) == 0 {
			o.Related = nil
		}
		if err := s.writeCollection(o); err != nil {
			return err
		}
	}
	return nil
}

// Related lists the books that go with c, as far as they still exist, by title.
func (s Store) Related(c Collection) []Collection {
	out := []Collection{}
	for _, id := range c.Related {
		if o, err := s.Collection(id); err == nil && o.Kind == c.Kind {
			out = append(out, o)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out
}

// CoverSet records that a collection's own picture was just written (by the caller, at CoverPath).
func (s Store) CoverSet(id string, set bool) (Collection, error) {
	mu.Lock()
	defer mu.Unlock()
	c, err := s.Collection(id)
	if err != nil {
		return Collection{}, err
	}
	c.Cover = 0
	if set {
		c.Cover = time.Now().UnixMilli()
	} else {
		os.Remove(s.CoverPath(id))
	}
	return c, s.writeCollection(c)
}

// Items lists what belongs to a collection, in Order.
func (s Store) Items(c Collection) []Item {
	out := []Item{}
	for _, it := range s.List(c.Kind) {
		if it.Parent == c.ID {
			out = append(out, it)
		}
	}
	return Order(c, out)
}

// Order sorts a collection's items: a book's parts in reading order, a show's episodes newest first.
func Order(c Collection, items []Item) []Item {
	if c.Kind == "audiobook" {
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].Part != items[j].Part {
				return items[i].Part < items[j].Part
			}
			return items[i].AddedAt < items[j].AddedAt
		})
	} else {
		sort.SliceStable(items, func(i, j int) bool { return when(items[i]) > when(items[j]) })
	}
	return items
}

func when(it Item) int64 {
	if it.Published > 0 {
		return it.Published
	}
	return it.AddedAt
}

// DeleteCollection removes a show or book that has nothing in it any more. Deleting its episodes is a separate,
// deliberate step: someone else may have added them.
func (s Store) DeleteCollection(id string) error {
	mu.Lock()
	defer mu.Unlock()
	c, err := s.Collection(id)
	if err != nil {
		return err
	}
	if len(s.Items(c)) > 0 {
		return errors.New("it still has episodes or parts; delete those first")
	}
	if err := s.linkBack(Collection{ID: c.ID, Kind: c.Kind}, c.Related); err != nil {
		return err
	}
	return os.RemoveAll(s.collectionDir(c.ID))
}

// Reorder numbers a book's parts 1, 2, 3… in the order of ids, which must name each of its parts exactly once: a list
// made before a part arrived or went is refused rather than guessed at.
func (s Store) Reorder(c Collection, ids []string) ([]Item, error) {
	mu.Lock()
	defer mu.Unlock()
	items := s.Items(c)
	byID := map[string]Item{}
	for _, it := range items {
		byID[it.ID] = it
	}
	if len(ids) != len(items) {
		return nil, errors.New("the book changed meanwhile; open it again")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if _, ok := byID[id]; !ok || seen[id] {
			return nil, errors.New("the book changed meanwhile; open it again")
		}
		seen[id] = true
	}
	for i, id := range ids {
		it := byID[id]
		if it.Part == i+1 {
			continue
		}
		it.Part = i + 1
		if err := s.Save(it); err != nil {
			return nil, err
		}
	}
	return s.Items(c), nil
}

// NextPart is the part number after a book's last one.
func (s Store) NextPart(c Collection) int {
	n := 0
	for _, it := range s.Items(c) {
		if it.Part > n {
			n = it.Part
		}
	}
	return n + 1
}

// Adopt files an item that has no show or book under one named after its channel, making it when there is none. That
// is how imports without a chosen collection are grouped, and how items from before collections existed are.
func (s Store) Adopt(it *Item) error {
	if !HasCollections(it.Kind) || it.Parent != "" {
		return nil
	}
	name := strings.TrimSpace(it.Channel)
	if name == "" {
		name = "Unsorted"
	}
	mu.Lock()
	var found *Collection
	for _, c := range s.Collections(it.Kind) {
		if strings.EqualFold(c.Title, name) {
			found = &c
			break
		}
	}
	if found == nil {
		now := time.Now().Unix()
		c := Collection{ID: newID(), Kind: it.Kind, Title: Clip(name, maxTitle), Author: Clip(it.Channel, maxTitle), CreatedAt: now, UpdatedAt: now}
		if err := s.writeCollection(c); err != nil {
			mu.Unlock()
			return err
		}
		found = &c
	}
	mu.Unlock()
	it.Parent = found.ID
	if it.Kind == "audiobook" && it.Part == 0 {
		it.Part = s.NextPart(*found)
	}
	return nil
}

// Group files every older item that has no show or book, oldest first so a book's parts keep the order they were
// added in. It runs at start-up and does nothing once everything has a collection.
func (s Store) Group() error {
	items := s.List("")
	sort.SliceStable(items, func(i, j int) bool { return items[i].AddedAt < items[j].AddedAt })
	for _, it := range items {
		if !HasCollections(it.Kind) || it.Parent != "" {
			continue
		}
		if err := s.Adopt(&it); err != nil {
			return err
		}
		if err := s.Save(it); err != nil {
			return err
		}
	}
	return nil
}
