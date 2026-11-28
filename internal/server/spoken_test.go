package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/media"
)

// What one person heard and marked is theirs: another account sees none of it, except a note shared on purpose.
func TestSpokenProgressAndMarksArePerPerson(t *testing.T) {
	s, h := accountsServer(t)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune"}, "ana")
	it := episode(t, s, media.Item{ID: "dQw4w9WgXcQ", Kind: "audiobook", Duration: 3600, Parent: book.ID})
	as(t, h, "ana", "GET", "/api/me", "") // signs in, so the store knows her name
	if rec := as(t, h, "ana", "PUT", "/api/me/progress/"+it.ID, `{"position":600,"at":5}`); rec.Code != http.StatusOK {
		t.Fatalf("progress: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "ana", "PUT", "/api/me/progress/notanitem00", `{"position":1}`); rec.Code != http.StatusNotFound {
		t.Errorf("progress of nothing: %d", rec.Code)
	}
	if body := as(t, h, "bob", "GET", "/api/me/progress", "").Body.String(); strings.Contains(body, it.ID) {
		t.Errorf("bob sees ana's progress: %s", body)
	}
	var cont struct {
		Items []continueItem `json:"items"`
	}
	json.Unmarshal(as(t, h, "ana", "GET", "/api/me/continue", "").Body.Bytes(), &cont)
	if len(cont.Items) != 1 || cont.Items[0].Collection == nil || cont.Items[0].Collection.Title != "Dune" || cont.Items[0].Progress.Position != 600 {
		t.Fatalf("continue: %+v", cont)
	}
	if body := as(t, h, "bob", "GET", "/api/me/continue", "").Body.String(); strings.Contains(body, it.ID) {
		t.Errorf("bob's continue lists ana's book: %s", body)
	}

	rec := as(t, h, "ana", "POST", "/api/me/marks", `{"item":"`+it.ID+`","at":61,"note":"Great line"}`)
	var mark struct{ ID string }
	if json.Unmarshal(rec.Body.Bytes(), &mark); rec.Code != http.StatusCreated || mark.ID == "" {
		t.Fatalf("mark: %d %s", rec.Code, rec.Body)
	}
	if body := as(t, h, "bob", "GET", "/api/me/marks?item="+it.ID, "").Body.String(); strings.Contains(body, "Great line") {
		t.Errorf("bob sees a private note: %s", body)
	}
	if rec := as(t, h, "bob", "PATCH", "/api/me/marks/"+mark.ID, `{"shared":true}`); rec.Code != http.StatusNotFound {
		t.Errorf("bob shared ana's note: %d", rec.Code)
	}
	if rec := as(t, h, "bob", "DELETE", "/api/me/marks/"+mark.ID, ""); rec.Code != http.StatusNotFound {
		t.Errorf("bob deleted ana's note: %d", rec.Code)
	}
	as(t, h, "ana", "PATCH", "/api/me/marks/"+mark.ID, `{"shared":true}`)
	if body := as(t, h, "bob", "GET", "/api/me/marks?item="+it.ID, "").Body.String(); !strings.Contains(body, "Great line") || !strings.Contains(body, `"user":"ana"`) {
		t.Errorf("bob does not see the shared note: %s", body)
	}
}
