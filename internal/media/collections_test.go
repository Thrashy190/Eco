package media

import (
	"errors"
	"os"
	"testing"
)

func saved(t *testing.T, s Store, it Item) Item {
	t.Helper()
	if err := os.MkdirAll(s.Dir(it.Kind, it.ID), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(it); err != nil {
		t.Fatal(err)
	}
	return it
}

// Items from before shows and books existed are filed under one named after their channel, a book's parts in the
// order they were added, and running it again changes nothing.
func TestGroupFilesOlderItemsByChannel(t *testing.T) {
	s := Store{Root: t.TempDir()}
	saved(t, s, Item{ID: "part2xxxxxx", Kind: "audiobook", Title: "Dune 2", Channel: "Audio Books", AddedAt: 20})
	saved(t, s, Item{ID: "part1xxxxxx", Kind: "audiobook", Title: "Dune 1", Channel: "Audio Books", AddedAt: 10})
	saved(t, s, Item{ID: "episodexxxx", Kind: "podcast", Title: "Ep", Channel: "audio books", AddedAt: 5})
	saved(t, s, Item{ID: "nochannelxx", Kind: "podcast", Title: "Ep", AddedAt: 6})
	saved(t, s, Item{ID: "otherxxxxxx", Kind: "other", Title: "Talk", Channel: "Audio Books", AddedAt: 7})
	for range 2 {
		if err := s.Group(); err != nil {
			t.Fatal(err)
		}
	}
	books := s.Collections("audiobook")
	if len(books) != 1 || books[0].Title != "Audio Books" || books[0].CreatedBy != "" {
		t.Fatalf("books = %+v", books)
	}
	parts := s.Items(books[0])
	if len(parts) != 2 || parts[0].ID != "part1xxxxxx" || parts[0].Part != 1 || parts[1].Part != 2 {
		t.Fatalf("parts = %+v", parts)
	}
	shows := s.Collections("podcast")
	if len(shows) != 2 || shows[0].Title != "audio books" || shows[1].Title != "Unsorted" {
		t.Fatalf("a show and a book of one channel are different things: %+v", shows)
	}
	if it, _ := s.Find("otherxxxxxx"); it.Parent != "" {
		t.Errorf("other was given a collection: %+v", it)
	}
}

func TestShowEpisodesNewestFirst(t *testing.T) {
	s := Store{Root: t.TempDir()}
	c, err := s.CreateCollection(Collection{Kind: "podcast", Title: " My show ", Narrator: "nobody"}, "ana")
	if err != nil || c.Title != "My show" || c.Narrator != "" || c.CreatedBy != "ana" {
		t.Fatalf("created %+v %v", c, err)
	}
	saved(t, s, Item{ID: "oldoldoldol", Kind: "podcast", Parent: c.ID, Published: 100, AddedAt: 900})
	saved(t, s, Item{ID: "newnewnewne", Kind: "podcast", Parent: c.ID, Published: 200, AddedAt: 800})
	saved(t, s, Item{ID: "elsewhere00", Kind: "podcast", Parent: "anothershow", AddedAt: 999})
	if items := s.Items(c); len(items) != 2 || items[0].ID != "newnewnewne" {
		t.Fatalf("episodes = %+v", items)
	}
	if err := s.DeleteCollection(c.ID); err == nil {
		t.Fatal("a show with episodes was deleted")
	}
}

func TestCollectionEditKeepsWhoMadeIt(t *testing.T) {
	s := Store{Root: t.TempDir()}
	c, _ := s.CreateCollection(Collection{Kind: "audiobook", Title: "Dune", Series: "Dune", SeriesIndex: 1}, "ana")
	got, err := s.UpdateCollection(c.ID, Collection{Kind: "podcast", Title: "Dune", Author: "Frank Herbert", CreatedBy: "bob"})
	if err != nil || got.Kind != "audiobook" || got.CreatedBy != "ana" || got.Author != "Frank Herbert" || got.SeriesIndex != 0 {
		t.Fatalf("updated %+v %v", got, err)
	}
	if _, err := s.UpdateCollection(c.ID, Collection{Title: "  "}); err == nil {
		t.Error("an empty title was accepted")
	}
	if _, err := s.CreateCollection(Collection{Kind: "other", Title: "x"}, "ana"); err == nil {
		t.Error("a collection of other was made")
	}
	if _, err := s.Collection("../../etc"); err == nil {
		t.Error("Collection accepted a traversal")
	}
}

func TestChapters(t *testing.T) {
	s := Store{Root: t.TempDir()}
	it := saved(t, s, Item{ID: "dQw4w9WgXcQ", Kind: "audiobook", Duration: 3600})
	if err := s.SetSourceChapters(it, []Chapter{{Start: 600, Title: "Two", By: "sneaky"}, {Start: 0, Title: "One"}, {Start: 600.4, Title: "dup"}, {Start: 5000, Title: "past the end"}, {Start: 9, Title: " "}}); err != nil {
		t.Fatal(err)
	}
	list := s.Chapters(it)
	if len(list) != 2 || list[0].Title != "One" || list[1].By != "" {
		t.Fatalf("source chapters = %+v", list)
	}
	if _, err := s.AddChapter(it, 600.5, "Again", "ana"); err == nil {
		t.Error("a mark on top of another was accepted")
	}
	if _, err := s.AddChapter(it, 3600, "End", "ana"); err == nil {
		t.Error("a mark past the end was accepted")
	}
	if list, err := s.AddChapter(it, 1200.04, "Three", "ana"); err != nil || len(list) != 3 || list[2].Start != 1200 || list[2].By != "ana" {
		t.Fatalf("added %+v %v", list, err)
	}
	if _, err := s.ChangeChapter(it, 1200, "", "bob", false); !errors.Is(err, ErrNotYours) {
		t.Errorf("bob removed ana's chapter: %v", err)
	}
	if _, err := s.ChangeChapter(it, 0, "First", "ana", false); !errors.Is(err, ErrNotYours) {
		t.Errorf("a chapter from the file was renamed by a user: %v", err)
	}
	if list, err := s.ChangeChapter(it, 1200, "Third", "ana", false); err != nil || list[2].Title != "Third" {
		t.Fatalf("rename %+v %v", list, err)
	}
	if list, err := s.ChangeChapter(it, 0, "", "admin", true); err != nil || len(list) != 2 {
		t.Fatalf("admin remove %+v %v", list, err)
	}
	if _, err := s.ChangeChapter(it, 42, "", "admin", true); err == nil {
		t.Error("changing a chapter that is not there worked")
	}
}
