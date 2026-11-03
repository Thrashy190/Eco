package musicbrainz

import (
	"regexp"
	"sort"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/match"
)

// MusicBrainz has no popularity figures and lists every recording of a song as its own result, covers and lullaby
// versions included, so what comes back needs ranking. Everything here works on plain data and has tests.

// odd titles and albums, unless the search asks for them.
var (
	reOddTitle = regexp.MustCompile(`(?i)\b(live|en vivo|karaoke|instrumental|acapella|a cappella|commentary|interview|tribute|lullaby|lullabies|rendition|cover|sped ?up|slowed|nightcore|8d|medley|megamix|demo|version|remix|chopped|screwed|trailer|documentary)\b`)
	reConcert  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}\b`) // "2004-10-19: Wachovia Center": bands sell every show as a release
	reVersion  = regexp.MustCompile(`\s*[\(\[][^\)\]]*[\)\]]\s*$`)
)

// stripVersion removes a trailing "(feat. X)" or "(Deluxe)": catalogues disagree about them, and they are compared
// afterwards anyway.
func stripVersion(title string) string {
	if clean := strings.TrimSpace(reVersion.ReplaceAllString(title, "")); clean != "" {
		return clean
	}
	return title
}

// typeRank says how good a release group is as the home of a song. Higher is better.
func typeRank(g releaseGroup) int {
	for _, s := range g.SecondaryTypes {
		switch s {
		case "Compilation", "Live", "Remix", "DJ-mix", "Interview", "Audiobook", "Spokenword", "Audio drama", "Demo":
			return 0
		}
	}
	switch g.PrimaryType {
	case "Album":
		return 3
	case "EP":
		return 2
	case "Single":
		return 1
	}
	return 0
}

// releaseScore prefers official releases on a real album, then the earliest: the album a song first came out on, not
// the "Today's Hits" playlist that also carries it.
func releaseScore(r release) int {
	score := typeRank(r.ReleaseGroup) * 10
	if r.Status == "Official" {
		score += 100
	}
	if isVarious(r.Credit) {
		score -= 25
	}
	if reConcert.MatchString(r.Title) {
		score -= 60
	}
	return score
}

func isVarious(credits []credit) bool {
	for _, c := range credits {
		if strings.EqualFold(c.Artist.Name, "Various Artists") || strings.EqualFold(c.Name, "Various Artists") {
			return true
		}
	}
	return false
}

// earlier compares partial dates ("2022", "2022-05-06"); a missing date comes last.
func earlier(a, b string) bool {
	if a == "" || b == "" {
		return a != ""
	}
	return a < b
}

// bestRelease chooses which release a song is presented on.
func bestRelease(releases []release) release {
	var best release
	for i, r := range releases {
		if i == 0 || releaseScore(r) > releaseScore(best) || (releaseScore(r) == releaseScore(best) && earlier(r.Date, best.Date)) {
			best = r
		}
	}
	return best
}

// bestEdition chooses which release of an album to list. Reissues and vinyl exist side by side: the first official one
// is the album as people know it, and a worldwide digital edition is not split into the sides of a record.
func bestEdition(releases []release) release {
	score := func(r release) int {
		s := 0
		if r.Status == "Official" {
			s += 100
		}
		if r.Country == "XW" {
			s += 5
		}
		for _, m := range r.Media {
			if strings.Contains(m.Format, "Digital") {
				s += 10
				break
			}
			if strings.Contains(m.Format, "Vinyl") || strings.Contains(m.Format, "Cassette") {
				s -= 10
				break
			}
		}
		return s
	}
	var best release
	for i, r := range releases {
		if i == 0 || score(r) > score(best) || (score(r) == score(best) && earlier(r.Date, best.Date)) {
			best = r
		}
	}
	return best
}

// queryWords is the search as a set of normalised words.
func queryWords(q string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields(plain(q)) {
		out[w] = true
	}
	return out
}

// plain normalises without removing "(...)" or what follows "feat": a search is not a title.
func plain(s string) string {
	return match.Norm(strings.NewReplacer("(", " ", ")", " ", "[", " ", "]", " ", " - ", " ").Replace(s))
}

func allIn(words []string, set map[string]bool) bool {
	if len(words) == 0 {
		return false
	}
	for _, w := range words {
		if !set[w] {
			return false
		}
	}
	return true
}

func creditNamed(credits []credit, q map[string]bool) bool {
	for _, n := range names(credits) {
		if allIn(strings.Fields(match.Norm(n)), q) {
			return true
		}
	}
	return false
}

// scoreRecording rates one recording against a search. A title that is exactly what was typed (after the artist's name,
// if that was typed too) beats a song by an artist of that name: "ella baila sola" means the song before the duo.
func scoreRecording(q map[string]bool, r recording) int {
	title := strings.Fields(match.Norm(r.Title))
	rest := map[string]bool{}
	for w := range q {
		rest[w] = true
	}
	named := creditNamed(r.Credit, q)
	if named {
		for _, n := range names(r.Credit) {
			if allIn(strings.Fields(match.Norm(n)), q) {
				for _, w := range strings.Fields(match.Norm(n)) {
					delete(rest, w)
				}
			}
		}
	}
	score := r.Score / 10
	score += typeRank(bestRelease(r.Releases).ReleaseGroup) * 5
	switch {
	case len(rest) == 0 && named:
		score += 50 // the search is this artist's name
	case len(title) == len(rest) && allIn(title, rest):
		score += 100 // the search is this title, with or without the artist
		if named {
			score += 50
		}
	case named:
		score += 30
	}
	for _, w := range title {
		if !q[w] {
			score -= 3 // the more words a title has beyond the search, the less it is what was asked for
		}
	}
	if odd := reOddTitle.FindAllString(r.Title, -1); len(odd) > 0 && !allIn(lower(odd), q) {
		score -= 60
	}
	if r.Video {
		score -= 30
	}
	if isVarious(r.Credit) {
		score -= 40
	}
	return score
}

func lower(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = strings.ToLower(s)
	}
	return out
}

func songKey(r recording) string {
	return match.Norm(r.Title) + "|" + match.FirstArtist(strings.Join(names(r.Credit), ", "))
}

// rankRecordings orders a search's results, with one result per song. There are no popularity figures, but a song people
// know has been recorded on many releases, so how many stands in for them.
func rankRecordings(query string, recs []recording) []recording {
	q := queryWords(query)
	known := map[string]int{}
	for _, r := range recs {
		known[songKey(r)] += 2 + len(r.Releases)
	}
	score := func(r recording) int { return scoreRecording(q, r) + min(known[songKey(r)], 40) }
	sort.SliceStable(recs, func(i, j int) bool { return score(recs[i]) > score(recs[j]) })
	return uniqueSongs(recs)
}

// rankRecordingsOf orders an artist's songs, leaving out other versions: their own albums first, newest first, then what
// they appear on.
func rankRecordingsOf(artistID string, recs []recording) []recording {
	kept := make([]recording, 0, len(recs))
	for _, r := range recs {
		if r.Video || reOddTitle.MatchString(r.Title) || typeRank(bestRelease(r.Releases).ReleaseGroup) == 0 {
			continue
		}
		kept = append(kept, r)
	}
	own := func(r recording) bool {
		rel := bestRelease(r.Releases)
		for _, c := range rel.ReleaseGroup.Credit {
			if c.Artist.ID == artistID {
				return true
			}
		}
		for _, c := range rel.Credit {
			if c.Artist.ID == artistID {
				return true
			}
		}
		return false
	}
	sort.SliceStable(kept, func(i, j int) bool {
		if own(kept[i]) != own(kept[j]) {
			return own(kept[i])
		}
		a, b := bestRelease(kept[i].Releases), bestRelease(kept[j].Releases)
		if ra, rb := typeRank(a.ReleaseGroup), typeRank(b.ReleaseGroup); ra != rb {
			return ra > rb
		}
		return b.Date < a.Date
	})
	return uniqueSongs(kept)
}

// usualLength finds how long each song usually is: a live take or an extended mix is one recording, the studio version
// is on release after release. Its length decides whether a video is the right one, so the wrong take means no download.
func usualLength(recs []recording) map[string]int {
	counts := map[string]map[int]int{}
	for _, r := range recs {
		if r.Length == 0 {
			continue
		}
		key := songKey(r)
		if counts[key] == nil {
			counts[key] = map[int]int{}
		}
		counts[key][r.Length/5000] += 1 + len(r.Releases) // to the nearest five seconds
	}
	out := map[string]int{}
	for key, lengths := range counts {
		best, seen := 0, 0
		for length, n := range lengths {
			if n > seen || (n == seen && length < best) {
				best, seen = length, n
			}
		}
		out[key] = best
	}
	return out
}

// uniqueSongs keeps one recording per song, where the song ranks first: its usual length, on the best album, and the
// original over later reissues. The same song is often one result from a compilation and another from its album.
func uniqueSongs(recs []recording) []recording {
	usual := usualLength(recs)
	better := func(a, b recording) bool {
		want := usual[songKey(a)]
		if ax, bx := a.Length/5000 == want, b.Length/5000 == want; ax != bx {
			return ax
		}
		x, y := bestRelease(a.Releases), bestRelease(b.Releases)
		if rx, ry := releaseScore(x), releaseScore(y); rx != ry {
			return rx > ry
		}
		return earlier(x.Date, y.Date)
	}
	chosen := map[string]int{}
	out := make([]recording, 0, len(recs))
	for _, r := range recs {
		key := songKey(r)
		if at, seen := chosen[key]; seen {
			if !reOddTitle.MatchString(r.Title) && better(r, out[at]) {
				out[at] = r
			}
			continue
		}
		chosen[key] = len(out)
		out = append(out, r)
	}
	return out
}

// rankGroups orders albums for a search: this artist's real albums first, and nothing that merely shares a word with
// a commentary track or a tribute.
func rankGroups(query string, groups []releaseGroup) []releaseGroup {
	q := queryWords(query)
	score := func(g releaseGroup) int {
		title := strings.Fields(match.Norm(g.Title))
		s := g.Score/10 + typeRank(g)*10
		if creditNamed(g.Credit, q) {
			s += 60
		}
		if allIn(title, q) {
			s += 40
		}
		for _, w := range title {
			if !q[w] {
				s -= 3
			}
		}
		if reOddTitle.MatchString(g.Title) {
			s -= 40
		}
		return s
	}
	kept := make([]releaseGroup, 0, len(groups))
	for _, g := range groups {
		if typeRank(g) > 0 {
			kept = append(kept, g)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return score(kept[i]) > score(kept[j]) })
	if len(kept) > 10 {
		kept = kept[:10]
	}
	return kept
}

// artistAsked says whether a search is one artist's name, and which: the best-placed exact name among the results.
func artistAsked(query string, recs []recording) (id, name string, ok bool) {
	q := match.Norm(query)
	if len([]rune(q)) < 3 {
		return "", "", false
	}
	for _, r := range recs {
		for _, c := range r.Credit {
			if match.Norm(c.Artist.Name) == q {
				return c.Artist.ID, c.Artist.Name, true
			}
		}
	}
	return "", "", false
}

// artistGroups orders an artist's albums, newest first with albums and EPs before singles, and without live albums,
// compilations and the like.
func artistGroups(groups []releaseGroup) []releaseGroup {
	kept := make([]releaseGroup, 0, len(groups))
	for _, g := range groups {
		if typeRank(g) > 0 {
			kept = append(kept, g)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool {
		a, b := kept[i], kept[j]
		if (typeRank(a) > 1) != (typeRank(b) > 1) {
			return typeRank(a) > 1
		}
		return a.FirstRelease > b.FirstRelease
	})
	return kept
}

// bestGroupFor finds the group that is this album by this artist.
func bestGroupFor(name, artist string, groups []releaseGroup) (releaseGroup, bool) {
	want := match.Norm(name)
	who := match.FirstArtist(artist)
	var best releaseGroup
	found := false
	for _, g := range groups {
		if match.Norm(g.Title) != want || !sameFirstArtist(g.Credit, who) {
			continue
		}
		if !found || typeRank(g) > typeRank(best) {
			best, found = g, true
		}
	}
	return best, found
}

func sameFirstArtist(credits []credit, who string) bool {
	for _, n := range names(credits) {
		if a := match.FirstArtist(n); a != "" && who != "" && (a == who || strings.Contains(a, who) || strings.Contains(who, a)) {
			return true
		}
	}
	return false
}

// bestMatch finds a song someone listed elsewhere. It must be sure: the same title by the same first artist, and when
// the length is known, within ten seconds. An album of the same name wins among equals.
func bestMatch(want catalog.Wanted, recs []recording) (recording, bool) {
	title := match.Norm(want.Title)
	who := match.FirstArtist(want.Artist)
	album := match.Norm(want.Album)
	var best recording
	bestScore, found := 0, false
	for _, r := range recs {
		if match.Norm(r.Title) != title || !match.SameVersion(r.Title, want.Title) || !sameFirstArtist(r.Credit, who) {
			continue
		}
		score := releaseScore(bestRelease(r.Releases))
		if want.DurationMs > 0 {
			if r.Length == 0 {
				continue // cannot tell a live take of the same name from the song
			}
			diff := r.Length - want.DurationMs
			if diff < 0 {
				diff = -diff
			}
			if diff > 10000 {
				continue
			}
			score -= diff / 200
		}
		if album != "" {
			for _, rel := range r.Releases {
				if match.Norm(rel.Title) == album {
					score += 200
					r.Releases = []release{rel} // this is the album they meant
					break
				}
			}
		}
		if !found || score > bestScore {
			best, bestScore, found = r, score, true
		}
	}
	return best, found
}
