package server

import (
	"net/http"
	"strings"

	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// An artist's page asks Navidrome for their albums, which only lists albums they are the album artist of. A song where
// they are one of several artists ("MCR-T, Joost") was on the page of the first one and nowhere on the others'. Older
// tags keep everyone in one name that Navidrome reads as a single artist, so this goes by name, over the whole library.

// creditedNames splits the artists a tag names. "; " always separates (Navidrome splits it too); a comma only when
// one of the pieces is a known artist, since it can be part of a name ("Tyler, The Creator"). The same rule as
// splitArtists in the web app.
func creditedNames(tag string, known map[string]bool) []string {
	var out []string
	for _, part := range strings.Split(tag, "; ") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, part)
		pieces := splitNames(part)
		if len(pieces) < 2 {
			continue
		}
		for _, piece := range pieces {
			if known[match.Norm(piece)] {
				out = append(out, pieces...)
				break
			}
		}
	}
	return out
}

// credits reports whether a song names this artist (normalised) as one of its artists or album artists.
func credits(song subsonic.Song, artist string, known map[string]bool) bool {
	for _, tag := range []string{song.Artist, song.AlbumArtist} {
		for _, name := range creditedNames(tag, known) {
			if match.Norm(name) == artist {
				return true
			}
		}
	}
	return false
}

// songsBy lists every song that credits the artist, in album order (album, disc, track).
func songsBy(lib *snapshot, name string) []subsonic.Song {
	artist := match.Norm(name)
	out := []subsonic.Song{}
	if artist == "" {
		return out
	}
	for _, song := range lib.orders["album"] {
		if credits(song, artist, lib.known) {
			out = append(out, song)
		}
	}
	return out
}

// artistSongs answers GET /api/artists/songs?name=: the songs in the library by that artist, featured or not.
func (s *Server) artistSongs(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		fail(w, http.StatusBadRequest, "name is required")
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"songs": songsOut(songsBy(lib, name))})
}
