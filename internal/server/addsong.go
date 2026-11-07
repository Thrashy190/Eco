package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // covers Navidrome hands back as PNG
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Adding a song by hand: a YouTube link, and what the person says the song is. For songs the catalogue does not know or
// knows wrong. The album is one already in the library (the song joins it: the same album tags as its files, in its
// folder), one from the catalogue, or a new one described here.

type addSongAlbum struct {
	Library string `json:"library,omitempty"` // a Navidrome album ID
	Catalog string `json:"catalog,omitempty"` // a catalogue album ID
	// Or a new album
	Name    string   `json:"name,omitempty"`
	Artists []string `json:"artists,omitempty"`
	Date    string   `json:"date,omitempty"`
	Cover   string   `json:"cover,omitempty"`   // "video" (the video's picture), "upload" (Picture) or "" (none)
	Picture []byte   `json:"picture,omitempty"` // a JPEG, base64 in the JSON
}

type addSongRequest struct {
	URL     string       `json:"url"`
	Title   string       `json:"title"`
	Artists []string     `json:"artists"`
	Track   int          `json:"track"`
	Disc    int          `json:"disc"`
	Album   addSongAlbum `json:"album"`
}

// linkPayload is a song added by hand, ready to download: everything about it is decided before it is queued.
type linkPayload struct {
	Cred       subsonic.Cred
	URL        string
	VideoID    string
	Meta       catalog.Meta
	Cover      []byte // embedded as it is; nil finds one (Meta.CoverURL, then the catalogue)
	VideoCover bool   // use the video's picture
	Folder     string // the album's folder, when the song joins one on disk
}

const (
	maxNameRunes = 200
	maxArtists   = 10
)

var datePattern = regexp.MustCompile(`^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$`)

// cleanNames trims and checks artist names. A name may not hold "; ", which tags use between artists (tag.Separator).
func cleanNames(names []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, name := range names {
		name = strings.Join(strings.Fields(name), " ")
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		if strings.Contains(name, ";") {
			return nil, fmt.Errorf("%q: a name cannot hold a semicolon", name)
		}
		if utf8.RuneCountInString(name) > maxNameRunes {
			return nil, errors.New("an artist's name is too long")
		}
		seen[strings.ToLower(name)] = true
		out = append(out, name)
	}
	if len(out) > maxArtists {
		return nil, fmt.Errorf("at most %d artists", maxArtists)
	}
	return out, nil
}

// songMeta checks what the person typed about the song itself and turns it into tags. The album comes after.
func songMeta(req addSongRequest) (catalog.Meta, error) {
	title := strings.Join(strings.Fields(req.Title), " ")
	if title == "" {
		return catalog.Meta{}, errors.New("the song needs a title")
	}
	if utf8.RuneCountInString(title) > maxNameRunes {
		return catalog.Meta{}, errors.New("the title is too long")
	}
	artists, err := cleanNames(req.Artists)
	if err != nil {
		return catalog.Meta{}, err
	}
	if len(artists) == 0 {
		return catalog.Meta{}, errors.New("the song needs an artist")
	}
	if req.Track < 0 || req.Track > 999 || req.Disc < 0 || req.Disc > 99 {
		return catalog.Meta{}, errors.New("that track or disc number is out of range")
	}
	return catalog.Meta{Title: title, Artists: artists, Artist: strings.Join(artists, ", "), Track: req.Track, Disc: req.Disc}, nil
}

// newAlbumMeta fills in an album described by hand.
func newAlbumMeta(m catalog.Meta, a addSongAlbum) (catalog.Meta, error) {
	name := strings.Join(strings.Fields(a.Name), " ")
	if name == "" {
		return m, errors.New("choose an album, or give the new one a name")
	}
	if utf8.RuneCountInString(name) > maxNameRunes {
		return m, errors.New("the album's name is too long")
	}
	artists, err := cleanNames(a.Artists)
	if err != nil {
		return m, err
	}
	if len(artists) == 0 {
		artists = m.Artists // the usual case: the album is by whoever made the song
	}
	date := strings.TrimSpace(a.Date)
	if date != "" && !datePattern.MatchString(date) {
		return m, errors.New("write the album's date as a year (2021) or a full date (2021-05-14)")
	}
	m.Album, m.AlbumArtists, m.AlbumArtist, m.Date = name, artists, strings.Join(artists, ", "), date
	return m, nil
}

