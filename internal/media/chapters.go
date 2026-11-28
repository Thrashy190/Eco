package media

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// A Chapter marks where a part of an episode or a book starts. Some come with the file (YouTube's chapters, a book's
// own); anyone can add more, and everyone sees them, so a long video becomes easy to find your way around.
type Chapter struct {
	Start float64 `json:"start"` // seconds from the beginning of the file
	Title string  `json:"title"`
	By    string  `json:"by,omitempty"` // who marked it; empty when it came with the file
	At    int64   `json:"at,omitempty"` // when it was marked, Unix seconds
}

const (
	maxChapterTitle = 120
	maxChapters     = 1000
	// Two marks closer than this are the same place: a second one there would only be a duplicate.
	chapterGap = 1.0
)

// ErrNotYours is returned when someone changes a chapter another person marked.
var ErrNotYours = errors.New("only the person who marked it, or an administrator, can change it")

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

// AddChapter marks a new chapter at start, made by user.
func (s Store) AddChapter(it Item, start float64, title, user string) ([]Chapter, error) {
	title = Clip(title, maxChapterTitle)
	if title == "" {
		return nil, errors.New("give the chapter a name")
	}
	if start < 0 || math.IsNaN(start) || math.IsInf(start, 0) || (it.Duration > 0 && start >= float64(it.Duration)) {
		return nil, errors.New("that moment is not in the file")
	}
	mu.Lock()
	defer mu.Unlock()
	list := s.Chapters(it)
	if len(list) >= maxChapters {
		return nil, errors.New("this has as many chapters as it can hold")
	}
	for _, c := range list {
		if math.Abs(c.Start-start) < chapterGap {
			return nil, errors.New("there is already a chapter there")
		}
	}
	list = append(list, Chapter{Start: math.Round(start*10) / 10, Title: title, By: user, At: time.Now().Unix()})
	return list, s.writeChapters(it, list)
}

// ChangeChapter renames (title not empty) or removes (title empty) the chapter at start. Only whoever marked it may,
// or an administrator; the ones that came with the file are an administrator's to change.
func (s Store) ChangeChapter(it Item, start float64, title, user string, admin bool) ([]Chapter, error) {
	mu.Lock()
	defer mu.Unlock()
	list := s.Chapters(it)
	for i, c := range list {
		if math.Abs(c.Start-start) > 0.05 {
			continue
		}
		if !admin && (c.By == "" || c.By != user) {
			return nil, ErrNotYours
		}
		if title = Clip(title, maxChapterTitle); title == "" {
			list = append(list[:i], list[i+1:]...)
		} else {
			list[i].Title = title
		}
		return list, s.writeChapters(it, list)
	}
	return nil, os.ErrNotExist
}
