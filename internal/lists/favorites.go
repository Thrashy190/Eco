package lists

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// Summary of a favourites sync.
type FavoritesResult struct {
	Starred int   // newly marked
	Already int   // were already favourites
	Missing []Row // downloaded but not (yet) in Navidrome's library
}

// SyncFavorites marks the downloaded songs of the list as favourites in Navidrome.
//
// Order matters: Navidrome remembers when each song was favourited, and the web app lists favourites
// newest first. The list is ordered with the most recent like first, so songs are starred from the
// last row up to the first, which makes the favourites read exactly like your likes did.
// Songs that are already favourites are left alone, so the step can be repeated safely.
func (r *Runner) SyncFavorites(ctx context.Context, nd *subsonic.Client, cred subsonic.Cred) (FavoritesResult, error) {
	var res FavoritesResult
	rows, err := r.load()
	if err != nil {
		return res, err
	}
	nd.StartScan(ctx, cred) // let Navidrome see files downloaded a moment ago
	songs, err := nd.AllSongs(ctx, cred)
	if err != nil {
		return res, fmt.Errorf("reading the Navidrome library: %w", err)
	}
	current, err := nd.Starred(ctx, cred)
	if err != nil {
		return res, err
	}
	starred := map[string]bool{}
	for _, s := range current {
		starred[s.ID] = true
	}
	index := map[string][]subsonic.Song{}
	for _, s := range songs {
		index[match.Norm(s.Title)] = append(index[match.Norm(s.Title)], s)
	}

	for i := len(rows) - 1; i >= 0; i-- {
		row := rows[i]
		if row.Status != Downloaded {
			continue
		}
		song, ok := findSong(index, row)
		switch {
		case !ok:
			res.Missing = append(res.Missing, row)
		case starred[song.ID]:
			res.Already++
		default:
			if err := nd.Star(ctx, cred, song.ID); err != nil {
				return res, fmt.Errorf("favouriting %q: %w", song.Title, err)
			}
			starred[song.ID] = true
			res.Starred++
			if res.Starred%100 == 0 {
				r.printf("  %d favourites marked…\n", res.Starred)
			}
			select {
			case <-time.After(starGap):
			case <-ctx.Done():
				return res, ctx.Err()
			}
		}
	}
	return res, nil
}

// starGap separates the timestamps of consecutive favourites so their order is preserved.
const starGap = 3 * time.Millisecond

// findSong picks the library song a row refers to. Several songs can share a title and artist
// (the single and the album version, a re-release), so ties are broken by album, then by length.
func findSong(index map[string][]subsonic.Song, row Row) (subsonic.Song, bool) {
	var best subsonic.Song
	bestScore, found := 1<<30, false
	wantAlbum := match.Norm(row.Album)
	ms, _ := strconv.Atoi(row.DurationMs)
	for _, s := range index[match.Norm(row.Title)] {
		if !match.SameArtist(row.Artist, s.Artist) {
			continue
		}
		score := abs(s.Duration - ms/1000)
		if wantAlbum != "" && match.Norm(s.Album) != wantAlbum {
			score += 1000
		}
		if score < bestScore {
			best, bestScore, found = s, score, true
		}
	}
	return best, found
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Describe prints a short report of a sync.
func (res FavoritesResult) Describe() string {
	var b strings.Builder
	fmt.Fprintf(&b, "✔ Favourites: %d newly marked, %d already were", res.Starred, res.Already)
	if n := len(res.Missing); n > 0 {
		fmt.Fprintf(&b, ", %d not in Navidrome yet (run again in a minute)", n)
		for i, row := range res.Missing {
			if i == 5 {
				break
			}
			fmt.Fprintf(&b, "\n    - %s — %s", row.Artist, row.Title)
		}
	}
	return b.String()
}
