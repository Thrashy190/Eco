// Package itunes is the backup catalogue: Apple's iTunes Search API, free and with no account. It knows very new releases
// and orders results by what people look for, which MusicBrainz cannot, and has a cover for nearly everything. Apple asks
// for about 20 requests per minute and means its data for promoting its store, so it only answers what the main catalogue
// could not (see catalog.Fallback). https://performance-partners.apple.com/search-api
package itunes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/match"
)

const (
	officialURL = "https://itunes.apple.com"
	userAgent   = "eco/1.0 (https://github.com/Thrashy190/eco)"
	idPrefix    = "it-" // never looks like a MusicBrainz ID, and is safe in addresses and file paths

	perMinute = 18 // Apple says about 20
	searchTTL = time.Hour
	lookupTTL = 24 * time.Hour
	maxCached = 1024
	pause     = time.Minute // after Apple refuses
)

// Client talks to the iTunes Search API.
type Client struct {
	base    string
	country string
	http    *http.Client

	mu     sync.Mutex
	starts []time.Time // requests in the last minute
	until  time.Time   // Apple refused: nothing is sent before then
	cache  map[string]cached
}

type cached struct {
	body []byte
	at   time.Time
	ttl  time.Duration
}

// New returns a client for one country's store, such as "us" or "mx".
func New(country string) *Client {
	if country == "" {
		country = "us"
	}
	return &Client{base: officialURL, country: strings.ToLower(country), http: &http.Client{Timeout: 10 * time.Second}, cache: map[string]cached{}}
}

// Name implements catalog.Source.
func (c *Client) Name() string { return "iTunes" }

// Ready implements catalog.Source: there is nothing to set up.
func (c *Client) Ready() error { return nil }

var reValidID = regexp.MustCompile(`^it-[0-9]{1,18}$`)

// ValidID implements catalog.Source.
func (c *Client) ValidID(id string) bool { return reValidID.MatchString(id) }

// BusyError means iTunes cannot be asked right now.
type BusyError struct{}

func (BusyError) Error() string { return "iTunes is busy right now" }

// Busy implements catalog.Busy.
func (BusyError) Busy() {}

