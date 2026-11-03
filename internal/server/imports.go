package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/imports"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Importing a list: a file is read (importParse), the person chooses which of its lists to keep (importSave), and each
// one becomes a real playlist in Navidrome holding the songs the library has. Songs it lacks are only downloaded when
// asked (importDownload), since a long list can take hours; each one joins the playlist as it arrives.

const maxImportFile = 32 << 20

// importPayload is the job of downloading one song of a list.
type importPayload struct {
	Cred     subsonic.Cred
	ImportID string
	Row      imports.Row
}

type importRowOut struct {
	imports.Row
	Key     string   `json:"key"` // the job that downloads this song
	Library *songOut `json:"library,omitempty"`
}

type importOut struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	PlaylistID string         `json:"playlist_id,omitempty"`
	Total      int            `json:"total"`
	Owned      int            `json:"owned"`
	UpdatedAt  int64          `json:"updated_at"`
	Rows       []importRowOut `json:"rows,omitempty"`
}

// rowKey names the download of a song, the same for everyone who imports it, so it is only fetched once.
func rowKey(r imports.Row) string {
	sum := sha256.Sum256([]byte(match.Norm(r.Title) + "|" + match.FirstArtist(r.Artist)))
	return "import:" + hex.EncodeToString(sum[:10])
}

// matchRows finds each row in the library, keeping the list's order.
func matchRows(rows []imports.Row, lib *snapshot) []importRowOut {
	out := make([]importRowOut, len(rows))
	for i, r := range rows {
		out[i] = importRowOut{Row: r, Key: rowKey(r)}
		if lib == nil {
			continue
		}
		if song, ok := lib.find(r.Title, r.Artist, r.Album); ok {
			owned := songsOut([]subsonic.Song{song})[0]
			out[i].Library = &owned
		}
	}
	return out
}

func describeImport(imp userdata.Import, rows []importRowOut, withRows bool) importOut {
	out := importOut{ID: imp.ID, Name: imp.Name, PlaylistID: imp.PlaylistID, Total: len(rows), UpdatedAt: imp.UpdatedAt}
	for _, r := range rows {
		if r.Library != nil {
			out.Owned++
		}
	}
	if withRows {
		out.Rows = rows
	}
	return out
}

// importParse reads a file and says what is in it. Nothing is saved yet.
func (s *Server) importParse(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImportFile))
	if err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "this file is too large")
		return
	}
	lists, err := imports.Parse(r.URL.Query().Get("name"), data)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	type preview struct {
		imports.List
		Owned int `json:"owned"`
	}
	out := make([]preview, len(lists))
	for i, list := range lists {
		out[i] = preview{List: list}
		for _, row := range matchRows(list.Rows, lib) {
			if row.Library != nil {
				out[i].Owned++
			}
		}
	}
	respond(w, http.StatusOK, map[string]any{"lists": out})
}

// importSave creates a playlist from a list, or updates it when a list of that name was imported before.
func (s *Server) importSave(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var list imports.List
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxImportFile)).Decode(&list); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	list.Name = strings.TrimSpace(list.Name)
	if list.Name == "" || len(list.Rows) == 0 || len(list.Rows) > imports.MaxRows {
		fail(w, http.StatusBadRequest, "a list needs a name and songs")
		return
	}
	id := userdata.ImportID(list.Name)
	imp, ok := s.users.Import(cred.User, id)
	if !ok {
		imp = userdata.Import{ID: id}
	}
	imp.Name, imp.Rows = list.Name, list.Rows
	out, err := s.syncImport(r.Context(), cred, imp)
	if err != nil {
		fail(w, http.StatusBadGateway, err.Error())
		return
	}
	respond(w, http.StatusOK, out)
}

