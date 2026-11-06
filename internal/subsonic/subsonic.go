// Package subsonic is a minimal client for Navidrome's Subsonic/OpenSubsonic API.
package subsonic

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Cred identifies a Navidrome user. Subsonic signs requests with t = md5(password + s),
// so clients never have to send the password itself; the legacy plain "p" is accepted too.
type Cred struct{ User, Token, Salt, Password string }

// FromQuery extracts credentials from the u/t/s/p parameters of a request.
func FromQuery(q url.Values) (Cred, bool) {
	c := Cred{q.Get("u"), q.Get("t"), q.Get("s"), q.Get("p")}
	return c, c.User != "" && ((c.Token != "" && c.Salt != "") || c.Password != "")
}

// NewCred signs in with a plain password, creating the salt and token Subsonic expects.
// The password itself is never sent.
func NewCred(user, password string) Cred {
	salt := make([]byte, 6)
	rand.Read(salt)
	s := hex.EncodeToString(salt)
	sum := md5.Sum([]byte(password + s))
	return Cred{User: user, Token: hex.EncodeToString(sum[:]), Salt: s}
}

// Key is a stable identifier for caching "these credentials were valid".
func (c Cred) Key() string { return c.User + "|" + c.Token + "|" + c.Salt + "|" + c.Password }

// Client talks to one Navidrome server.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// New returns a client for the Navidrome at baseURL.
func New(baseURL string) *Client {
	return &Client{BaseURL: baseURL, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

// Song is a track in the library.
type Song struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	ArtistID string `json:"artistId"`
	Album    string `json:"album"`
	AlbumID  string `json:"albumId"`
	Duration int    `json:"duration"`
	CoverArt string `json:"coverArt"`
	Year     int    `json:"year"`
	Starred  string `json:"starred"` // when the user favourited it; empty if not
	Size     int64  `json:"size"`    // of the file, in bytes
	Suffix   string `json:"suffix"`  // the file's extension
	Created  string `json:"created"` // when it joined the library; see newestFirst
	Track    int    `json:"track"`
	Disc     int    `json:"discNumber"`
	// AlbumArtist is the artist of the album the song is on (an OpenSubsonic field).
	AlbumArtist string `json:"displayAlbumArtist"`
}

// Album is an album in the library.
type Album struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Artist    string `json:"artist"`
	ArtistID  string `json:"artistId"`
	CoverArt  string `json:"coverArt"`
	SongCount int    `json:"songCount"`
	Year      int    `json:"year"`
}

// Artist is an artist in the library.
type Artist struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CoverArt   string `json:"coverArt"`
	AlbumCount int    `json:"albumCount"`
}

type response struct {
	Body struct {
		Status string `json:"status"`
		Error  struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Search struct {
			Songs   []Song   `json:"song"`
			Artists []Artist `json:"artist"`
			Albums  []Album  `json:"album"`
		} `json:"searchResult3"`
		AlbumList struct {
			Albums []Album `json:"album"`
		} `json:"albumList2"`
		Random struct {
			Songs []Song `json:"song"`
		} `json:"randomSongs"`
		Starred struct {
			Songs []Song `json:"song"`
		} `json:"starred2"`
		Playlists struct {
			List []Playlist `json:"playlist"`
		} `json:"playlists"`
		Song     Song `json:"song"`
		Playlist struct {
			ID      string `json:"id"`
			Entries []Song `json:"entry"`
		} `json:"playlist"`
		Scan struct {
			Scanning bool `json:"scanning"`
		} `json:"scanStatus"`
		User struct {
			AdminRole bool `json:"adminRole"`
		} `json:"user"`
	} `json:"subsonic-response"`
}

// ErrAuth is returned when Navidrome rejects the credentials.
var ErrAuth = errors.New("wrong username or password")

// APIError is a request Navidrome understood and refused (not found, not allowed…). Code is Subsonic's: 70 is not found.
type APIError struct {
	Message string
	Code    int
}

func (e *APIError) Error() string { return e.Message }

