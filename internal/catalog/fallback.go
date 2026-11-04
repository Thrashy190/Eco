package catalog

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/Thrashy190/eco/internal/match"
)

// CoverFinder is a source that can find an album's picture by its name.
type CoverFinder interface {
	FindCover(ctx context.Context, album, artist string) string
}

// Fallback answers from Main, and asks Backup for what Main could not answer. Main refusing or being down counts too.
type Fallback struct {
	Main, Backup Source
}

// Name implements Source.
func (f *Fallback) Name() string { return f.Main.Name() + " + " + f.Backup.Name() }

// Ready implements Source.
func (f *Fallback) Ready() error { return f.Main.Ready() }

// ValidID implements Source.
func (f *Fallback) ValidID(id string) bool { return f.Main.ValidID(id) || f.Backup.ValidID(id) }

func (f *Fallback) owner(id string) Source {
	if f.Backup.ValidID(id) && !f.Main.ValidID(id) {
		return f.Backup
	}
	return f.Main
}

// Track implements Source: the ID says which catalogue it came from.
func (f *Fallback) Track(ctx context.Context, id string) (Track, error) {
	return f.owner(id).Track(ctx, id)
}

// Album implements Source: the ID says which catalogue it came from.
func (f *Fallback) Album(ctx context.Context, id string) (Album, error) {
	return f.owner(id).Album(ctx, id)
}

func trackKey(t Track) string { return match.Norm(t.Title) + "|" + match.FirstArtist(t.Artist) }
func albumKey(a Album) string { return match.Norm(a.Name) + "|" + match.FirstArtist(a.Artist()) }

// sameLengthMs is how far apart two catalogues can be and still mean the same recording.
const sameLengthMs = 10000

// mergeTracks puts first what both catalogues have, which is the surest sign a result is real, in Backup's order, since it
// knows what people look for. A song in both stays Main's unless their lengths disagree: Main lists every take of a song
// and may have chosen a live one. The rest alternates, because each catalogue finds what the other buries: for "espresso"
// Main knows a band of that name, and for "tití me preguntó" Backup lists covers first.
func mergeTracks(main, backup []Track) []Track {
	ofMain := map[string]Track{}
	for _, t := range main {
		if _, seen := ofMain[trackKey(t)]; !seen {
			ofMain[trackKey(t)] = t
		}
	}
	ofBackup := map[string]bool{}
	var both, onlyBackup []Track
	for _, t := range backup {
		key := trackKey(t)
		if ofBackup[key] {
			continue
		}
		ofBackup[key] = true
		own, inMain := ofMain[key]
		if !inMain {
			onlyBackup = append(onlyBackup, t)
			continue
		}
		diff := own.DurationMs - t.DurationMs
		if diff < 0 {
			diff = -diff
		}
		if own.DurationMs > 0 && diff <= sameLengthMs {
			if t.CoverURL != "" {
				own.CoverURL = t.CoverURL // shown right away; a volunteer catalogue may not have a picture
			}
			t = own
		}
		both = append(both, t)
	}
	var onlyMain []Track
	used := map[string]bool{}
	for _, t := range main {
		if key := trackKey(t); !ofBackup[key] && !used[key] {
			used[key] = true
			onlyMain = append(onlyMain, t)
		}
	}
	return append(both, alternate(onlyBackup, onlyMain)...)
}

// alternate takes one from each list in turn, starting with first.
func alternate[T any](first, second []T) []T {
	out := make([]T, 0, len(first)+len(second))
	for i := 0; i < len(first) || i < len(second); i++ {
		if i < len(first) {
			out = append(out, first[i])
		}
		if i < len(second) {
			out = append(out, second[i])
		}
	}
	return out
}

func mergeAlbums(main, backup []Album) []Album {
	ofMain := map[string]Album{}
	for _, a := range main {
		if _, seen := ofMain[albumKey(a)]; !seen {
			ofMain[albumKey(a)] = a
		}
	}
	ofBackup := map[string]bool{}
	var both, onlyBackup []Album
	for _, a := range backup {
		key := albumKey(a)
		if ofBackup[key] {
			continue
		}
		ofBackup[key] = true
		own, inMain := ofMain[key]
		if !inMain {
			onlyBackup = append(onlyBackup, a)
			continue
		}
		if a.CoverURL != "" {
			own.CoverURL = a.CoverURL
		}
		both = append(both, own)
	}
	var onlyMain []Album
	used := map[string]bool{}
	for _, a := range main {
		if key := albumKey(a); !ofBackup[key] && !used[key] {
			used[key] = true
			onlyMain = append(onlyMain, a)
		}
	}
	return append(both, alternate(onlyBackup, onlyMain)...)
}

