package userdata

import (
	"errors"
	"testing"
)

// A phone that comes back online with an old position must not undo where the computer got to since.
func TestOlderProgressNeverReplacesNewer(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	if _, err := s.SetProgress("ana", "dQw4w9WgXcQ", Progress{Position: 600, At: 2000}); err != nil {
		t.Fatal(err)
	}
	if kept, _ := s.SetProgress("ana", "dQw4w9WgXcQ", Progress{Position: 30, At: 1000}); kept.Position != 600 {
		t.Errorf("an older report won: %+v", kept)
	}
	if kept, _ := s.SetProgress("ana", "dQw4w9WgXcQ", Progress{Position: 900, Finished: true, At: 3000}); kept.Position != 900 || !kept.Finished {
		t.Errorf("a newer report lost: %+v", kept)
	}
	if got := s.AllProgress("bob"); len(got) != 0 {
		t.Errorf("bob sees ana's progress: %+v", got)
	}
	if _, err := s.SetProgress("ana", "../x", Progress{Position: 1}); err == nil {
		t.Error("an invalid item was accepted")
	}
	s.ForgetProgress("ana", "dQw4w9WgXcQ")
	if got := s.AllProgress("ana"); len(got) != 0 {
		t.Errorf("forgotten progress is still there: %+v", got)
	}
}

// Notes are private unless shared; a shared note shows to others with its author's name, never to its author twice.
func TestMarksArePrivateUntilShared(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	s.update("ana", func(st *State) { st.User, st.DisplayName = "ana", "Ana M." })
	s.update("bob", func(st *State) { st.User = "bob" })
	const item = "dQw4w9WgXcQ"
	bookmark, err := s.AddMark("ana", Mark{Item: item, At: 120.04, Shared: true})
	if err != nil || bookmark.At != 120 || bookmark.Shared {
		t.Fatalf("a bookmark with no text was shared: %+v %v", bookmark, err)
	}
	note, _ := s.AddMark("ana", Mark{Item: item, At: 60, Note: " Remember this "})
	if got := s.SharedMarks("bob", item); len(got) != 0 {
		t.Fatalf("bob sees ana's private notes: %+v", got)
	}
	shared := true
	if m, err := s.EditMark("ana", note.ID, nil, &shared); err != nil || !m.Shared || m.Note != "Remember this" {
		t.Fatalf("share: %+v %v", m, err)
	}
	got := s.SharedMarks("bob", item)
	if len(got) != 1 || got[0].User != "ana" || got[0].Name != "Ana M." || got[0].Note != "Remember this" {
		t.Fatalf("bob's view: %+v", got)
	}
	if got := s.SharedMarks("ana", item); len(got) != 0 {
		t.Errorf("ana sees her own note as someone else's: %+v", got)
	}
	if list := s.Marks("ana", item); len(list) != 2 || list[0].ID != note.ID {
		t.Errorf("ana's marks in order: %+v", list)
	}
	if err := s.DeleteMark("bob", note.ID); !errors.Is(err, ErrNoMark) {
		t.Errorf("bob deleted ana's note: %v", err)
	}
	if _, err := s.EditMark("bob", note.ID, &note.Note, nil); !errors.Is(err, ErrNoMark) {
		t.Errorf("bob edited ana's note: %v", err)
	}
	empty := ""
	if m, _ := s.EditMark("ana", note.ID, &empty, nil); m.Shared {
		t.Error("a note emptied of text stayed shared")
	}
	if err := s.DeleteMark("ana", note.ID); err != nil || len(s.Marks("ana", item)) != 1 {
		t.Errorf("delete: %v", err)
	}
}
