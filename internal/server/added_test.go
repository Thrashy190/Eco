package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/jobs"
)

// mineIDs asks for a person's songs, newest first, and returns their IDs.
func mineIDs(t *testing.T, h http.Handler, user string) string {
	t.Helper()
	rec := as(t, h, user, "GET", "/api/songs?mine=1&sort=title", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", user, rec.Code, rec.Body)
	}
	var out struct {
		Songs []struct {
			ID string `json:"id"`
		} `json:"songs"`
		Total int `json:"total"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	var ids []string
	for _, s := range out.Songs {
		ids = append(ids, s.ID)
	}
	if out.Total != len(ids) {
		t.Errorf("%s: total %d for %d songs", user, out.Total, len(ids))
	}
	return strings.Join(ids, ",")
}

// finish stands in for the download queue: the job as it ended, and the same set function the queue hands a job.
func finish(job jobs.Job) func(func(*jobs.Job)) {
	return func(change func(*jobs.Job)) { change(&job) }
}

// A download is written down for everyone who asked for it, and Songs ▸ Added by you shows each person only their own.
// Navidrome had not listed one song yet when it finished: it is found by its title and artist.
func TestEachPersonSeesTheSongsTheyAdded(t *testing.T) {
	_, s := libraryServerOf(t,
		song("walk", "Walk", "Pantera", "Vulgar"),
		song("one", "One", "Metallica", "Justice"),
		song("espresso", "Espresso", "Sabrina Carpenter", "Short n' Sweet"),
		song("old", "Old", "Somebody", "Before"),
	)
	h := s.Handler()
	file := func(name string) string { return filepath.Join(s.cfg.MusicDir, "YouTube", name+".m4a") }
	s.rememberAdded(nil, finish(jobs.Job{Users: []string{"ana"}, Title: "Walk", Artist: "Pantera", File: file("walk"), LibraryID: "walk"}))
	s.rememberAdded(nil, finish(jobs.Job{Users: []string{"ana", "Luis"}, Title: "One", Artist: "Metallica", Album: "Justice", File: file("one")}))
	s.rememberAdded(nil, finish(jobs.Job{Users: []string{"luis"}, Title: "Espresso", Artist: "Sabrina Carpenter", File: file("espresso"), LibraryID: "espresso"}))
	// A podcast is not a song of the library, and a download that failed before saving anything leaves no file
	s.rememberAdded(mediaPayload{}, finish(jobs.Job{Users: []string{"ana"}, Title: "Old", Artist: "Somebody", File: file("old"), LibraryID: "old"}))
	s.rememberAdded(nil, finish(jobs.Job{Users: []string{"ana"}, Title: "Old", Artist: "Somebody"}))

	if got, want := mineIDs(t, h, "ana"), "one,walk"; got != want {
		t.Errorf("ana: %s, want %s", got, want)
	}
	if got, want := mineIDs(t, h, "LUIS"), "espresso,one"; got != want {
		t.Errorf("luis: %s, want %s", got, want)
	}
	if got := mineIDs(t, h, "nobody"); got != "" {
		t.Errorf("someone who added nothing sees %s", got)
	}
	if rec := as(t, h, "ana", "GET", "/api/songs?sort=title", ""); !strings.Contains(rec.Body.String(), `"total":4`) {
		t.Errorf("without mine=1 everyone sees the whole library: %s", rec.Body)
	}
	// The record is a path inside the music folder, and asking again for the same file does not repeat it
	s.rememberAdded(nil, finish(jobs.Job{Users: []string{"ana"}, Title: "Walk", Artist: "Pantera", File: file("walk")}))
	added := s.users.AddedSongs("ana")
	if len(added) != 2 || added[0].File != "YouTube/walk.m4a" || added[0].SongID != "walk" {
		t.Errorf("ana's records: %+v", added)
	}
}
