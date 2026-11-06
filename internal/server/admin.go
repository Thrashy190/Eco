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

// deleteSong removes a song from the library, for everyone: its file, and then Navidrome's record of it. A scan only
// marks a deleted file missing, and Navidrome keeps the song and its album, greyed out, until an administrator removes
// them through its own API, which needs a session opened with a password (see unlockAdmin). So the session must be open
// before anything is touched. The file is identified by library.FindSongFile, which refuses when it is not certain.
func (s *Server) deleteSong(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid song id")
		return
	}
	session, ok := s.admins.get(cred.User)
	if !ok {
		askForPassword(w)
		return
	}
	gone, code, err := s.removeSong(r.Context(), cred, session, id)
	if err != nil {
		fail(w, code, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"deleted": true, "file": gone.File, "purged": gone.Purged})
}

// askForPassword answers that Navidrome's own API is needed and the administrator must confirm their password first.
// Not a 401, which signs people out of the app, nor a 403, which is a wrong password.
func askForPassword(w http.ResponseWriter) {
	respond(w, http.StatusPreconditionRequired, map[string]any{"error": "Confirm your password first", "locked": true})
}

type removed struct {
	File   string // relative to the music folder
	Purged bool   // Navidrome forgot it too; if not, it is listed under Missing Files there
}

// removeSong erases one song's file and has Navidrome forget it. It returns what it did, or an HTTP status and what
// went wrong. Once the file is gone it reports success, even if Navidrome could not be made to forget the song.
func (s *Server) removeSong(ctx context.Context, cred subsonic.Cred, session, id string) (removed, int, error) {
	song, err := s.nd.Song(ctx, cred, id)
	if err != nil {
		var refused *subsonic.APIError
		if errors.As(err, &refused) {
			return removed{}, http.StatusNotFound, errors.New("That song is no longer in the library")
		}
		return removed{}, http.StatusBadGateway, errors.New("Navidrome: " + err.Error())
	}
	path, err := library.FindSongFile(s.cfg.MusicDir, song.Size, song.Suffix, song.Title)
	if err != nil {
		return removed{}, http.StatusConflict, errors.New("Nothing was deleted: " + err.Error())
	}
	if err := os.Remove(path); err != nil {
		return removed{}, http.StatusInternalServerError, errors.New("Could not delete the file: " + err.Error())
	}
	rel := library.Rel(s.cfg.MusicDir, path)
	log.Printf("admin %s deleted %s", cred.User, rel) // this cannot be undone, so it should leave a trace
	library.RemoveEmptyFolders(s.cfg.MusicDir, path)
	s.forgetLibrary()
	if err := s.users.ForgetEverywhere("song", id); err != nil {
		log.Printf("removing a deleted song from pins and recents: %v", err)
	}
	s.rescan(ctx, cred)
	purged := s.purge(ctx, cred, session, song)
	s.forgetLibrary()
	return removed{File: rel, Purged: purged}, http.StatusOK, nil
}

// purgeWait is how long purge keeps trying while the scan that marks the song missing has not reached it.
var purgeWait = 10 * time.Second

// purge has Navidrome forget a song whose file was deleted, then takes the album and artist it leaves empty out of
// everyone's recents and pins: Navidrome forgets those by itself once their last song goes, and until then they kept
// answering, so an emptied album stayed in Recent. It reports whether Navidrome no longer has the song.
func (s *Server) purge(ctx context.Context, cred subsonic.Cred, session string, song subsonic.Song) bool {
	deadline := time.Now().Add(purgeWait)
	for {
		if err := s.nd.PurgeMissing(ctx, session, []string{song.ID}); err != nil {
			if errors.Is(err, subsonic.ErrSessionOver) {
				s.admins.forget(cred.User)
			}
			log.Printf("Navidrome still lists the deleted song %s: %v", song.ID, err)
			return false
		}
		_, err := s.nd.Song(ctx, cred, song.ID)
		var refused *subsonic.APIError
		if errors.As(err, &refused) && refused.Code == 70 {
			break
		}
		// Navidrome only removes songs it has marked missing: the scan may not have got there yet
		if time.Now().After(deadline) {
			log.Printf("Navidrome still lists the deleted song %s: it has not marked it missing yet", song.ID)
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(500 * time.Millisecond):
		}
	}
	for _, item := range []struct{ kind, id string }{{"album", song.AlbumID}, {"artist", song.ArtistID}} {
		if item.id == "" {
			continue
		}
		if exists, err := s.nd.Exists(ctx, cred, item.kind, item.id); err == nil && !exists {
			if err := s.users.ForgetEverywhere(item.kind, item.id); err != nil {
				log.Printf("removing an emptied %s from pins and recents: %v", item.kind, err)
			}
		}
	}
	return true
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
