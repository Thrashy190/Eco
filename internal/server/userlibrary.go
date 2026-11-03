package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

const favoritesID = "favorites" // the favourites are Navidrome's stars, but the app shows them as a playlist

// withNavidromeRecents fills out the recents with albums Navidrome saw played (from any app), behind what the
// user opened in eco, so the view is useful from the first day.
func withNavidromeRecents(st userdata.State, played []subsonic.Album) userdata.State {
	recents := append([]userdata.Entry{}, st.Recents...)
	seen := map[string]bool{}
	for _, e := range recents {
		if e.Type == "album" {
			seen[e.ID] = true
		}
	}
	for _, a := range played {
		if !seen[a.ID] && len(recents) < userdata.MaxRecents {
			recents = append(recents, userdata.Entry{Type: "album", ID: a.ID, Name: a.Name, Subtitle: "Album · " + a.Artist, Cover: a.CoverArt})
		}
	}
	st.Recents = recents
	return st
}

func (s *Server) myLibrary(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	played, _ := s.nd.AlbumList(r.Context(), cred, "recent", 12) // the view still works without them
	respond(w, http.StatusOK, withNavidromeRecents(s.users.Get(cred.User), played))
}

func readEntry(r *http.Request) (userdata.Entry, error) {
	var e userdata.Entry
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&e); err != nil {
		return e, errors.New("invalid body")
	}
	return e, e.Validate()
}

// answer sends back the state a change produced, so the app never has to ask for it again.
func answer(w http.ResponseWriter, st userdata.State, err error) {
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, st)
}

func (s *Server) touchRecent(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	e, err := readEntry(r)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := s.users.Touch(cred.User, e)
	answer(w, st, err)
}

func (s *Server) forgetRecent(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	st, err := s.users.Forget(cred.User, r.PathValue("type"), r.PathValue("id"))
	answer(w, st, err)
}

func (s *Server) addPin(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	e, err := readEntry(r)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := s.users.Pin(cred.User, e)
	if errors.Is(err, userdata.ErrTooManyPins) {
		fail(w, http.StatusBadRequest, "You can pin up to 100 items. Unpin something first.")
		return
	}
	answer(w, st, err)
}

func (s *Server) removePin(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	st, err := s.users.Unpin(cred.User, r.PathValue("type"), r.PathValue("id"))
	answer(w, st, err)
}

// coverTarget validates a playlist ID from the URL: it must be a safe file name and a playlist this user can see
// (favourites always exist). That stops a signed-in user from filling the disk with covers for made-up IDs.
func (s *Server) coverTarget(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) (string, bool) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid playlist id")
		return "", false
	}
	if id == favoritesID {
		return id, true
	}
	exists, err := s.nd.PlaylistExists(r.Context(), cred, id)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return "", false
	}
	if !exists {
		fail(w, http.StatusNotFound, "no such playlist")
		return "", false
	}
	return id, true
}

// playlistCover serves a picture the user chose. Covers belong to the user who set them: Navidrome has no way to
// store one, so other Subsonic apps keep showing their own.
func (s *Server) playlistCover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(s.users.CoverPath(cred.User, id))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable") // the URL changes with the picture
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (s *Server) setPlaylistCover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := s.coverTarget(w, r, cred)
	if !ok {
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, userdata.MaxCoverBytes+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "could not read the picture")
		return
	}
	st, err := s.users.SetCover(cred.User, id, data)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, st)
}

func (s *Server) deletePlaylistCover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid playlist id")
		return
	}
	st, err := s.users.RemoveCover(cred.User, id)
	answer(w, st, err)
}
