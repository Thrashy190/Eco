// Package musicbrainz is the default music catalogue: MusicBrainz for the metadata (its core data is CC0, free for any
// use, no account) and the Cover Art Archive for the pictures. Its rule is at most one request per second from an
// address, with a User-Agent saying who is asking; https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
// Unlike a commercial catalogue it has no popularity figures and is edited by volunteers, so results are ranked here
// (rank.go) and very new or very obscure releases can be missing.
package musicbrainz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/match"
)

const (
	// OfficialURL is the public server. A mirror of your own has no rate limit, see New.
	OfficialURL = "https://musicbrainz.org/ws/2"
	coverBase   = "https://coverartarchive.org"
	userAgent   = "eco/1.0 (https://github.com/Thrashy190/eco)"

	spacing     = 1100 * time.Millisecond // a little over one per second, measured between the start of two requests
	searchTTL   = time.Hour
	lookupTTL   = 24 * time.Hour // releases rarely change
	maxCached   = 2048
	maxAttempts = 3
	pageLimit   = 50
)

// Client talks to MusicBrainz.
type Client struct {
	base    string
	covers  string
	http    *http.Client
	spacing time.Duration
	backoff time.Duration // the first pause after a refusal; it doubles

	mu    sync.Mutex
	next  time.Time // when the next request may start
	until time.Time // MusicBrainz is refusing requests until then
	cache map[string]cached
}

type cached struct {
	body []byte
	at   time.Time
	ttl  time.Duration
}

// New returns a client for the server at base ("" for the public one). The one-per-second rule only applies to the
// public server: https://musicbrainz.org/doc/MusicBrainz_Server/Setup explains how to run your own.
func New(base string) *Client {
	c := &Client{base: strings.TrimRight(base, "/"), covers: coverBase, http: &http.Client{Timeout: 20 * time.Second}, backoff: 2 * time.Second, cache: map[string]cached{}}
	if c.base == "" || c.base == OfficialURL {
		c.base, c.spacing = OfficialURL, spacing
	}
	return c
}

// Name implements catalog.Source.
func (c *Client) Name() string { return "MusicBrainz" }

// Ready implements catalog.Source: there is nothing to set up.
func (c *Client) Ready() error { return nil }

var (
	reUUID    = `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`
	reValidID = regexp.MustCompile(`^` + reUUID + `(\.` + reUUID + `)?$`)
)

// ValidID implements catalog.Source. A track is "recording.release", because the same recording is on many releases
// and the one chosen decides the album, track number and cover in the tags. An album is a release group.
func (c *Client) ValidID(id string) bool { return reValidID.MatchString(id) }

// BusyError means MusicBrainz is refusing requests for now.
type BusyError struct{}

func (BusyError) Error() string { return "MusicBrainz is busy right now" }

// Busy implements catalog.Busy.
func (BusyError) Busy() {}

