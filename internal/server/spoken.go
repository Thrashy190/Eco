package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Where each person is in podcasts and audiobooks, and their bookmarks and notes. All of it is theirs alone, except
// the notes they choose to share, which anyone who opens that item sees.

func (s *Server) myProgress(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	respond(w, http.StatusOK, map[string]any{"progress": s.users.AllProgress(cred.User)})
}

func (s *Server) setMyProgress(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if _, err := s.media.Find(id); err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	var p userdata.Progress
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&p); err != nil {
		fail(w, http.StatusBadRequest, "could not read the position")
		return
	}
	kept, err := s.users.SetProgress(cred.User, id, p)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, kept)
}

func (s *Server) forgetMyProgress(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if err := s.users.ForgetProgress(cred.User, r.PathValue("id")); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]bool{"forgotten": true})
}

// continueItem is something the person started and has not finished, with the show or book it is in.
type continueItem struct {
	Item       media.Item        `json:"item"`
	Collection *media.Collection `json:"collection,omitempty"`
	Progress   userdata.Progress `json:"progress"`
}

// continueListening lists what the person is in the middle of, the most recently heard first. Items deleted since
// are left out.
func (s *Server) continueListening(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	out := []continueItem{}
	collections := map[string]*media.Collection{}
	for id, p := range s.users.AllProgress(cred.User) {
		if p.Finished || p.Position < 1 {
			continue
		}
		it, err := s.media.Find(id)
		if err != nil {
			continue
		}
		c, seen := collections[it.Parent]
		if !seen && it.Parent != "" {
			if found, err := s.media.Collection(it.Parent); err == nil {
				c = &found
			}
			collections[it.Parent] = c
		}
		out = append(out, continueItem{Item: it, Collection: c, Progress: p})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Progress.At > out[j].Progress.At })
	if len(out) > 50 {
		out = out[:50]
	}
	respond(w, http.StatusOK, map[string]any{"items": out})
}

// myMarks lists the person's marks; for one item (?item=) also the notes others shared on it.
func (s *Server) myMarks(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	item := r.URL.Query().Get("item")
	if item != "" && !media.ValidID(item) {
		fail(w, http.StatusBadRequest, "invalid item")
		return
	}
	out := map[string]any{"marks": s.users.Marks(cred.User, item)}
	if item != "" {
		out["shared"] = s.users.SharedMarks(cred.User, item)
	}
	respond(w, http.StatusOK, out)
}

func (s *Server) addMyMark(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var m userdata.Mark
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&m); err != nil {
		fail(w, http.StatusBadRequest, "could not read the bookmark")
		return
	}
	it, err := s.media.Find(m.Item)
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	if it.Duration > 0 && m.At > float64(it.Duration) {
		m.At = float64(it.Duration)
	}
	m, err = s.users.AddMark(cred.User, m)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusCreated, m)
}

func (s *Server) editMyMark(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in struct {
		Note   *string `json:"note"`
		Shared *bool   `json:"shared"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "could not read the bookmark")
		return
	}
	m, err := s.users.EditMark(cred.User, r.PathValue("id"), in.Note, in.Shared)
	answerMark(w, m, err)
}

func (s *Server) deleteMyMark(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	answerMark(w, map[string]bool{"deleted": true}, s.users.DeleteMark(cred.User, r.PathValue("id")))
}

// answerMark answers a missing mark exactly like someone else's: 404.
func answerMark(w http.ResponseWriter, v any, err error) {
	switch {
	case errors.Is(err, userdata.ErrNoMark):
		fail(w, http.StatusNotFound, "not found")
	case err != nil:
		fail(w, http.StatusInternalServerError, err.Error())
	default:
		respond(w, http.StatusOK, v)
	}
}