// syncImport makes the playlist hold what the library has of the list, in the list's order, followed by anything added
// to the playlist by hand. The playlist is only written when that changes something.
func (s *Server) syncImport(ctx context.Context, cred subsonic.Cred, imp userdata.Import) (importOut, error) {
	lib, err := s.library(ctx, cred)
	if err != nil {
		return importOut{}, errors.New("Navidrome: " + err.Error())
	}
	rows := matchRows(imp.Rows, lib)
	linked := []string{}
	for _, row := range rows {
		if row.Library != nil && !slices.Contains(linked, row.Library.ID) {
			linked = append(linked, row.Library.ID)
		}
	}
	var current []string
	if imp.PlaylistID != "" {
		songs, err := s.nd.PlaylistSongs(ctx, cred, imp.PlaylistID)
		var gone *subsonic.APIError
		switch {
		case errors.As(err, &gone):
			imp.PlaylistID = "" // deleted in the meantime: it comes back
		case err != nil:
			return importOut{}, errors.New("Navidrome: " + err.Error())
		}
		for _, song := range songs {
			current = append(current, song.ID)
		}
	}
	wanted := append([]string{}, linked...)
	for _, id := range current {
		if !slices.Contains(linked, id) && !slices.Contains(imp.Linked, id) {
			wanted = append(wanted, id)
		}
	}
	if (imp.PlaylistID == "" && len(wanted) > 0) || (imp.PlaylistID != "" && !slices.Equal(current, wanted)) {
		id, err := s.nd.SavePlaylist(ctx, cred, imp.PlaylistID, imp.Name, wanted)
		if err != nil {
			return importOut{}, errors.New("Navidrome: " + err.Error())
		}
		imp.PlaylistID = id
	}
	imp.Linked = linked
	if err := s.users.SaveImport(cred.User, imp); err != nil {
		return importOut{}, err
	}
	saved, _ := s.users.Import(cred.User, imp.ID)
	return describeImport(saved, rows, true), nil
}

func (s *Server) importList(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	lib, _ := s.library(r.Context(), cred)
	out := []importOut{}
	for _, imp := range s.users.Imports(cred.User) {
		out = append(out, describeImport(imp, matchRows(imp.Rows, lib), false))
	}
	respond(w, http.StatusOK, map[string]any{"imports": out})
}

// oneImport finds the import a request names. Another user's import answers exactly like a missing one.
func (s *Server) oneImport(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) (userdata.Import, bool) {
	imp, ok := s.users.Import(cred.User, r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "That list was not found")
	}
	return imp, ok
}

func (s *Server) importGet(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	imp, ok := s.oneImport(w, r, cred)
	if !ok {
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	respond(w, http.StatusOK, describeImport(imp, matchRows(imp.Rows, lib), true))
}

// importSync brings the playlist up to date with the library.
func (s *Server) importSync(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	imp, ok := s.oneImport(w, r, cred)
	if !ok {
		return
	}
	s.forgetLibrary()
	out, err := s.syncImport(r.Context(), cred, imp)
	if err != nil {
		fail(w, http.StatusBadGateway, err.Error())
		return
	}
	respond(w, http.StatusOK, out)
}

// importDownload queues the songs of a list the library does not have.
func (s *Server) importDownload(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	imp, ok := s.oneImport(w, r, cred)
	if !ok {
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	queued := 0
	for _, row := range matchRows(imp.Rows, lib) {
		if row.Library != nil {
			continue
		}
		wanted := row.Row
		job, isNew := s.jobs.SubmitWith(row.Key, cred.User, importPayload{cred, imp.ID, wanted}, func(j *jobs.Job) {
			j.Title, j.Artist, j.Album = wanted.Title, wanted.Artist, wanted.Album
		})
		if job.State == jobs.Failed && job.Error != "" && isNew {
			fail(w, http.StatusServiceUnavailable, "The download queue is full. "+job.Error)
			return
		}
		queued++
	}
	respond(w, http.StatusOK, map[string]any{"queued": queued})
}

func (s *Server) importForget(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if _, ok := s.oneImport(w, r, cred); !ok {
		return
	}
	if err := s.users.DeleteImport(cred.User, r.PathValue("id")); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"forgotten": true})
}

// metaForImport finds a listed song in the catalogue for its full tags and cover. When the catalogue cannot say, the
// list's own details still let the song be looked for on YouTube; a list with no length fails the check there instead
// of risking the wrong song.
func (s *Server) metaForImport(ctx context.Context, row imports.Row) catalog.Meta {
	if s.eng.Catalog.Ready() == nil {
		find, cancel := context.WithTimeout(ctx, catalogTimeout)
		defer cancel()
		want := catalog.Wanted{Title: row.Title, Artist: row.Artist, Album: row.Album, ISRC: row.ISRC, DurationMs: row.DurationMs}
		if track, ok, err := s.eng.Catalog.FindTrack(find, want); err == nil && ok {
			return track.Meta
		}
	}
	album := row.Album
	if album == "" {
		album = row.Title
	}
	return catalog.Meta{Title: row.Title, Artist: row.Artist, AlbumArtist: firstOf(row.Artist), Album: album, ISRC: row.ISRC, DurationMs: row.DurationMs}
}

func firstOf(artists string) string {
	first, _, _ := strings.Cut(artists, ",")
	return strings.TrimSpace(first)
}
