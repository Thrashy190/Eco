// Package spotify is a small client for the parts of the Spotify Web API eco uses:
// track search and metadata (app credentials) and liked songs / playlists (user login).
package spotify

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
)

const apiBase = "https://api.spotify.com/v1"

// PageSize is the largest page Spotify allows searches in development mode.
const PageSize = 10

const (
	// maxRetryWait is the longest pause worth sitting through. Spotify can ask for hours (Retry-After: 12157 was a
	// real answer), and waiting that long left every search hanging with no result and no message.
	maxRetryWait = 30 * time.Second
	// cacheTTL keeps catalogue answers: typing, going back and opening the same artist again must not spend Spotify's
	// rate limit, which is what got the app blocked in the first place.
	cacheTTL  = 10 * time.Minute
	maxCached = 512
)

// TokenSource hands out a valid access token.
type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// Client talks to the Web API using a TokenSource.
type Client struct {
	http *http.Client
	src  TokenSource
	base string

	mu           sync.Mutex
	blockedUntil time.Time // Spotify asked us to stop until then: nothing is sent before it
	cache        map[string]cachedBody
}

type cachedBody struct {
	body []byte
	at   time.Time
}

// New returns a client authenticated by src.
func New(src TokenSource) *Client {
	return &Client{http: &http.Client{Timeout: 20 * time.Second}, src: src, base: apiBase, cache: map[string]cachedBody{}}
}

// RateLimitError means Spotify asked Eco to stop for a while. Asking again before Until only makes it longer.
type RateLimitError struct{ Until time.Time }

func (e *RateLimitError) Error() string {
	left := time.Until(e.Until).Round(time.Minute)
	if left < time.Minute {
		return "Spotify asked Eco to slow down for a moment"
	}
	if left < time.Hour {
		return fmt.Sprintf("Spotify asked Eco to slow down for about %d min", int(left.Minutes()))
	}
	return fmt.Sprintf("Spotify asked Eco to slow down for about %d h %d min", int(left.Hours()), int(left.Minutes())%60)
}

// blocked returns the error to give while Spotify's pause lasts.
func (c *Client) blocked() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.blockedUntil) {
		return &RateLimitError{c.blockedUntil}
	}
	return nil
}

func (c *Client) blockFor(wait time.Duration) time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.blockedUntil = time.Now().Add(wait)
	return c.blockedUntil
}

// cacheable says which answers are the same for everyone and worth keeping. A user's likes and playlists are not.
func (c *Client) cacheable(target string) bool {
	return strings.HasPrefix(target, c.base+"/search") || strings.HasPrefix(target, c.base+"/albums/")
}

func (c *Client) cached(target string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.cache[target]
	if !ok || time.Since(entry.at) > cacheTTL {
		delete(c.cache, target)
		return nil, false
	}
	return entry.body, true
}

func (c *Client) remember(target string, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.cache) >= maxCached {
		c.cache = map[string]cachedBody{}
	}
	c.cache[target] = cachedBody{body, time.Now()}
}

// StatusError is returned for any non-2xx response.
type StatusError struct {
	Code int
	Body string
}

func (e *StatusError) Error() string { return fmt.Sprintf("spotify: HTTP %d: %s", e.Code, e.Body) }

