package media

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
)

// A Chapter marks where a part of an episode or a book starts. They come with the file (YouTube's chapters, a book's
// own). People could once mark their own; those are still read, with who marked them in By.
type Chapter struct {
	Start float64 `json:"start"` // seconds from the beginning of the file
	Title string  `json:"title"`
	By    string  `json:"by,omitempty"` // who marked it; empty when it came with the file
	At    int64   `json:"at,omitempty"` // when it was marked, Unix seconds
}

const (
	maxChapterTitle = 120
	maxChapters     = 1000
	// Two chapters closer than this are the same place: a second one there would only be a duplicate.
	chapterGap = 1.0
)

func (s Store) chaptersPath(it Item) string {
	return filepath.Join(s.Dir(it.Kind, it.ID), "chapters.json")
}

// Chapters returns an item's chapters in order. An item with none gives an empty list.
func (s Store) Chapters(it Item) []Chapter {
	out := []Chapter{}
	if data, err := os.ReadFile(s.chaptersPath(it)); err == nil {
		json.Unmarshal(data, &out)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

func (s Store) writeChapters(it Item, list []Chapter) error {
	sort.SliceStable(list, func(i, j int) bool { return list[i].Start < list[j].Start })
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	path := s.chaptersPath(it)
	if err := os.WriteFile(path+".tmp", data, 0o644); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

// cleanChapters keeps what the source gave that makes sense: inside the file, titled, not on top of another.
func cleanChapters(list []Chapter, duration int) []Chapter {
	sort.SliceStable(list, func(i, j int) bool { return list[i].Start < list[j].Start })
	out := []Chapter{}
	for _, c := range list {
		c.Title = Clip(c.Title, maxChapterTitle)
		if c.Title == "" || c.Start < 0 || math.IsNaN(c.Start) || (duration > 0 && c.Start >= float64(duration)) {
			continue
		}
		if len(out) > 0 && c.Start-out[len(out)-1].Start < chapterGap {
			continue
		}
		out = append(out, c)
		if len(out) == maxChapters {
			break
		}
	}
	return out
}

// SetSourceChapters stores the chapters that came with the file, as no one's.
func (s Store) SetSourceChapters(it Item, list []Chapter) error {
	for i := range list {
		list[i].By, list[i].At = "", 0
	}
	list = cleanChapters(list, it.Duration)
	if len(list) == 0 {
		return nil
	}
	mu.Lock()
	defer mu.Unlock()
	return s.writeChapters(it, list)
}