func (c *Client) call(ctx context.Context, cred Cred, endpoint string, extra url.Values) (*response, error) {
	q := url.Values{"u": {cred.User}, "v": {"1.16.1"}, "c": {"eco"}, "f": {"json"}}
	if cred.Token != "" {
		q.Set("t", cred.Token)
		q.Set("s", cred.Salt)
	} else {
		q.Set("p", cred.Password)
	}
	for k, v := range extra {
		q[k] = v
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/rest/"+endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out response
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out.Body.Status != "ok" {
		if msg := out.Body.Error.Message; msg == "Wrong username or password" {
			return nil, ErrAuth
		} else if msg != "" {
			return nil, &APIError{Message: msg, Code: out.Body.Error.Code}
		}
		return nil, &APIError{Message: "navidrome returned an error", Code: out.Body.Error.Code}
	}
	return &out, nil
}

// Ping checks the credentials.
func (c *Client) Ping(ctx context.Context, cred Cred) error {
	_, err := c.call(ctx, cred, "ping", nil)
	return err
}

// IsAdmin reports whether this user is a Navidrome administrator. An answer of "not allowed" means no; only a
// failure to reach Navidrome is an error.
func (c *Client) IsAdmin(ctx context.Context, cred Cred) (bool, error) {
	r, err := c.call(ctx, cred, "getUser", url.Values{"username": {cred.User}})
	if err != nil {
		var refused *APIError
		if errors.As(err, &refused) || errors.Is(err, ErrAuth) {
			return false, nil
		}
		return false, err
	}
	return r.Body.User.AdminRole, nil
}

// Song returns one song, with the size and extension of its file.
func (c *Client) Song(ctx context.Context, cred Cred, id string) (Song, error) {
	r, err := c.call(ctx, cred, "getSong", url.Values{"id": {id}})
	if err != nil {
		return Song{}, err
	}
	return r.Body.Song, nil
}

// SearchResult is what Search returns.
type SearchResult struct {
	Songs   []Song
	Artists []Artist
	Albums  []Album
}

// Search runs search3. An empty query lists the whole library, page by page via songOffset.
func (c *Client) Search(ctx context.Context, cred Cred, query string, songs, songOffset, artists, albums int) (SearchResult, error) {
	r, err := c.call(ctx, cred, "search3", url.Values{
		"query": {query}, "songCount": {strconv.Itoa(songs)}, "songOffset": {strconv.Itoa(songOffset)},
		"artistCount": {strconv.Itoa(artists)}, "albumCount": {strconv.Itoa(albums)},
	})
	if err != nil {
		return SearchResult{}, err
	}
	return SearchResult{r.Body.Search.Songs, r.Body.Search.Artists, r.Body.Search.Albums}, nil
}

// AlbumList returns albums of a kind: newest, recent (recently played), frequent, random, alphabeticalByName…
func (c *Client) AlbumList(ctx context.Context, cred Cred, kind string, size int) ([]Album, error) {
	r, err := c.call(ctx, cred, "getAlbumList2", url.Values{"type": {kind}, "size": {strconv.Itoa(size)}})
	if err != nil {
		return nil, err
	}
	return r.Body.AlbumList.Albums, nil
}

// RandomSongs returns n random songs.
func (c *Client) RandomSongs(ctx context.Context, cred Cred, n int) ([]Song, error) {
	r, err := c.call(ctx, cred, "getRandomSongs", url.Values{"size": {strconv.Itoa(n)}})
	if err != nil {
		return nil, err
	}
	return r.Body.Random.Songs, nil
}

// StartScan asks Navidrome to look for new files now instead of waiting for its next scheduled scan.
func (c *Client) StartScan(ctx context.Context, cred Cred) error {
	_, err := c.call(ctx, cred, "startScan", nil)
	return err
}

// Scanning reports whether a library scan is running.
func (c *Client) Scanning(ctx context.Context, cred Cred) (bool, error) {
	r, err := c.call(ctx, cred, "getScanStatus", nil)
	if err != nil {
		return false, err
	}
	return r.Body.Scan.Scanning, nil
}

// Playlist is one of the user's playlists.
type Playlist struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SongCount int    `json:"songCount"`
}

// AllSongs lists the whole library by paging through search3.
func (c *Client) AllSongs(ctx context.Context, cred Cred) ([]Song, error) {
	const page = 500
	var all []Song
	for offset := 0; ; offset += page {
		res, err := c.Search(ctx, cred, "", page, offset, 0, 0)
		if err != nil {
			return nil, err
		}
		all = append(all, res.Songs...)
		if len(res.Songs) < page {
			return all, nil
		}
	}
}

// Starred returns the user's favourite songs.
func (c *Client) Starred(ctx context.Context, cred Cred) ([]Song, error) {
	r, err := c.call(ctx, cred, "getStarred2", nil)
	if err != nil {
		return nil, err
	}
	return r.Body.Starred.Songs, nil
}

// Star marks a song as a favourite.
func (c *Client) Star(ctx context.Context, cred Cred, id string) error {
	_, err := c.call(ctx, cred, "star", url.Values{"id": {id}})
	return err
}

// Unstar removes a song from the favourites.
func (c *Client) Unstar(ctx context.Context, cred Cred, id string) error {
	_, err := c.call(ctx, cred, "unstar", url.Values{"id": {id}})
	return err
}

// Playlists lists the user's playlists.
func (c *Client) Playlists(ctx context.Context, cred Cred) ([]Playlist, error) {
	r, err := c.call(ctx, cred, "getPlaylists", nil)
	if err != nil {
		return nil, err
	}
	return r.Body.Playlists.List, nil
}

// PlaylistExists reports whether this user can see the playlist. It errors only when Navidrome cannot be asked.
func (c *Client) PlaylistExists(ctx context.Context, cred Cred, id string) (bool, error) {
	_, err := c.call(ctx, cred, "getPlaylist", url.Values{"id": {id}})
	if err == nil {
		return true, nil
	}
	var answered *APIError
	if errors.As(err, &answered) {
		return false, nil
	}
	return false, err
}

// PlaylistSongs returns the songs of a playlist this user can see.
func (c *Client) PlaylistSongs(ctx context.Context, cred Cred, id string) ([]Song, error) {
	r, err := c.call(ctx, cred, "getPlaylist", url.Values{"id": {id}})
	if err != nil {
		return nil, err
	}
	return r.Body.Playlist.Entries, nil
}

// SavePlaylist creates a playlist when id is empty, or replaces the songs of an existing one. It returns its ID.
func (c *Client) SavePlaylist(ctx context.Context, cred Cred, id, name string, songs []string) (string, error) {
	q := url.Values{"songId": songs}
	if id != "" {
		q.Set("playlistId", id)
	} else {
		q.Set("name", name)
	}
	r, err := c.call(ctx, cred, "createPlaylist", q)
	if err != nil {
		return "", err
	}
	if r.Body.Playlist.ID != "" {
		return r.Body.Playlist.ID, nil
	}
	return id, nil
}

// DeletePlaylist deletes a playlist (the songs stay in the library).
func (c *Client) DeletePlaylist(ctx context.Context, cred Cred, id string) error {
	_, err := c.call(ctx, cred, "deletePlaylist", url.Values{"id": {id}})
	return err
}
