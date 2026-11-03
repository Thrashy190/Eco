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
	"time"
)

const apiBase = "https://api.spotify.com/v1"

// PageSize is the largest page Spotify allows searches in development mode.
const PageSize = 10

// TokenSource hands out a valid access token.
type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// Client talks to the Web API using a TokenSource.
type Client struct {
	http *http.Client
	src  TokenSource
}

// New returns a client authenticated by src.
func New(src TokenSource) *Client {
	return &Client{http: &http.Client{Timeout: 20 * time.Second}, src: src}
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
		target = apiBase + path
	}
	if len(q) > 0 {
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		target += sep + q.Encode()
	}
	for attempt := 0; ; attempt++ {
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
		if resp.StatusCode == http.StatusTooManyRequests && attempt < 3 {
			wait, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			select {
			case <-time.After(time.Duration(max(wait, 1)) * time.Second):
				continue
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if resp.StatusCode/100 != 2 {
			return &StatusError{resp.StatusCode, strings.TrimSpace(string(body))}
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
type Meta struct {
	Title, Artist, AlbumArtist, Album, Date string
	Track, Tracks, Disc, DurationMs         int
	ISRC, CoverURL, SpotifyURL              string
}

// Meta flattens a track. Fields Spotify omits (ISRC, cover…) stay empty.
func (t Track) Meta() Meta {
	names := func(as []struct {
		Name string `json:"name"`
	}) string {
		out := make([]string, len(as))
		for i, a := range as {
			out[i] = a.Name
		}
		return strings.Join(out, ", ")
	}
	m := Meta{
		Title: t.Name, Artist: names(t.Artists), AlbumArtist: names(t.Album.Artists), Album: t.Album.Name,
		Date: t.Album.ReleaseDate, Track: t.TrackNumber, Tracks: t.Album.TotalTracks, Disc: t.DiscNumber,
		DurationMs: t.DurationMs, ISRC: t.ExternalIDs.ISRC, SpotifyURL: t.ExternalURLs.Spotify,
	}
	if m.AlbumArtist == "" && len(t.Artists) > 0 {
		m.AlbumArtist = t.Artists[0].Name
	}
	if m.Album == "" {
		m.Album = t.Name
	}
	widest := -1
	for _, img := range t.Album.Images {
		if img.Width > widest {
			widest, m.CoverURL = img.Width, img.URL
		}
	}
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