// wait holds a request until its turn. Requests are spaced by when they start, so several can be under way.
func (c *Client) wait(ctx context.Context) error {
	c.mu.Lock()
	now := time.Now()
	if deadline, ok := ctx.Deadline(); ok && deadline.Before(c.until) {
		c.mu.Unlock()
		return BusyError{} // whoever is asking cannot wait that long, so they hear it now
	}
	slot := c.next
	if slot.Before(now) {
		slot = now
	}
	if slot.Before(c.until) {
		slot = c.until
	}
	c.next = slot.Add(c.spacing)
	c.mu.Unlock()
	if d := time.Until(slot); d > 0 {
		select {
		case <-time.After(d):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// get fetches a path of the API and decodes the JSON into out. Answers are kept, because a person going back to a page
// must not spend the one request per second that someone else's search is waiting for.
func (c *Client) get(ctx context.Context, path string, q url.Values, ttl time.Duration, out any) error {
	q.Set("fmt", "json")
	target := c.base + "/" + path + "?" + q.Encode()
	c.mu.Lock()
	entry, ok := c.cache[target]
	c.mu.Unlock()
	if ok && time.Since(entry.at) < entry.ttl {
		return json.Unmarshal(entry.body, out)
	}
	for attempt := 0; ; attempt++ {
		if err := c.wait(ctx); err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/json")
		resp, err := c.http.Do(req)
		if err != nil {
			return err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusOK:
			c.mu.Lock()
			if len(c.cache) >= maxCached {
				c.cache = map[string]cached{}
			}
			c.cache[target] = cached{body, time.Now(), ttl}
			c.mu.Unlock()
			return json.Unmarshal(body, out)
		case resp.StatusCode == http.StatusNotFound:
			return catalog.ErrNotFound
		case resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusTooManyRequests:
			// Over the limit, or the server has too much to do: it happens now and then at any pace. Everything waits
			pause, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			c.mu.Lock()
			c.until = time.Now().Add(max(time.Duration(pause)*time.Second, c.backoff<<attempt))
			c.mu.Unlock()
			if attempt == maxAttempts-1 {
				return BusyError{}
			}
		default:
			return fmt.Errorf("MusicBrainz answered HTTP %d", resp.StatusCode)
		}
	}
}

// ---- What the API sends ----

type credit struct {
	Name       string `json:"name"`
	JoinPhrase string `json:"joinphrase"`
	Artist     struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"artist"`
}

type releaseGroup struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Score          int      `json:"score"`
	PrimaryType    string   `json:"primary-type"`
	SecondaryTypes []string `json:"secondary-types"`
	FirstRelease   string   `json:"first-release-date"`
	Credit         []credit `json:"artist-credit"`
}

type track struct {
	Position  int      `json:"position"`
	Title     string   `json:"title"`
	Length    int      `json:"length"`
	Credit    []credit `json:"artist-credit"`
	Recording struct {
		ID     string   `json:"id"`
		ISRCs  []string `json:"isrcs"`
		Length int      `json:"length"`
		Credit []credit `json:"artist-credit"`
	} `json:"recording"`
}

type medium struct {
	Position   int     `json:"position"`
	Format     string  `json:"format"`
	TrackCount int     `json:"track-count"`
	Tracks     []track `json:"tracks"`
}

type release struct {
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Status       string       `json:"status"`
	Date         string       `json:"date"`
	Country      string       `json:"country"`
	Credit       []credit     `json:"artist-credit"`
	TrackCount   int          `json:"track-count"`
	ReleaseGroup releaseGroup `json:"release-group"`
	Media        []medium     `json:"media"`
}

type recording struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Score    int       `json:"score"`
	Length   int       `json:"length"`
	Video    bool      `json:"video"`
	ISRCs    []string  `json:"isrcs"`
	Credit   []credit  `json:"artist-credit"`
	Releases []release `json:"releases"`
}

func names(credits []credit) []string {
	out := make([]string, 0, len(credits))
	for _, c := range credits {
		name := c.Name
		if name == "" {
			name = c.Artist.Name
		}
		out = append(out, name)
	}
	return out
}

func (c *Client) coverOf(group string) string {
	if group == "" {
		return ""
	}
	return c.covers + "/release-group/" + group + "/front-500"
}

// albumType gives the kind of album in the words the app uses.
func albumType(g releaseGroup) string {
	for _, s := range g.SecondaryTypes {
		if s == "Compilation" {
			return "compilation"
		}
	}
	return strings.ToLower(g.PrimaryType)
}

func (c *Client) albumOf(g releaseGroup) catalog.Album {
	return catalog.Album{ID: g.ID, Name: g.Title, Artists: names(g.Credit), Type: albumType(g), Date: g.FirstRelease, CoverURL: c.coverOf(g.ID)}
}

// trackOnRelease describes a song as it appears on one release.
func (c *Client) trackOnRelease(rel release, disc medium, t track, group string) catalog.Track {
	who := t.Recording.Credit
	if len(t.Credit) > 0 {
		who = t.Credit
	}
	albumArtists := names(rel.Credit)
	artists := names(who)
	if len(albumArtists) == 0 {
		albumArtists = artists
	}
	length := t.Recording.Length
	if t.Length > 0 {
		length = t.Length
	}
	m := catalog.Meta{
		Title: t.Title, Artist: strings.Join(artists, ", "), Artists: artists,
		AlbumArtist: strings.Join(albumArtists, ", "), AlbumArtists: albumArtists, Album: rel.Title, Date: rel.Date,
		Track: t.Position, Tracks: disc.TrackCount, Disc: disc.Position, DurationMs: length,
		CoverURL: c.coverOf(group), SourceURL: "https://musicbrainz.org/recording/" + t.Recording.ID,
	}
	if len(t.Recording.ISRCs) > 0 {
		m.ISRC = t.Recording.ISRCs[0]
	}
	return catalog.Track{ID: t.Recording.ID + "." + rel.ID, Meta: m}
}

// hit describes a search result with what the search knows: its best release, but not the track number on it.
func (c *Client) hit(r recording) catalog.Track {
	rel := bestRelease(r.Releases)
	artists := names(r.Credit)
	m := catalog.Meta{
		Title: r.Title, Artist: strings.Join(artists, ", "), Artists: artists, Album: rel.Title, Date: rel.Date,
		DurationMs: r.Length, CoverURL: c.coverOf(rel.ReleaseGroup.ID), SourceURL: "https://musicbrainz.org/recording/" + r.ID,
	}
	if len(r.ISRCs) > 0 {
		m.ISRC = r.ISRCs[0]
	}
	id := r.ID
	if rel.ID != "" {
		id += "." + rel.ID
	}
	return catalog.Track{ID: id, Meta: m}
}

// ---- Queries ----

// quote makes text safe inside a Lucene phrase.
func quote(s string) string {
	s = strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s)
	return `"` + s + `"`
}

var reLucene = regexp.MustCompile(`[+\-&|!(){}\[\]^"~*?:\\/]`)

// terms makes free text safe as a list of Lucene words.
func terms(s string) string {
	return strings.Join(strings.Fields(reLucene.ReplaceAllString(s, " ")), " ")
}

// everyWord asks for results holding every word of a search, each in the artist or in the title: "metallica one" must
// find One by Metallica, and "un verano sin ti" must not settle for whatever has "un" in it.
func everyWord(words, titleField string) string {
	parts := []string{}
	for _, w := range strings.Fields(words) {
		parts = append(parts, fmt.Sprintf("(artist:%[1]s OR %[2]s:%[1]s)", w, titleField))
	}
	return strings.Join(parts, " AND ")
}

// Search implements catalog.Source. It costs two requests, or three when the search names an artist.
func (c *Client) Search(ctx context.Context, query string) (catalog.Results, error) {
	words := terms(query)
	if words == "" {
		return catalog.Results{}, nil
	}
	var (
		wg   sync.WaitGroup
		recs struct {
			Recordings []recording `json:"recordings"`
		}
		groups struct {
			Groups []releaseGroup `json:"release-groups"`
		}
		errRecs error
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		q := everyWord(words, "recording") + " AND video:false"
		errRecs = c.get(ctx, "recording", url.Values{"query": {q}, "limit": {strconv.Itoa(pageLimit)}}, searchTTL, &recs)
	}()
	go func() {
		defer wg.Done()
		q := everyWord(words, "releasegroup") + " AND (primarytype:album OR primarytype:ep OR primarytype:single)"
		c.get(ctx, "release-group", url.Values{"query": {q}, "limit": {"25"}}, searchTTL, &groups) // a failure here is reported by the other search
	}()
	wg.Wait()

	out := catalog.Results{}
	if errRecs != nil {
		return out, errRecs
	}
	for _, r := range rankRecordings(query, recs.Recordings) {
		out.Tracks = append(out.Tracks, c.hit(r))
	}
	for _, g := range rankGroups(query, groups.Groups) {
		out.Albums = append(out.Albums, c.albumOf(g))
	}
	if id, name, ok := artistAsked(query, recs.Recordings); ok { // searching an artist: also list their other songs
		out.Artist = name
		if more, err := c.tracksBy(ctx, id); err == nil {
			out.Tracks = mergeTracks(out.Tracks, more)
		}
	}
	return out, nil
}

// mergeTracks adds to first what is not in it yet.
func mergeTracks(first, more []catalog.Track) []catalog.Track {
	seen := map[string]bool{}
	for _, t := range first {
		seen[match.Norm(t.Title)+"|"+match.FirstArtist(t.Artist)] = true
	}
	for _, t := range more {
		key := match.Norm(t.Title) + "|" + match.FirstArtist(t.Artist)
		if !seen[key] {
			seen[key] = true
			first = append(first, t)
		}
	}
	return first
}

// tracksBy lists an artist's songs on their official albums, the closest thing to "their songs" the data offers.
func (c *Client) tracksBy(ctx context.Context, artistID string) ([]catalog.Track, error) {
	var page struct {
		Recordings []recording `json:"recordings"`
	}
	q := fmt.Sprintf("arid:%s AND status:official AND (primarytype:album OR primarytype:ep OR primarytype:single) AND video:false", artistID)
	if err := c.get(ctx, "recording", url.Values{"query": {q}, "limit": {"100"}}, searchTTL, &page); err != nil {
		return nil, err
	}
	var out []catalog.Track
	for _, r := range rankRecordingsOf(artistID, page.Recordings) {
		out = append(out, c.hit(r))
	}
	return out, nil
}

// Track implements catalog.Source.
func (c *Client) Track(ctx context.Context, id string) (catalog.Track, error) {
	rec, rel, _ := strings.Cut(id, ".")
	if rel == "" {
		var r recording
		err := c.get(ctx, "recording/"+rec, url.Values{"inc": {"artist-credits+isrcs+releases+release-groups"}}, lookupTTL, &r)
		if err != nil {
			return catalog.Track{}, err
		}
		best := bestRelease(r.Releases)
		if best.ID == "" { // on no release at all: still a song that can be looked for
			return c.hit(r), nil
		}
		rel = best.ID
	}
	var full release
	err := c.get(ctx, "release/"+rel, url.Values{"inc": {"recordings+artist-credits+isrcs+release-groups"}}, lookupTTL, &full)
	if err != nil {
		return catalog.Track{}, err
	}
	for _, disc := range full.Media {
		for _, t := range disc.Tracks {
			if t.Recording.ID == rec {
				return c.trackOnRelease(full, disc, t, full.ReleaseGroup.ID), nil
			}
		}
	}
	return catalog.Track{}, catalog.ErrNotFound
}

// Album implements catalog.Source. An album here is a release group; the page shows its most representative release.
func (c *Client) Album(ctx context.Context, id string) (catalog.Album, error) {
	var group releaseGroup
	if err := c.get(ctx, "release-group/"+id, url.Values{"inc": {"artist-credits"}}, lookupTTL, &group); err != nil {
		return catalog.Album{}, err
	}
	var page struct {
		Releases []release `json:"releases"`
	}
	q := url.Values{"release-group": {id}, "inc": {"recordings+artist-credits+isrcs"}, "limit": {"25"}}
	if err := c.get(ctx, "release", q, lookupTTL, &page); err != nil {
		return catalog.Album{}, err
	}
	album := c.albumOf(group)
	rel := bestEdition(page.Releases)
	for _, disc := range rel.Media {
		for _, t := range disc.Tracks {
			album.Tracks = append(album.Tracks, c.trackOnRelease(rel, disc, t, group.ID))
		}
	}
	album.TotalTracks = len(album.Tracks)
	return album, nil
}

// FindAlbum implements catalog.Source.
func (c *Client) FindAlbum(ctx context.Context, name, artist string) (catalog.Album, bool, error) {
	var page struct {
		Groups []releaseGroup `json:"release-groups"`
	}
	q := fmt.Sprintf("releasegroup:%s AND artist:%s", quote(stripVersion(name)), quote(catalog.FirstName(artist)))
	if err := c.get(ctx, "release-group", url.Values{"query": {q}, "limit": {"15"}}, searchTTL, &page); err != nil {
		return catalog.Album{}, false, err
	}
	best, ok := bestGroupFor(name, artist, page.Groups)
	if !ok {
		return catalog.Album{}, false, nil
	}
	album, err := c.Album(ctx, best.ID)
	if errors.Is(err, catalog.ErrNotFound) {
		return catalog.Album{}, false, nil
	}
	return album, err == nil, err
}

// FindTrack implements catalog.Source.
func (c *Client) FindTrack(ctx context.Context, want catalog.Wanted) (catalog.Track, bool, error) {
	var page struct {
		Recordings []recording `json:"recordings"`
	}
	if want.ISRC != "" { // an ISRC names one recording, so nothing else can beat it
		err := c.get(ctx, "recording", url.Values{"query": {"isrc:" + terms(want.ISRC)}, "limit": {"10"}}, lookupTTL, &page)
		if err == nil {
			if best, ok := bestMatch(want, page.Recordings); ok {
				t, err := c.Track(ctx, c.hit(best).ID)
				return t, err == nil, err
			}
		} else if IsBusyOrContext(err) {
			return catalog.Track{}, false, err
		}
	}
	q := fmt.Sprintf("recording:%s AND artist:%s", quote(stripVersion(want.Title)), quote(catalog.FirstName(want.Artist)))
	if err := c.get(ctx, "recording", url.Values{"query": {q}, "limit": {"25"}}, searchTTL, &page); err != nil {
		return catalog.Track{}, false, err
	}
	best, ok := bestMatch(want, page.Recordings)
	if !ok {
		return catalog.Track{}, false, nil
	}
	t, err := c.Track(ctx, c.hit(best).ID)
	return t, err == nil, err
}

// IsBusyOrContext reports errors that make trying something else pointless.
func IsBusyOrContext(err error) bool {
	return catalog.IsBusy(err) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// ByArtist implements catalog.Source. It costs three requests.
func (c *Client) ByArtist(ctx context.Context, name string) ([]catalog.Track, []catalog.Album, error) {
	var found struct {
		Artists []struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Score int    `json:"score"`
		} `json:"artists"`
	}
	err := c.get(ctx, "artist", url.Values{"query": {"artist:" + quote(name)}, "limit": {"5"}}, lookupTTL, &found)
	if err != nil {
		return nil, nil, err
	}
	id := ""
	for _, a := range found.Artists {
		if match.Norm(a.Name) == match.Norm(name) {
			id = a.ID
			break
		}
	}
	if id == "" {
		return nil, nil, nil
	}
	var groups struct {
		Groups []releaseGroup `json:"release-groups"`
	}
	q := url.Values{"artist": {id}, "type": {"album|ep|single"}, "inc": {"artist-credits"}, "limit": {"100"}}
	if err := c.get(ctx, "release-group", q, lookupTTL, &groups); err != nil {
		return nil, nil, err
	}
	var albums []catalog.Album
	for _, g := range artistGroups(groups.Groups) {
		albums = append(albums, c.albumOf(g))
	}
	tracks, err := c.tracksBy(ctx, id)
	return tracks, albums, err
}
