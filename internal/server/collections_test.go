package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
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

// Deleting a book with everything in it takes its parts too, but only when the person may delete every one of them.
func TestDeletingABookWithItsParts(t *testing.T) {
	s, h := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune"}, "ana")
	episode(t, s, media.Item{ID: "partOnexxxx", Kind: "audiobook", Parent: book.ID, Part: 1, AddedBy: "ana"})
	episode(t, s, media.Item{ID: "partTwoxxxx", Kind: "audiobook", Parent: book.ID, Part: 2, AddedBy: "bob"})
	if rec := as(t, h, "ana", "DELETE", "/api/books/"+book.ID+"?everything=1", ""); rec.Code != http.StatusForbidden {
		t.Errorf("ana deleted bob's part with her book: %d", rec.Code)
	}
	if _, err := s.media.Find("partOnexxxx"); err != nil {
		t.Errorf("a refused delete still took ana's part: %v", err)
	}
	if rec := as(t, h, "admin", "DELETE", "/api/books/"+book.ID+"?everything=1", ""); rec.Code != http.StatusOK {
		t.Fatalf("admin: %d %s", rec.Code, rec.Body)
	}
	for _, id := range []string{"partOnexxxx", "partTwoxxxx"} {
		if _, err := s.media.Find(id); err == nil {
			t.Errorf("%s is still there", id)
		}
	}
	if _, err := s.media.Collection(book.ID); err == nil {
		t.Error("the book is still there")
	}
}

// Related books are kept on both sides, and a book that goes stops being listed.
func TestRelatedBooksGoBothWays(t *testing.T) {
	s, h := accountsServer(t)
	one, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune"}, "ana")
	two, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune Messiah"}, "ana")
	show, _ := s.media.CreateCollection(media.Collection{Kind: "podcast", Title: "Show"}, "ana")
	body := `{"title":"Dune Messiah","related":["` + one.ID + `","` + show.ID + `","nothereatall","` + two.ID + `"]}`
	if rec := as(t, h, "ana", "PATCH", "/api/books/"+two.ID, body); rec.Code != http.StatusOK {
		t.Fatalf("linking: %d %s", rec.Code, rec.Body)
	}
	if c, _ := s.media.Collection(two.ID); len(c.Related) != 1 || c.Related[0] != one.ID {
		t.Errorf("two.related = %v, want only the first book", c.Related)
	}
	var out struct {
		Related []collectionOut `json:"related"`
	}
	json.Unmarshal(as(t, h, "bob", "GET", "/api/books/"+one.ID, "").Body.Bytes(), &out)
	if len(out.Related) != 1 || out.Related[0].ID != two.ID {
		t.Fatalf("the first book does not list the second: %+v", out.Related)
	}
	// Leaving related out keeps it; an empty list unlinks both sides
	as(t, h, "ana", "PATCH", "/api/books/"+two.ID, `{"title":"Dune Messiah II"}`)
	if c, _ := s.media.Collection(two.ID); len(c.Related) != 1 {
		t.Errorf("an edit without related dropped it: %v", c.Related)
	}
	as(t, h, "ana", "PATCH", "/api/books/"+one.ID, `{"title":"Dune","related":[]}`)
	if c, _ := s.media.Collection(two.ID); len(c.Related) != 0 {
		t.Errorf("unlinking from the first book left it on the second: %v", c.Related)
	}
	as(t, h, "ana", "PATCH", "/api/books/"+one.ID, `{"title":"Dune","related":["`+two.ID+`"]}`)
	if rec := as(t, h, "ana", "DELETE", "/api/books/"+one.ID, ""); rec.Code != http.StatusOK {
		t.Fatalf("deleting: %d", rec.Code)
	}
	if c, _ := s.media.Collection(two.ID); len(c.Related) != 0 {
		t.Errorf("a deleted book is still related: %v", c.Related)
	}
}