// reserve takes a place among this minute's requests, waiting for one if whoever is asking has the time.
func (c *Client) reserve(ctx context.Context) error {
	for {
		c.mu.Lock()
		now := time.Now()
		kept := c.starts[:0]
		for _, at := range c.starts {
			if now.Sub(at) < time.Minute {
				kept = append(kept, at)
			}
		}
		c.starts = kept
		next := c.until
		if len(c.starts) >= perMinute && c.starts[0].Add(time.Minute).After(next) {
			next = c.starts[0].Add(time.Minute)
		}
		if !now.Before(next) {
			c.starts = append(c.starts, now)
			c.mu.Unlock()
			return nil
		}
		c.mu.Unlock()
		if deadline, ok := ctx.Deadline(); ok && deadline.Before(next) {
			return BusyError{} // whoever is asking cannot wait that long
		}
		select {
		case <-time.After(time.Until(next)):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// item is one result. It may be a song, an album or an artist.
type item struct {
	WrapperType      string `json:"wrapperType"`
	Kind             string `json:"kind"`
	ArtistID         int64  `json:"artistId"`
	CollectionID     int64  `json:"collectionId"`
	TrackID          int64  `json:"trackId"`
	ArtistName       string `json:"artistName"`
	CollectionArtist string `json:"collectionArtistName"`
	CollectionName   string `json:"collectionName"`
	CollectionType   string `json:"collectionType"`
	TrackName        string `json:"trackName"`
	Artwork          string `json:"artworkUrl100"`
	ReleaseDate      string `json:"releaseDate"`
	TrackCount       int    `json:"trackCount"`
	TrackNumber      int    `json:"trackNumber"`
	DiscNumber       int    `json:"discNumber"`
	Milliseconds     int    `json:"trackTimeMillis"`
	Explicitness     string `json:"trackExplicitness"`
	TrackURL         string `json:"trackViewUrl"`
}

func (c *Client) get(ctx context.Context, path string, q url.Values, ttl time.Duration) ([]item, error) {
	q.Set("country", c.country)
	target := c.base + path + "?" + q.Encode()
	c.mu.Lock()
	entry, ok := c.cache[target]
	c.mu.Unlock()
	body := entry.body
	if !ok || time.Since(entry.at) >= entry.ttl {
		if err := c.reserve(ctx); err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ = io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			c.mu.Lock()
			c.until = time.Now().Add(pause)
			c.mu.Unlock()
			return nil, BusyError{}
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("iTunes answered HTTP %d", resp.StatusCode)
		}
		c.mu.Lock()
		if len(c.cache) >= maxCached {
			c.cache = map[string]cached{}
		}
		c.cache[target] = cached{body, time.Now(), ttl}
		c.mu.Unlock()
	}
	var out struct {
		Results []item `json:"results"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, errors.New("iTunes sent something unreadable")
	}
	return out.Results, nil
}

// ---- Turning results into catalogue entries ----

var reKindSuffix = regexp.MustCompile(`(?i)\s+-\s+(single|ep)$`)

// albumName takes off what Apple adds to a title, which is not part of it: "Espresso - Single".
func albumName(name string) (string, string) {
	if found := reKindSuffix.FindStringSubmatch(name); found != nil {
		return strings.TrimSpace(name[:len(name)-len(found[0])]), strings.ToLower(found[1])
	}
	return name, "album"
}

// bigCover asks for a large version of the same picture. Apple serves any size by its address.
func bigCover(artwork string) string { return strings.Replace(artwork, "100x100bb", "600x600bb", 1) }

func day(date string) string {
	if len(date) >= 10 {
		return date[:10]
	}
	return date
}

func trackOf(it item) catalog.Track {
	album, _ := albumName(it.CollectionName)
	albumArtist := it.ArtistName
	if it.CollectionArtist != "" {
		albumArtist = it.CollectionArtist
	}
	return catalog.Track{
		ID: idPrefix + strconv.FormatInt(it.TrackID, 10),
		Meta: catalog.Meta{
			Title: it.TrackName, Artist: it.ArtistName, AlbumArtist: albumArtist, Album: album, Date: day(it.ReleaseDate),
			Track: it.TrackNumber, Tracks: it.TrackCount, Disc: it.DiscNumber, DurationMs: it.Milliseconds,
			CoverURL: bigCover(it.Artwork), SourceURL: it.TrackURL,
		},
	}
}

func albumOf(it item) catalog.Album {
	name, kind := albumName(it.CollectionName)
	if strings.EqualFold(it.CollectionType, "Compilation") {
		kind = "compilation"
	}
	who := it.ArtistName
	if it.CollectionArtist != "" {
		who = it.CollectionArtist
	}
	return catalog.Album{ID: idPrefix + strconv.FormatInt(it.CollectionID, 10), Name: name, Artists: []string{who}, Type: kind, Date: day(it.ReleaseDate), TotalTracks: it.TrackCount, CoverURL: bigCover(it.Artwork)}
}

var reNotTheSong = regexp.MustCompile(`(?i)\b(karaoke|tribute|lullaby|lullabies|in the style of|originally performed|made famous|rendition|8-bit|piano version|kidz bop)\b`)

func words(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields(match.Norm(strings.NewReplacer("(", " ", ")", " ", "[", " ", "]", " ", " - ", " ").Replace(s))) {
		out[w] = true
	}
	return out
}

// usableSong keeps results that are this search: every word found in the song, the artist or the album, and no karaoke
// or remix unless asked for. Apple's search also returns whatever is merely close.
func usableSong(query string, it item) bool {
	if it.Kind != "song" || it.TrackID == 0 {
		return false
	}
	if !match.SameVersion(query, it.TrackName) || reNotTheSong.MatchString(it.TrackName+" "+it.CollectionName+" "+it.ArtistName) {
		return false
	}
	have := words(it.TrackName + " " + it.ArtistName + " " + it.CollectionName)
	for w := range words(query) {
		if !have[w] {
			return false
		}
	}
	return true
}

// betterVersion chooses among what Apple lists under one song: the plain title over "(On Vacation Version)", and the
// original over the radio edit. These normalise alike, so the search could not tell them apart.
func betterVersion(a, b item) bool {
	plain := func(it item) bool { return !strings.ContainsAny(it.TrackName, "([") }
	if plain(a) != plain(b) {
		return plain(a)
	}
	return b.Explicitness == "cleaned" && a.Explicitness != "cleaned"
}

func songKey(it item) string {
	return match.Norm(it.TrackName) + "|" + match.FirstArtist(it.ArtistName)
}

// Search implements catalog.Source. It costs one request, and two when it can spend them on albums too.
func (c *Client) Search(ctx context.Context, query string) (catalog.Results, error) {
	songs, err := c.get(ctx, "/search", url.Values{"term": {query}, "media": {"music"}, "entity": {"song"}, "limit": {"40"}}, searchTTL)
	if err != nil {
		return catalog.Results{}, err
	}
	out := catalog.Results{}
	seen := map[string]int{}
	var kept []item
	for _, it := range songs {
		if !usableSong(query, it) {
			continue
		}
		if at, dup := seen[songKey(it)]; dup {
			if betterVersion(it, kept[at]) {
				kept[at] = it
			}
			continue
		}
		seen[songKey(it)] = len(kept)
		kept = append(kept, it)
	}
	for _, it := range kept {
		out.Tracks = append(out.Tracks, trackOf(it))
	}
	// Albums come from the songs found, in the same order, so a search costs one request of the twenty a minute
	albums := map[int64]bool{}
	for _, it := range kept {
		if albums[it.CollectionID] || it.CollectionID == 0 {
			continue
		}
		albums[it.CollectionID] = true
		album := albumOf(it)
		// The album is only shown when it is what was typed, not just where a song happens to be
		have := words(album.Name + " " + album.Artist())
		named := true
		for w := range words(query) {
			named = named && have[w]
		}
		if named && len(out.Albums) < 10 {
			out.Albums = append(out.Albums, album)
		}
	}
	return out, nil
}

func numericID(id string) (string, bool) {
	if !reValidID.MatchString(id) {
		return "", false
	}
	return strings.TrimPrefix(id, idPrefix), true
}

// Track implements catalog.Source.
func (c *Client) Track(ctx context.Context, id string) (catalog.Track, error) {
	number, ok := numericID(id)
	if !ok {
		return catalog.Track{}, catalog.ErrNotFound
	}
	found, err := c.get(ctx, "/lookup", url.Values{"id": {number}, "entity": {"song"}}, lookupTTL)
	if err != nil {
		return catalog.Track{}, err
	}
	for _, it := range found {
		if it.Kind == "song" && strconv.FormatInt(it.TrackID, 10) == number {
			return trackOf(it), nil
		}
	}
	return catalog.Track{}, catalog.ErrNotFound
}

// Album implements catalog.Source.
func (c *Client) Album(ctx context.Context, id string) (catalog.Album, error) {
	number, ok := numericID(id)
	if !ok {
		return catalog.Album{}, catalog.ErrNotFound
	}
	found, err := c.get(ctx, "/lookup", url.Values{"id": {number}, "entity": {"song"}, "limit": {"200"}}, lookupTTL)
	if err != nil {
		return catalog.Album{}, err
	}
	var album catalog.Album
	var songs []item
	for _, it := range found {
		switch {
		case it.WrapperType == "collection":
			album = albumOf(it)
		case it.Kind == "song":
			songs = append(songs, it)
		}
	}
	if album.ID == "" {
		return catalog.Album{}, catalog.ErrNotFound
	}
	sort.SliceStable(songs, func(i, j int) bool {
		if songs[i].DiscNumber != songs[j].DiscNumber {
			return songs[i].DiscNumber < songs[j].DiscNumber
		}
		return songs[i].TrackNumber < songs[j].TrackNumber
	})
	for _, it := range songs {
		album.Tracks = append(album.Tracks, trackOf(it))
	}
	album.TotalTracks = len(album.Tracks)
	return album, nil
}

// findAlbumItem finds the album with this name by this artist. Reissues share a name: the fullest is the page to show.
func (c *Client) findAlbumItem(ctx context.Context, name, artist string) (item, bool, error) {
	found, err := c.get(ctx, "/search", url.Values{"term": {catalog.FirstName(artist) + " " + name}, "media": {"music"}, "entity": {"album"}, "limit": {"25"}}, searchTTL)
	if err != nil {
		return item{}, false, err
	}
	var best item
	ok := false
	for _, it := range found {
		title, _ := albumName(it.CollectionName)
		if match.Norm(title) != match.Norm(name) || !match.SameArtist(it.ArtistName, artist) {
			continue
		}
		if !ok || it.TrackCount > best.TrackCount {
			best, ok = it, true
		}
	}
	return best, ok, nil
}

// FindAlbum implements catalog.Source.
func (c *Client) FindAlbum(ctx context.Context, name, artist string) (catalog.Album, bool, error) {
	best, ok, err := c.findAlbumItem(ctx, name, artist)
	if err != nil || !ok {
		return catalog.Album{}, false, err
	}
	album, err := c.Album(ctx, idPrefix+strconv.FormatInt(best.CollectionID, 10))
	if errors.Is(err, catalog.ErrNotFound) {
		return catalog.Album{}, false, nil
	}
	return album, err == nil, err
}

// FindCover implements catalog.CoverFinder.
func (c *Client) FindCover(ctx context.Context, album, artist string) string {
	best, ok, err := c.findAlbumItem(ctx, album, artist)
	if err != nil || !ok {
		return ""
	}
	return bigCover(best.Artwork)
}

// FindTrack implements catalog.Source. It must be sure: the same title and version by the same first artist and, when the
// length is known, within ten seconds. Among those, the album that was listed wins.
func (c *Client) FindTrack(ctx context.Context, want catalog.Wanted) (catalog.Track, bool, error) {
	term := catalog.FirstName(want.Artist) + " " + match.Norm(want.Title)
	found, err := c.get(ctx, "/search", url.Values{"term": {term}, "media": {"music"}, "entity": {"song"}, "limit": {"25"}}, searchTTL)
	if err != nil {
		return catalog.Track{}, false, err
	}
	var best item
	bestScore, ok := 0, false
	for _, it := range found {
		if it.Kind != "song" || match.Norm(it.TrackName) != match.Norm(want.Title) || !match.SameVersion(it.TrackName, want.Title) || !match.SameArtist(it.ArtistName, want.Artist) {
			continue
		}
		score := 0
		if want.DurationMs > 0 {
			if it.Milliseconds == 0 {
				continue
			}
			diff := it.Milliseconds - want.DurationMs
			if diff < 0 {
				diff = -diff
			}
			if diff > 10000 {
				continue
			}
			score -= diff / 200
		}
		title, kind := albumName(it.CollectionName)
		if want.Album != "" && match.Norm(title) == match.Norm(want.Album) {
			score += 200
		}
		if kind == "album" {
			score += 10
		}
		if it.Explicitness != "cleaned" {
			score += 5
		}
		if !ok || score > bestScore {
			best, bestScore, ok = it, score, true
		}
	}
	if !ok {
		return catalog.Track{}, false, nil
	}
	return trackOf(best), true, nil
}

// ByArtist implements catalog.Source. It costs three requests.
func (c *Client) ByArtist(ctx context.Context, name string) ([]catalog.Track, []catalog.Album, error) {
	found, err := c.get(ctx, "/search", url.Values{"term": {name}, "media": {"music"}, "entity": {"musicArtist"}, "limit": {"5"}}, lookupTTL)
	if err != nil {
		return nil, nil, err
	}
	var id int64
	for _, it := range found {
		if match.Norm(it.ArtistName) == match.Norm(name) {
			id = it.ArtistID
			break
		}
	}
	if id == 0 {
		return nil, nil, nil
	}
	number := strconv.FormatInt(id, 10)
	collections, err := c.get(ctx, "/lookup", url.Values{"id": {number}, "entity": {"album"}, "limit": {"100"}}, lookupTTL)
	if err != nil {
		return nil, nil, err
	}
	var albums []catalog.Album
	for _, it := range collections {
		if it.WrapperType == "collection" {
			albums = append(albums, albumOf(it))
		}
	}
	sort.SliceStable(albums, func(i, j int) bool {
		a, b := albums[i], albums[j]
		if (a.Type == "single") != (b.Type == "single") {
			return b.Type == "single"
		}
		return a.Date > b.Date
	})
	songs, err := c.get(ctx, "/lookup", url.Values{"id": {number}, "entity": {"song"}, "limit": {"100"}}, lookupTTL)
	if err != nil {
		return nil, albums, err
	}
	var tracks []catalog.Track
	seen := map[string]bool{}
	for _, it := range songs {
		if it.Kind == "song" && !seen[songKey(it)] && !reNotTheSong.MatchString(it.TrackName) {
			seen[songKey(it)] = true
			tracks = append(tracks, trackOf(it))
		}
	}
	return tracks, albums, nil
}
