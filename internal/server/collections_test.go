package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/media"
)

func episode(t *testing.T, s *Server, it media.Item) media.Item {
	t.Helper()
	if err := os.MkdirAll(s.media.Dir(it.Kind, it.ID), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.media.Save(it); err != nil {
		t.Fatal(err)
	}
	return it
}

// Everyone can make a show; only whoever made it, or an administrator, can change it.
func TestShowsBelongToWhoeverMadeThem(t *testing.T) {
	_, h := accountsServer(t)
	rec := as(t, h, "ana", "POST", "/api/shows", `{"title":"Ana talks","author":"Ana","narrator":"dropped"}`)
	var show collectionOut
	if json.Unmarshal(rec.Body.Bytes(), &show); rec.Code != http.StatusCreated || show.Title != "Ana talks" || show.Narrator != "" || !show.CanEdit {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "bob", "PATCH", "/api/shows/"+show.ID, `{"title":"Bob's now"}`); rec.Code != http.StatusForbidden {
		t.Errorf("bob changed ana's show: %d", rec.Code)
	}
	if rec := as(t, h, "bob", "PUT", "/api/shows/"+show.ID+"/cover", string(jpegOf(t, 10, 10))); rec.Code != http.StatusForbidden {
		t.Errorf("bob changed ana's picture: %d", rec.Code)
	}
	if rec := as(t, h, "bob", "DELETE", "/api/shows/"+show.ID, ""); rec.Code != http.StatusForbidden {
		t.Errorf("bob deleted ana's show: %d", rec.Code)
	}
	if body := as(t, h, "bob", "GET", "/api/shows", "").Body.String(); !strings.Contains(body, `"can_edit":false`) || !strings.Contains(body, "Ana talks") {
		t.Errorf("bob's list: %s", body)
	}
	if rec := as(t, h, "ana", "PUT", "/api/shows/"+show.ID+"/cover", "not a jpeg"); rec.Code != http.StatusBadRequest {
		t.Errorf("a picture that is not a JPEG: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PUT", "/api/shows/"+show.ID+"/cover", string(jpegOf(t, 10, 10))); rec.Code != http.StatusOK {
		t.Errorf("ana's own picture: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "admin", "PATCH", "/api/shows/"+show.ID, `{"title":"Renamed"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"created_by":"ana"`) {
		t.Errorf("admin edit: %d %s", rec.Code, rec.Body)
	}
	// A show is not a book: each kind answers only for its own
	if rec := as(t, h, "ana", "GET", "/api/books/"+show.ID, ""); rec.Code != http.StatusNotFound {
		t.Errorf("a show answered as a book: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "DELETE", "/api/shows/"+show.ID, ""); rec.Code != http.StatusOK {
		t.Errorf("ana deleting her empty show: %d %s", rec.Code, rec.Body)
	}
}

func TestBookPartsComeInOrder(t *testing.T) {
	s, h := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune", Author: "Frank Herbert"}, "ana")
	episode(t, s, media.Item{ID: "partTwoxxxx", Kind: "audiobook", Parent: book.ID, Part: 2, Duration: 100, AddedAt: 1})
	episode(t, s, media.Item{ID: "partOnexxxx", Kind: "audiobook", Parent: book.ID, Part: 1, Duration: 50, AddedAt: 2, Thumb: "media.jpg"})
	var out struct {
		Collection collectionOut `json:"collection"`
		Items      []media.Item  `json:"items"`
	}
	json.Unmarshal(as(t, h, "bob", "GET", "/api/books/"+book.ID, "").Body.Bytes(), &out)
	if len(out.Items) != 2 || out.Items[0].ID != "partOnexxxx" || out.Collection.Duration != 150 || out.Collection.Thumb != "partOnexxxx" || out.Collection.CanEdit {
		t.Fatalf("book = %+v", out)
	}
	if rec := as(t, h, "ana", "DELETE", "/api/books/"+book.ID, ""); rec.Code != http.StatusConflict {
		t.Errorf("a book with parts was deleted: %d", rec.Code)
	}
}

// Anyone can mark a chapter and everyone sees it; only its author or an administrator changes it.
func TestChaptersAreSharedButOwned(t *testing.T) {
	s, h := accountsServer(t)
	it := episode(t, s, media.Item{ID: "dQw4w9WgXcQ", Kind: "podcast", Duration: 3600})
	if rec := as(t, h, "bob", "POST", "/api/media/"+it.ID+"/chapters", `{"start":125.5,"title":"The interview"}`); rec.Code != http.StatusOK {
		t.Fatalf("bob marking: %d %s", rec.Code, rec.Body)
	}
	if body := as(t, h, "ana", "GET", "/api/media/"+it.ID+"/chapters", "").Body.String(); !strings.Contains(body, "The interview") || !strings.Contains(body, `"by":"bob"`) {
		t.Errorf("ana does not see bob's chapter: %s", body)
	}
	if rec := as(t, h, "ana", "PATCH", "/api/media/"+it.ID+"/chapters", `{"start":125.5,"title":""}`); rec.Code != http.StatusForbidden {
		t.Errorf("ana removed bob's chapter: %d", rec.Code)
	}
	if rec := as(t, h, "bob", "PATCH", "/api/media/"+it.ID+"/chapters", `{"start":125.5,"title":"Interview"}`); rec.Code != http.StatusOK {
		t.Errorf("bob renaming his own: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "admin", "PATCH", "/api/media/"+it.ID+"/chapters", `{"start":125.5,"title":""}`); rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "Interview") {
		t.Errorf("admin removing: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "bob", "POST", "/api/media/"+it.ID+"/chapters", `{"start":4000,"title":"Later"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("a chapter past the end: %d", rec.Code)
	}
}

// Whoever added an episode may change or delete it; someone else may not, and only into a show of its kind.
func TestEpisodesBelongToWhoeverAddedThem(t *testing.T) {
	s, h := accountsServer(t)
	show, _ := s.media.CreateCollection(media.Collection{Kind: "podcast", Title: "Show"}, "bob")
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Book"}, "ana")
	it := episode(t, s, media.Item{ID: "dQw4w9WgXcQ", Kind: "podcast", Title: "Ep", AddedBy: "ana"})
	if rec := as(t, h, "bob", "PATCH", "/api/media/"+it.ID, `{"title":"Mine"}`); rec.Code != http.StatusForbidden {
		t.Errorf("bob renamed ana's episode: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PATCH", "/api/media/"+it.ID, `{"parent":"`+book.ID+`"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("an episode went into a book: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PATCH", "/api/media/"+it.ID, `{"parent":"`+show.ID+`","title":"Ep 1"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), show.ID) {
		t.Errorf("ana moving hers into bob's show: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "bob", "DELETE", "/api/media/"+it.ID, ""); rec.Code != http.StatusForbidden {
		t.Errorf("bob deleted ana's episode: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "DELETE", "/api/media/"+it.ID, ""); rec.Code != http.StatusOK {
		t.Errorf("ana deleting her own: %d %s", rec.Code, rec.Body)
	}
}

// An import into a show of the other kind, or one that does not exist, is refused before anything is downloaded.
func TestImportChecksTheCollection(t *testing.T) {
	s, h := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Book"}, "ana")
	for _, c := range []string{book.ID, "nothereatall"} {
		if rec := as(t, h, "ana", "POST", "/api/media/import?kind=podcast&url=https://youtu.be/dQw4w9WgXcQ&collection="+c, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("collection %s: %d %s", c, rec.Code, rec.Body)
		}
	}
}

func TestFileUnderFallsBackToTheChannel(t *testing.T) {
	s, _ := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Book"}, "ana")
	first := media.Item{ID: "aaaaaaaaaaa", Kind: "audiobook", Channel: "Narrator"}
	if err := s.fileUnder(&first, book.ID); err != nil || first.Parent != book.ID || first.Part != 1 {
		t.Fatalf("into the book: %+v %v", first, err)
	}
	gone := media.Item{ID: "bbbbbbbbbbb", Kind: "audiobook", Channel: "Narrator"}
	if err := s.fileUnder(&gone, "deletedbook"); err != nil || gone.Parent == "" || gone.Parent == book.ID {
		t.Fatalf("a deleted book: %+v %v", gone, err)
	}
}