func (s *Server) addSong(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var req addSongRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	link, err := youtubeURL(req.URL)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	m, err := songMeta(req)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	m.SourceURL = link
	p := linkPayload{Cred: cred, URL: link}
	ctx := r.Context()
	switch a := req.Album; {
	case a.Library != "":
		if !userdata.ValidID(a.Library) {
			fail(w, http.StatusBadRequest, "invalid album id")
			return
		}
		if m, p.Folder, p.Cover, err = s.joinLibraryAlbum(ctx, cred, a.Library, m); err != nil {
			fail(w, http.StatusBadGateway, err.Error())
			return
		}
	case a.Catalog != "":
		if !s.eng.Catalog.ValidID(a.Catalog) {
			fail(w, http.StatusBadRequest, "invalid album id")
			return
		}
		find, cancel := context.WithTimeout(ctx, catalogTimeout)
		album, err := s.eng.Catalog.Album(find, a.Catalog)
		cancel()
		if err != nil {
			fail(w, http.StatusBadGateway, s.eng.Catalog.Name()+": "+err.Error())
			return
		}
		m.Album, m.AlbumArtists, m.AlbumArtist, m.Date, m.Tracks, m.CoverURL = album.Name, album.Artists, album.Artist(), album.Date, album.TotalTracks, album.CoverURL
	default:
		if m, err = newAlbumMeta(m, a); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		switch a.Cover {
		case "video":
			p.VideoCover = true
		case "upload":
			if len(a.Picture) > userdata.MaxCoverBytes {
				fail(w, http.StatusBadRequest, "that picture is too big")
				return
			}
			if _, err := jpeg.DecodeConfig(bytes.NewReader(a.Picture)); err != nil {
				fail(w, http.StatusBadRequest, "the picture must be a JPEG")
				return
			}
			p.Cover = a.Picture
		case "":
		default:
			fail(w, http.StatusBadRequest, "unknown cover")
			return
		}
	}

	look, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	prev, err := s.eng.YT.Preview(look, link)
	if err != nil {
		fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if prev.Live {
		fail(w, http.StatusBadRequest, "live streams cannot be added")
		return
	}
	if !media.ValidID(prev.ID) {
		fail(w, http.StatusBadGateway, "YouTube gave an odd video id")
		return
	}
	p.VideoID, p.Meta = prev.ID, m
	job, isNew := s.jobs.SubmitWith("link:"+prev.ID, cred.User, p, func(j *jobs.Job) {
		j.Title, j.Artist, j.Album = m.Title, m.Artist, m.Album
	})
	code := http.StatusOK
	if isNew {
		code = http.StatusAccepted
	}
	respond(w, code, job)
}

// joinLibraryAlbum makes a song one of the songs of an album in the library. Navidrome tells albums apart by their
// name, album artist and date as the files write them, so those are read from one of its files; the song is stored
// next to it when that file is one of Eco's downloads (Eco writes nowhere else). The album's cover is embedded too.
func (s *Server) joinLibraryAlbum(ctx context.Context, cred subsonic.Cred, id string, m catalog.Meta) (catalog.Meta, string, []byte, error) {
	album, songs, err := s.nd.Album(ctx, cred, id)
	if err != nil {
		return m, "", nil, errors.New("Navidrome: " + err.Error())
	}
	if len(songs) == 0 {
		return m, "", nil, errors.New("that album has no songs left")
	}
	m.Album, m.AlbumArtist, m.Tracks = album.Name, album.Artist, 0
	if songs[0].AlbumArtist != "" {
		m.AlbumArtist = songs[0].AlbumArtist
	}
	if album.Year > 0 {
		m.Date = fmt.Sprint(album.Year)
	}
	folder := ""
	for _, song := range songs[:min(len(songs), 5)] {
		path, err := library.FindSongFile(s.cfg.MusicDir, song.Size, song.Suffix, song.Title)
		if err != nil {
			continue
		}
		tags, ok := library.ReadAlbumTags(path)
		if !ok {
			continue
		}
		m.Album, m.AlbumArtist, m.Date, m.Tracks = tags.Album, tags.AlbumArtist, tags.Date, tags.Tracks
		if rel, err := filepath.Rel(s.eng.DestDir(), path); err == nil && !strings.HasPrefix(rel, "..") {
			folder = filepath.Dir(path)
		}
		break
	}
	// The album artist as the files write it ("A; B") already holds the separator: written again as it is
	m.AlbumArtists = nil
	if m.Tracks > 0 && m.Track > m.Tracks {
		m.Tracks = m.Track
	}
	var cover []byte
	if album.CoverArt != "" {
		if data, err := s.nd.CoverArt(ctx, cred, album.CoverArt, 800); err == nil {
			cover = asJPEG(data)
		}
	}
	return m, folder, cover, nil
}

// asJPEG returns a picture as a JPEG (tags hold JPEGs), or nil when it is not a picture Go can read.
func asJPEG(data []byte) []byte {
	if _, err := jpeg.DecodeConfig(bytes.NewReader(data)); err == nil {
		return data
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	var out bytes.Buffer
	if jpeg.Encode(&out, img, &jpeg.Options{Quality: 90}) != nil {
		return nil
	}
	return out.Bytes()
}

// videoCover is a video's picture as a square cover: the middle of its frame. The address is built from the video's ID,
// never taken from what yt-dlp or the app said, so the server only ever fetches YouTube's own pictures.
func (s *Server) videoCover(ctx context.Context, id string) []byte {
	if !media.ValidID(id) {
		return nil
	}
	for _, name := range []string{"maxresdefault.jpg", "hqdefault.jpg"} {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://i.ytimg.com/vi/"+id+"/"+name, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			continue
		}
		if square := squareFrame(data); square != nil {
			return square
		}
	}
	return nil
}

// squareFrame cuts the middle square out of a video picture. hqdefault is 4:3 with black bars above and below a 16:9
// frame, so the square is taken from the frame, not the bars.
func squareFrame(data []byte) []byte {
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	b := img.Bounds()
	frame := min(b.Dy(), b.Dx()*9/16)
	side := min(b.Dx(), frame)
	x, y := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	sub, ok := img.(interface {
		SubImage(image.Rectangle) image.Image
	})
	if !ok || side <= 0 {
		return nil
	}
	var out bytes.Buffer
	if jpeg.Encode(&out, sub.SubImage(image.Rect(x, y, x+side, y+side)), &jpeg.Options{Quality: 90}) != nil {
		return nil
	}
	return out.Bytes()
}

// runLink downloads a song added by hand and waits for Navidrome to list it.
func (s *Server) runLink(ctx context.Context, p linkPayload, set func(func(*jobs.Job))) error {
	set(func(j *jobs.Job) { j.State = jobs.Downloading })
	cover := p.Cover
	if p.VideoCover {
		cover = s.videoCover(ctx, p.VideoID)
	}
	path, err := s.eng.FetchWith(ctx, p.URL, p.Meta, cover, p.Folder, s.progress(set))
	if err != nil {
		return err
	}
	return s.awaitSong(ctx, p.Meta, p.Cred, path, set)
}