// get fetches path (relative to the API, or an absolute "next" URL) and decodes the JSON into out.
func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	target := path
	if !strings.HasPrefix(path, "http") {
		target = c.base + path
	}
	if len(q) > 0 {
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		target += sep + q.Encode()
	}
	useCache := c.cacheable(target)
	if useCache {
		if body, ok := c.cached(target); ok {
			return json.Unmarshal(body, out)
		}
	}
	for attempt := 0; ; attempt++ {
		if err := c.blocked(); err != nil {
			return err
		}
		tok, err := c.src.Token(ctx)
		if err != nil {
			return err
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		resp, err := c.http.Do(req)
		if err != nil {
			return err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			seconds, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			wait := time.Duration(max(seconds, 1)) * time.Second
			until := c.blockFor(wait)
			if wait > maxRetryWait || attempt >= 3 {
				return &RateLimitError{until}
			}
			select {
			case <-time.After(wait):
				continue
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if resp.StatusCode/100 != 2 {
			return &StatusError{resp.StatusCode, strings.TrimSpace(string(body))}
		}
		if useCache {
			c.remember(target, body)
		}
		return json.Unmarshal(body, out)
	}
}

// Track is the subset of Spotify's track object eco needs.
type Track struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	IsLocal     bool   `json:"is_local"`
	DurationMs  int    `json:"duration_ms"`
	TrackNumber int    `json:"track_number"`
	DiscNumber  int    `json:"disc_number"`
	Artists     []struct {
		Name string `json:"name"`
	} `json:"artists"`
	Album struct {
		Name        string `json:"name"`
		ReleaseDate string `json:"release_date"`
		TotalTracks int    `json:"total_tracks"`
		Artists     []struct {
			Name string `json:"name"`
		} `json:"artists"`
		Images []struct {
			URL   string `json:"url"`
			Width int    `json:"width"`
		} `json:"images"`
	} `json:"album"`
	ExternalIDs struct {
		ISRC string `json:"isrc"`
	} `json:"external_ids"`
	ExternalURLs struct {
		Spotify string `json:"spotify"`
	} `json:"external_urls"`
}

// Meta is the flattened metadata that gets written into audio tags and CSV rows.
type Meta = catalog.Meta

func artistList(as []struct {
	Name string `json:"name"`
}) []string {
	out := make([]string, len(as))
	for i, a := range as {
		out[i] = a.Name
	}
	return out
}

func artistNames(as []struct {
	Name string `json:"name"`
}) string {
	return strings.Join(artistList(as), ", ")
}

func widestImage(images []struct {
	URL   string `json:"url"`
	Width int    `json:"width"`
}) string {
	widest, found := -1, ""
	for _, img := range images {
		if img.Width > widest {
			widest, found = img.Width, img.URL
		}
	}
	return found
}

// Meta flattens a track. Fields Spotify omits (ISRC, cover…) stay empty.
func (t Track) Meta() Meta {
	m := Meta{
		Title: t.Name, Artist: artistNames(t.Artists), Artists: artistList(t.Artists), AlbumArtist: artistNames(t.Album.Artists),
		AlbumArtists: artistList(t.Album.Artists), Album: t.Album.Name,
		Date: t.Album.ReleaseDate, Track: t.TrackNumber, Tracks: t.Album.TotalTracks, Disc: t.DiscNumber,
		DurationMs: t.DurationMs, ISRC: t.ExternalIDs.ISRC, SourceURL: t.ExternalURLs.Spotify,
	}
	if m.AlbumArtist == "" && len(t.Artists) > 0 {
		m.AlbumArtist = t.Artists[0].Name
		m.AlbumArtists = []string{t.Artists[0].Name}
	}
	if m.Album == "" {
		m.Album = t.Name
	}
	m.CoverURL = widestImage(t.Album.Images)
	return m
}

// Artist is a search hit for an artist.
type Artist struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Images []struct {
		URL   string `json:"url"`
		Width int    `json:"width"`
	} `json:"images"`
}

// SearchTracks returns one page of track results (at most PageSize).
func (c *Client) SearchTracks(ctx context.Context, query string, offset int) ([]Track, error) {
	var out struct {
		Tracks struct {
			Items []Track `json:"items"`
		} `json:"tracks"`
	}
	err := c.get(ctx, "/search", url.Values{"q": {query}, "type": {"track"}, "limit": {strconv.Itoa(PageSize)}, "offset": {strconv.Itoa(offset)}}, &out)
	return out.Tracks.Items, err
}

// SearchArtists returns the best artist matches for a query.
func (c *Client) SearchArtists(ctx context.Context, query string) ([]Artist, error) {
	var out struct {
		Artists struct {
			Items []Artist `json:"items"`
		} `json:"artists"`
	}
	err := c.get(ctx, "/search", url.Values{"q": {query}, "type": {"artist"}, "limit": {"5"}}, &out)
	return out.Artists.Items, err
}

// Album is an album search hit, or a whole album with its tracks when it comes from Album.
type Album struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AlbumType   string `json:"album_type"`
	ReleaseDate string `json:"release_date"`
	TotalTracks int    `json:"total_tracks"`
	Artists     []struct {
		Name string `json:"name"`
	} `json:"artists"`
	Images []struct {
		URL   string `json:"url"`
		Width int    `json:"width"`
	} `json:"images"`
	Tracks []Track `json:"-"` // only filled by Client.Album, in album order
}

// Artist returns the album's artists as one string.
func (a Album) Artist() string { return artistNames(a.Artists) }

// CoverURL returns the largest cover, or "" if Spotify has none.
func (a Album) CoverURL() string { return widestImage(a.Images) }