// Whoever made a book puts its parts in order, even ones someone else added; a stale list is refused.
func TestOrderingABooksParts(t *testing.T) {
	s, h := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune"}, "ana")
	episode(t, s, media.Item{ID: "partOnexxxx", Kind: "audiobook", Parent: book.ID, Part: 1, AddedBy: "bob"})
	episode(t, s, media.Item{ID: "partTwoxxxx", Kind: "audiobook", Parent: book.ID, Part: 2, AddedBy: "ana"})
	episode(t, s, media.Item{ID: "partThreexx", Kind: "audiobook", Parent: book.ID, Part: 7, AddedBy: "ana"})
	order := `{"items":["partThreexx","partOnexxxx","partTwoxxxx"]}`
	if rec := as(t, h, "bob", "PUT", "/api/books/"+book.ID+"/order", order); rec.Code != http.StatusForbidden {
		t.Errorf("bob ordered ana's book: %d", rec.Code)
	}
	for _, stale := range []string{`{"items":["partThreexx","partOnexxxx"]}`, `{"items":["partThreexx","partOnexxxx","partOnexxxx"]}`, `{"items":["partThreexx","partOnexxxx","nothereatal"]}`} {
		if rec := as(t, h, "ana", "PUT", "/api/books/"+book.ID+"/order", stale); rec.Code != http.StatusConflict {
			t.Errorf("%s: %d", stale, rec.Code)
		}
	}
	if rec := as(t, h, "ana", "PUT", "/api/books/"+book.ID+"/order", order); rec.Code != http.StatusOK {
		t.Fatalf("ordering: %d %s", rec.Code, rec.Body)
	}
	var got []string
	for _, it := range s.media.Items(book) {
		got = append(got, it.ID+":"+strconv.Itoa(it.Part))
	}
	if strings.Join(got, ",") != "partThreexx:1,partOnexxxx:2,partTwoxxxx:3" {
		t.Errorf("order = %v", got)
	}
	show, _ := s.media.CreateCollection(media.Collection{Kind: "podcast", Title: "Show"}, "ana")
	if rec := as(t, h, "ana", "PUT", "/api/shows/"+show.ID+"/order", `{"items":[]}`); rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("a show has an order: %d", rec.Code)
	}
}

// Only a YouTube playlist is listed, and its address is built by the server.
func TestPlaylistLinks(t *testing.T) {
	for raw, want := range map[string]string{
		"https://www.youtube.com/playlist?list=PLabcdefghij":                "https://www.youtube.com/playlist?list=PLabcdefghij",
		"https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij&index=3": "https://www.youtube.com/playlist?list=PLabcdefghij",
		"https://music.youtube.com/playlist?list=OLAK5uy_abcdefg":           "https://www.youtube.com/playlist?list=OLAK5uy_abcdefg",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":                       "",
		"https://evil.example/playlist?list=PLabcdefghij":                   "",
		"https://www.youtube.com/playlist?list=PL../../etc":                 "",
	} {
		got, err := youtubePlaylist(raw)
		if got != want || (want == "") != (err != nil) {
			t.Errorf("%s: %q %v, want %q", raw, got, err, want)
		}
	}
}

// A book's parts take the number the app gives them, however the downloads finish.
func TestImportedPartsKeepTheirNumber(t *testing.T) {
	s, h := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Book"}, "ana")
	third := media.Item{ID: "ccccccccccc", Kind: "audiobook"}
	if err := s.fileUnder(&third, book.ID, 3); err != nil || third.Part != 3 {
		t.Fatalf("part 3: %+v %v", third, err)
	}
	for _, bad := range []string{"0", "-2", "x"} {
		if rec := as(t, h, "ana", "POST", "/api/media/import?kind=audiobook&url=https://youtu.be/dQw4w9WgXcQ&collection="+book.ID+"&part="+bad, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("part %s: %d", bad, rec.Code)
		}
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
	if err := s.fileUnder(&first, book.ID, 0); err != nil || first.Parent != book.ID || first.Part != 1 {
		t.Fatalf("into the book: %+v %v", first, err)
	}
	gone := media.Item{ID: "bbbbbbbbbbb", Kind: "audiobook", Channel: "Narrator"}
	if err := s.fileUnder(&gone, "deletedbook", 0); err != nil || gone.Parent == "" || gone.Parent == book.ID {
		t.Fatalf("a deleted book: %+v %v", gone, err)
	}
}
