package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// externalAlbumOut is an album in the catalogue, which may or may not be in the library.
type externalAlbumOut struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Artist      string `json:"artist"`
	AlbumType   string `json:"album_type,omitempty"`
	Year        int    `json:"year,omitempty"`
	TotalTracks int    `json:"total_tracks"`
	CoverURL    string `json:"cover_url,omitempty"`
}

// albumTrackOut is one track of an album in the catalogue. Library is set when the library already has the song.
type albumTrackOut struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Artist   string   `json:"artist"`
	Disc     int      `json:"disc"`
	Track    int      `json:"track"`
	Duration int      `json:"duration"`
	Library  *songOut `json:"library,omitempty"`
}

func yearOf(date string) int {
	y, _ := strconv.Atoi(strings.SplitN(date, "-", 2)[0])
	return y
}

func externalAlbumOf(a catalog.Album) externalAlbumOut {
	return externalAlbumOut{a.ID, a.Name, a.Artist(), a.Type, yearOf(a.Date), a.TotalTracks, a.CoverURL}
}

func externalAlbums(in []catalog.Album) []externalAlbumOut {
	out := make([]externalAlbumOut, len(in))
	for i, a := range in {
		out[i] = externalAlbumOf(a)
	}
	return out
}

// sameAlbum compares an album of the library with one from the catalogue, ignoring case and punctuation.
func sameAlbum(name, artist, otherName, otherArtist string) bool {
	if match.Norm(name) != match.Norm(otherName) {
		return false
	}
	a, b := match.FirstArtist(artist), match.FirstArtist(otherArtist)
	return a != "" && b != "" && (a == b || contains(a, b) || contains(b, a))
}

// duplicateAlbums names the library albums the catalogue also returned. Its version of the page shows every track and
// which ones you have, so it says more than the library's.
func duplicateAlbums(local []subsonic.Album, found []externalAlbumOut) []string {
	out := []string{}
	for _, a := range local {
		for _, e := range found {
			if sameAlbum(a.Name, a.Artist, e.Name, e.Artist) {
				out = append(out, a.ID)
				break
			}
		}
	}
	return out
}

// missingAlbums keeps the albums credited to this artist that the library holds nothing from. A catalogue's search
// also returns albums that only mention the artist.
func missingAlbums(albums []catalog.Album, artist string, lib *snapshot) []externalAlbumOut {
	want := match.Norm(artist)
	owned := map[string]bool{}
	if lib != nil {
		for _, song := range lib.songs {
			owned[match.Norm(song.Album)] = true
		}
	}
	out := []externalAlbumOut{}
	for _, a := range albums {
		credited := false
		for _, who := range a.Artists {
			credited = credited || match.Norm(who) == want
		}
		if credited && !owned[match.Norm(a.Name)] {
			out = append(out, externalAlbumOf(a))
		}
	}
	return out
}

// albumTracks lists an album's tracks in order, marking the ones the library has.
func albumTracks(a catalog.Album, lib *snapshot) []albumTrackOut {
	out := make([]albumTrackOut, len(a.Tracks))
	for i, t := range a.Tracks {
		row := albumTrackOut{ID: t.ID, Title: t.Title, Artist: t.Artist, Disc: max(t.Disc, 1), Track: t.Meta.Track, Duration: t.DurationMs / 1000}
		if lib != nil {
			if song, ok := lib.find(t.Title, t.Artist, a.Name); ok {
				owned := songsOut([]subsonic.Song{song})[0]
				row.Library = &owned
			}
		}
		out[i] = row
	}
	return out
}

// catalogAlbum returns a whole album from the catalogue and which of its tracks are downloaded.
func (s *Server) catalogAlbum(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	source := s.eng.Catalog
	if !source.ValidID(id) {
		fail(w, http.StatusBadRequest, "This album link comes from another catalogue. Search for the album again.")
		return
	}
	album, err := source.Album(r.Context(), id)
	if errors.Is(err, catalog.ErrNotFound) {
		fail(w, http.StatusNotFound, "The catalogue does not have this album")
		return
	}
	if err != nil {
		fail(w, http.StatusBadGateway, "The catalogue: "+err.Error())
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"album": externalAlbumOf(album), "tracks": albumTracks(album, lib)})
}

// albumMatch gives a library album's page the whole album from the catalogue, with which tracks are downloaded, so an
// album looks the same however it was reached. Without a match the page simply stays what the library holds.
func (s *Server) albumMatch(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := r.URL.Query()
	name, artist := strings.TrimSpace(q.Get("name")), strings.TrimSpace(q.Get("artist"))
	if name == "" || artist == "" {
		fail(w, http.StatusBadRequest, "name and artist are required")
		return
	}
	none := map[string]any{"album": nil}
	source := s.eng.Catalog
	if source.Ready() != nil {
		respond(w, http.StatusOK, none)
		return
	}
	ctx, cancel := catalogContext(r)
	defer cancel()
	album, ok, err := source.FindAlbum(ctx, name, artist)
	if err != nil || !ok {
		respond(w, http.StatusOK, none)
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		lib = nil
	}
	respond(w, http.StatusOK, map[string]any{"album": externalAlbumOf(album), "tracks": albumTracks(album, lib)})
}