// SearchAlbums returns one page of album results (at most PageSize).
func (c *Client) SearchAlbums(ctx context.Context, query string) ([]Album, error) {
	var out struct {
		Albums struct {
			Items []*Album `json:"items"` // Spotify may send null entries
		} `json:"albums"`
	}
	if err := c.get(ctx, "/search", url.Values{"q": {query}, "type": {"album"}, "limit": {strconv.Itoa(PageSize)}}, &out); err != nil {
		return nil, err
	}
	albums := make([]Album, 0, len(out.Albums.Items))
	for _, a := range out.Albums.Items {
		if a != nil && a.ID != "" {
			albums = append(albums, *a)
		}
	}
	return albums, nil
}

// Album fetches an album and every one of its tracks, in album order.
func (c *Client) Album(ctx context.Context, id string) (Album, error) {
	var first struct {
		Album
		Tracks trackPage `json:"tracks"`
	}
	if err := c.get(ctx, "/albums/"+url.PathEscape(id), nil, &first); err != nil {
		return Album{}, err
	}
	a := first.Album
	for page := first.Tracks; ; {
		a.Tracks = append(a.Tracks, page.Items...)
		if page.Next == "" {
			return a, nil
		}
		next := page.Next
		page = trackPage{}
		if err := c.get(ctx, next, nil, &page); err != nil {
			return a, err
		}
	}
}

type trackPage struct {
	Next  string  `json:"next"`
	Items []Track `json:"items"`
}

// Track fetches a single track by its ID.
func (c *Client) Track(ctx context.Context, id string) (Track, error) {
	var t Track
	return t, c.get(ctx, "/tracks/"+url.PathEscape(id), nil, &t)
}

// Item is one entry of a user's liked songs or of a playlist.
type Item struct {
	Track   Track
	AddedAt string
}

// usable reports whether the track can be downloaded (not an episode, not a local file).
func (t Track) usable() bool { return t.ID != "" && !t.IsLocal && (t.Type == "" || t.Type == "track") }

// Each walks every page of a paginated listing, calling fn for each usable track.
// total is reported once so callers can show progress.
func (c *Client) each(ctx context.Context, first string, fn func(Item, int) error) error {
	next := first
	for next != "" {
		var page struct {
			Total int    `json:"total"`
			Next  string `json:"next"`
			Items []struct {
				AddedAt string `json:"added_at"`
				Track   *Track `json:"track"`
				Item    *Track `json:"item"` // playlist /items responses use "item" since early 2026
			} `json:"items"`
		}
		if err := c.get(ctx, next, nil, &page); err != nil {
			return err
		}
		for _, it := range page.Items {
			t := it.Item
			if t == nil {
				t = it.Track
			}
			if t == nil || !t.usable() {
				continue
			}
			if err := fn(Item{*t, it.AddedAt}, page.Total); err != nil {
				return err
			}
		}
		next = page.Next
	}
	return nil
}

// LikedSongs walks the user's liked songs, most recent first. Needs a user login.
func (c *Client) LikedSongs(ctx context.Context, fn func(Item, int) error) error {
	return c.each(ctx, "/me/tracks?limit=50", fn)
}

// PlaylistTracks walks the tracks of a playlist.
func (c *Client) PlaylistTracks(ctx context.Context, playlistID string, fn func(Item, int) error) error {
	return c.each(ctx, "/playlists/"+url.PathEscape(playlistID)+"/items?limit=50", fn)
}

// FindPlaylist returns the ID of the user's playlist called name (case-insensitive).
// On a miss the error lists the playlists that do exist.
func (c *Client) FindPlaylist(ctx context.Context, name string) (string, error) {
	next, seen := "/me/playlists?limit=50", []string{}
	for next != "" {
		var page struct {
			Next  string `json:"next"`
			Items []*struct {
				ID, Name string
			} `json:"items"`
		}
		if err := c.get(ctx, next, nil, &page); err != nil {
			return "", err
		}
		for _, p := range page.Items {
			if p == nil {
				continue
			}
			if strings.EqualFold(strings.TrimSpace(p.Name), strings.TrimSpace(name)) {
				return p.ID, nil
			}
			seen = append(seen, p.Name)
		}
		next = page.Next
	}
	return "", fmt.Errorf("playlist %q not found; your playlists:\n  %s", name, strings.Join(seen, "\n  "))
}
