package musicbrainz

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
)

// genre is one of MusicBrainz's genres on a recording, release or release group, with how many people voted for it.
type genre struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// maxGenres is how many genres a song gets at most. MusicBrainz lists every genre anyone voted for: Un verano sin ti
// has ten, eight of them with a single vote.
const maxGenres = 3

// pickGenres keeps the genres most people agree on, most voted first: those with at least half the votes of the top one.
func pickGenres(all []genre) []string {
	votes := map[string]int{}
	for _, g := range all {
		name := strings.TrimSpace(g.Name)
		if name != "" && g.Count > 0 {
			votes[name] += g.Count
		}
	}
	ordered := make([]string, 0, len(votes))
	for name := range votes {
		ordered = append(ordered, name)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if votes[ordered[i]] != votes[ordered[j]] {
			return votes[ordered[i]] > votes[ordered[j]]
		}
		return ordered[i] < ordered[j]
	})
	var out []string
	for _, name := range ordered {
		if len(out) == maxGenres || votes[name]*2 < votes[ordered[0]] {
			break
		}
		out = append(out, genreName(name))
	}
	return out
}

// shouted are words of a genre written in capitals. MusicBrainz writes every genre in lower case.
var shouted = map[string]string{"r&b": "R&B", "edm": "EDM", "uk": "UK", "idm": "IDM", "ebm": "EBM", "dj": "DJ", "j-pop": "J-Pop", "k-pop": "K-Pop", "j-rock": "J-Rock", "c-pop": "C-Pop", "lo-fi": "Lo-Fi", "uk garage": "UK Garage"}

// genreName writes a MusicBrainz genre the way people do in tags: "latin pop" becomes "Latin Pop", "r&b" "R&B".
func genreName(name string) string {
	name = strings.ToLower(name)
	if special, ok := shouted[name]; ok {
		return special
	}
	words := strings.Fields(name)
	for i, w := range words {
		if special, ok := shouted[w]; ok {
			words[i] = special
			continue
		}
		parts := strings.Split(w, "-")
		for j, p := range parts {
			if p != "" {
				parts[j] = strings.ToUpper(p[:1]) + p[1:]
			}
		}
		words[i] = strings.Join(parts, "-")
	}
	return strings.Join(words, " ")
}

// songGenres are a song's genres: its own when people voted for some, or else its album's.
func songGenres(rec []genre, group []genre, rel []genre) []string {
	for _, list := range [][]genre{rec, group, rel} {
		if genres := pickGenres(list); len(genres) > 0 {
			return genres
		}
	}
	return nil
}

// AlbumGenres implements catalog.GenreFinder. It costs two requests, the same first two as FindAlbum, which share its
// answers.
func (c *Client) AlbumGenres(ctx context.Context, album, artist string) ([]string, error) {
	var page struct {
		Groups []releaseGroup `json:"release-groups"`
	}
	q := fmt.Sprintf("releasegroup:%s AND artist:%s", quote(stripVersion(album)), quote(catalog.FirstName(artist)))
	if err := c.get(ctx, "release-group", url.Values{"query": {q}, "limit": {"15"}}, searchTTL, &page); err != nil {
		return nil, err
	}
	best, ok := bestGroupFor(album, artist, page.Groups)
	if !ok {
		return nil, nil
	}
	var group releaseGroup
	err := c.get(ctx, "release-group/"+best.ID, url.Values{"inc": {groupInc}}, lookupTTL, &group)
	if errors.Is(err, catalog.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return pickGenres(group.Genres), nil
}