// Search implements Source. Both are asked at once for every search, not only when Main comes back empty: it hardly ever
// does, it answers with something else, and it has no way to rank what it finds or to tell a studio take from a live one.
// Past Backup's limit, Main's answer stands alone.
func (f *Fallback) Search(ctx context.Context, query string) (Results, error) {
	var more Results
	var errBackup error
	done := make(chan struct{})
	go func() {
		defer close(done)
		more, errBackup = f.Backup.Search(ctx, query)
	}()
	found, err := f.Main.Search(ctx, query)
	<-done
	if errBackup != nil {
		return found, err // Main's answer, or Main's reason
	}
	found.Tracks = mergeTracks(found.Tracks, more.Tracks)
	found.Albums = mergeAlbums(found.Albums, more.Albums)
	asked := wordSet(query)
	sort.SliceStable(found.Tracks, func(i, j int) bool {
		return closeness(asked, found.Tracks[i].Title, found.Tracks[i].Artist) > closeness(asked, found.Tracks[j].Title, found.Tracks[j].Artist)
	})
	sort.SliceStable(found.Albums, func(i, j int) bool {
		return closeness(asked, found.Albums[i].Name, found.Albums[i].Artist()) > closeness(asked, found.Albums[j].Name, found.Albums[j].Artist())
	})
	return found, nil
}

func wordSet(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields(match.Norm(s)) {
		out[w] = true
	}
	return out
}

func sameWords(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for w := range a {
		if !b[w] {
			return false
		}
	}
	return true
}

// closeness says how plainly a result is what was typed: 2 for the artist and the title with nothing else, 1 for the
// title alone. A remix or a medley that merely mentions the song ranks below the song.
func closeness(asked map[string]bool, title, artist string) int {
	titleWords := wordSet(title)
	if len(titleWords) == 0 {
		return 0
	}
	together := map[string]bool{}
	for w := range titleWords {
		together[w] = true
	}
	for w := range wordSet(FirstName(artist)) {
		together[w] = true
	}
	switch {
	case sameWords(asked, together):
		return 2
	case sameWords(asked, titleWords):
		return 1
	}
	return 0
}

// FindAlbum implements Source.
func (f *Fallback) FindAlbum(ctx context.Context, name, artist string) (Album, bool, error) {
	album, ok, err := f.Main.FindAlbum(ctx, name, artist)
	if err == nil && ok {
		return album, true, nil
	}
	album, ok, errBackup := f.Backup.FindAlbum(ctx, name, artist)
	switch {
	case errBackup == nil && ok:
		return album, true, nil
	case err != nil: // Main could not say, so Backup not having it does not mean there is no such album
		return Album{}, false, err
	}
	return Album{}, false, errBackup
}

// FindTrack implements Source.
func (f *Fallback) FindTrack(ctx context.Context, want Wanted) (Track, bool, error) {
	track, ok, err := f.Main.FindTrack(ctx, want)
	if err == nil && ok {
		return track, true, nil
	}
	track, ok, errBackup := f.Backup.FindTrack(ctx, want)
	if errBackup == nil {
		return track, ok, nil
	}
	return Track{}, false, err
}

// ByArtist implements Source.
func (f *Fallback) ByArtist(ctx context.Context, name string) ([]Track, []Album, error) {
	tracks, albums, err := f.Main.ByArtist(ctx, name)
	if err == nil && (len(tracks) > 0 || len(albums) > 0) {
		return tracks, albums, nil
	}
	moreTracks, moreAlbums, errBackup := f.Backup.ByArtist(ctx, name)
	if errBackup != nil {
		return tracks, albums, errors.Join(err, errBackup)
	}
	return moreTracks, moreAlbums, nil
}

// FindCover implements CoverFinder, for an album the main catalogue has no picture of.
func (f *Fallback) FindCover(ctx context.Context, album, artist string) string {
	if finder, ok := f.Backup.(CoverFinder); ok {
		return finder.FindCover(ctx, album, artist)
	}
	return ""
}

// FirstName is the first artist of "A, B", "A; B" or "A & B", as written.
func FirstName(artists string) string {
	if i := strings.IndexAny(artists, ",;&"); i > 0 {
		artists = artists[:i]
	}
	return strings.TrimSpace(artists)
}
