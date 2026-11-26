package server

import (
	"net/http"
	"sort"
	"strings"

	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/stats"
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

// popularCount is how many songs an artist page shows as popular.
const popularCount = 10

// sameSongSlack is how far apart in seconds two copies of one song may be: the single and the album's track.
const sameSongSlack = 3

// popular picks up to n of an artist's songs, the most played on this server first. That is everyone's plays, all time,
// but only the order reaches the page, never a number, so it tells no one what another person played. Copies of one song
// (same title, about the same length) count together and show as their most played copy, or the single and the album
// would fill the list twice with it. Ties, and songs nobody played, keep the order given: the list is full whenever the
// artist has n songs, and holds all of them when they have fewer.
func popular(songs []subsonic.Song, plays map[string]int, n int) []string {
	type group struct {
		best    subsonic.Song
		top     int // the best copy's plays
		plays   int // all copies'
		seconds int
	}
	var groups []*group
	byTitle := map[string][]*group{}
	for _, song := range songs {
		title := strings.ToLower(strings.TrimSpace(song.Title))
		var g *group
		for _, other := range byTitle[title] {
			if d := other.seconds - song.Duration; d >= -sameSongSlack && d <= sameSongSlack {
				g = other
				break
			}
		}
		if g == nil {
			g = &group{best: song, top: -1, seconds: song.Duration}
			groups = append(groups, g)
			byTitle[title] = append(byTitle[title], g)
		}
		count := plays[song.ID]
		g.plays += count
		if count > g.top {
			g.best, g.top = song, count
		}
	}
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].plays > groups[j].plays })
	out := []string{}
	for _, g := range groups[:min(len(groups), n)] {
		out = append(out, g.best.ID)
	}
	return out
}

// ownFirst puts the songs on the artist's own albums (they are the album artist) before the ones they appear on, each
// part in the order it had, so a popular list that needs filling fills with their own songs first.
func ownFirst(songs []subsonic.Song, name string, known map[string]bool) []subsonic.Song {
	artist := match.Norm(name)
	var own, rest []subsonic.Song
	for _, song := range songs {
		mine := false
		for _, credited := range creditedNames(song.AlbumArtist, known) {
			mine = mine || match.Norm(credited) == artist
		}
		if mine {
			own = append(own, song)
		} else {
			rest = append(rest, song)
		}
	}
	return append(own, rest...)
}

// artistSongs answers GET /api/artists/songs?name=: the songs in the library by that artist, featured or not, and the
// IDs of their popular ones, most played first.
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
	songs := songsBy(lib, name)
	var plays map[string]int
	if all, imported, err := s.stats.Snapshot(); err == nil {
		plays = stats.SongPlays(all, imported)
	} // unreadable statistics still leave a list, in album order
	respond(w, http.StatusOK, map[string]any{"songs": songsOut(songs), "popular": popular(ownFirst(songs, name, lib.known), plays, popularCount)})
}
