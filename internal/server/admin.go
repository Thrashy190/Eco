package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// me tells the web app who is signed in and whether to offer admin actions. The offer is only a convenience: every
// admin action checks again on the server.
func (s *Server) me(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	admin, _ := s.nd.IsAdmin(r.Context(), cred) // if Navidrome cannot answer, offer nothing
	respond(w, http.StatusOK, map[string]any{"user": cred.User, "admin": admin, "catalog": s.eng.Catalog.Name()})
}

// adminOnly lets a request through only for a Navidrome administrator. It asks Navidrome every time rather than
// using the remembered sign-in: these actions destroy things, and a demoted admin must lose them at once.
func (s *Server) adminOnly(h apiHandler) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		admin, err := s.nd.IsAdmin(r.Context(), cred)
		if err != nil {
			fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
			return
		}
		if !admin {
			fail(w, http.StatusForbidden, "Only an administrator can do this")
			return
		}
		h(w, r, cred)
	}
}

// deleteSong removes a song's file from the library, for everyone. Navidrome notices at its next scan, which is
// started right away. The file is identified by library.FindSongFile, which refuses when it is not certain.
func (s *Server) deleteSong(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid song id")
		return
	}
	rel, code, err := s.removeSong(r.Context(), cred, id)
	if err != nil {
		fail(w, code, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"deleted": true, "file": rel})
}

// removeSong erases one song's file. It returns the file's name, or an HTTP status and what went wrong.
func (s *Server) removeSong(ctx context.Context, cred subsonic.Cred, id string) (string, int, error) {
	song, err := s.nd.Song(ctx, cred, id)
	if err != nil {
		var refused *subsonic.APIError
		if errors.As(err, &refused) {
			return "", http.StatusNotFound, errors.New("That song is no longer in the library")
		}
		return "", http.StatusBadGateway, errors.New("Navidrome: " + err.Error())
	}
	path, err := library.FindSongFile(s.cfg.MusicDir, song.Size, song.Suffix, song.Title)
	if err != nil {
		return "", http.StatusConflict, errors.New("Nothing was deleted: " + err.Error())
	}
	if err := os.Remove(path); err != nil {
		return "", http.StatusInternalServerError, errors.New("Could not delete the file: " + err.Error())
	}
	rel := library.Rel(s.cfg.MusicDir, path)
	log.Printf("admin %s deleted %s", cred.User, rel) // this cannot be undone, so it should leave a trace
	library.RemoveEmptyFolders(s.cfg.MusicDir, path)
	s.forgetLibrary()
	if err := s.users.ForgetEverywhere("song", id); err != nil {
		log.Printf("removing a deleted song from pins and recents: %v", err)
	}
	s.rescan(ctx, cred)
	s.forgetLibrary()
	return rel, http.StatusOK, nil
}

// rescan starts a scan and waits for it, so lists fetched right after this no longer show the song. Asking for the
// song itself would not do: Navidrome keeps answering for files it has marked as missing. Running out of time is
// fine, the scan finishes on its own.
func (s *Server) rescan(ctx context.Context, cred subsonic.Cred) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := s.nd.StartScan(ctx, cred); err != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(250 * time.Millisecond):
		}
		if scanning, err := s.nd.Scanning(ctx, cred); err != nil || !scanning {
			return
		}
	}
}
