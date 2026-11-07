package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// ---- Albums ----
// Albums with no cover, and tags that make an album look wrong in Navidrome: no year, no track numbers or the same one
// twice, no album artist, titles that still say "(Official Video)", and an album shown more than once because its songs
// disagree. Eco only reports these, except a missing cover, which it can add (a cover.jpg next to the songs).

// albumProblem is one thing wrong with an album. Code is for the app; Text is for people.
type albumProblem struct {
	Code string `json:"code"`
	Text string `json:"text"`
}

type albumIssue struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Artist   string         `json:"artist"`
	Year     int            `json:"year,omitempty"`
	Cover    string         `json:"cover,omitempty"`
	Songs    int            `json:"songs"`
	Problems []albumProblem `json:"problems"`
}

// videoWords finds what a video's title says about the video, not the song.
var videoWords = regexp.MustCompile(`(?i)[(\[][^)\]]*\b(official|video|videoclip|lyrics?|letra|visuali[sz]er|audio|hd|4k|mv)\b[^)\]]*[)\]]`)

var unknownNames = map[string]bool{"": true, "[unknown artist]": true, "[unknown album]": true, "unknown": true}

// findAlbumIssues checks every album of the library. hasCover says whether a song's album has a picture; its second
// answer is false when the song's file could not be found, and nothing is said about the cover then.
func findAlbumIssues(songs []subsonic.Song, hasCover func(subsonic.Song) (bool, bool)) []albumIssue {
	byAlbum := map[string][]subsonic.Song{}
	order := []string{}
	for _, s := range songs {
		if s.AlbumID == "" {
			continue
		}
		if _, ok := byAlbum[s.AlbumID]; !ok {
			order = append(order, s.AlbumID)
		}
		byAlbum[s.AlbumID] = append(byAlbum[s.AlbumID], s)
	}
	artistOf := func(list []subsonic.Song) string {
		if list[0].AlbumArtist != "" {
			return list[0].AlbumArtist
		}
		return list[0].Artist
	}
	// The same name and album artist under more than one ID: Navidrome made two albums of one
	sameAlbum := map[string][]string{}
	for _, id := range order {
		list := byAlbum[id]
		key := match.Norm(list[0].Album) + "|" + match.Norm(artistOf(list))
		sameAlbum[key] = append(sameAlbum[key], id)
	}

	out := []albumIssue{}
	for _, id := range order {
		list := byAlbum[id]
		first := list[0]
		issue := albumIssue{ID: id, Name: first.Album, Artist: artistOf(list), Cover: first.CoverArt, Songs: len(list)}
		add := func(code, text string) { issue.Problems = append(issue.Problems, albumProblem{code, text}) }

		if has, known := hasCover(first); known && !has {
			add("no_cover", "No cover picture")
		}
		if unknownNames[strings.ToLower(first.Album)] {
			add("no_album", "Its songs have no album name")
		}
		if unknownNames[strings.ToLower(issue.Artist)] {
			add("no_artist", "No album artist")
		}
		years, numbered, used, twice := 0, 0, map[string]int{}, []int{}
		for _, s := range list {
			if s.Year > issue.Year {
				issue.Year = s.Year
			}
			if s.Year > 0 {
				years++
			}
			if s.Track > 0 {
				numbered++
				key := fmt.Sprint(s.Disc, "-", s.Track)
				if used[key]++; used[key] == 2 {
					twice = append(twice, s.Track)
				}
			}
		}
		if years == 0 {
			add("no_year", "No year")
		}
		if len(list) > 1 && numbered < len(list) {
			add("no_tracks", fmt.Sprintf("%d of its %d songs have no track number", len(list)-numbered, len(list)))
		}
		if len(twice) > 0 {
			sort.Ints(twice)
			add("same_track", fmt.Sprintf("More than one song is number %s", joinNumbers(twice)))
		}
		for _, s := range list {
			if videoWords.MatchString(s.Title) {
				add("video_title", fmt.Sprintf("“%s” still has the video's words in its title", s.Title))
				break
			}
		}
		if parts := sameAlbum[match.Norm(first.Album)+"|"+match.Norm(issue.Artist)]; len(parts) > 1 {
			add("split", fmt.Sprintf("Shown as %d albums: its songs disagree on the date or the album artist", len(parts)))
		}
		if len(issue.Problems) > 0 {
			out = append(out, issue)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func joinNumbers(n []int) string {
	parts := make([]string, len(n))
	for i, v := range n {
		parts[i] = fmt.Sprint(v)
	}
	return strings.Join(parts, ", ")
}

// albumIssues checks the library's albums, looking at the files on disk for their covers.
func (s *Server) albumIssues(songs []subsonic.Song) []albumIssue {
	files := library.IndexFiles(s.cfg.MusicDir)
	return findAlbumIssues(songs, func(song subsonic.Song) (bool, bool) {
		path, ok := files.Find(song.Size, song.Suffix, song.Title)
		if !ok {
			return false, false
		}
		return library.HasCover(path), true
	})
}

// albumFolders returns the folders holding an album's songs.
func (s *Server) albumFolders(ctx context.Context, cred subsonic.Cred, id string) ([]string, error) {
	_, songs, err := s.nd.Album(ctx, cred, id)
	if err != nil {
		return nil, err
	}
	files := library.IndexFiles(s.cfg.MusicDir)
	seen := map[string]bool{}
	folders := []string{}
	for _, song := range songs {
		if path, ok := files.Find(song.Size, song.Suffix, song.Title); ok && !seen[filepath.Dir(path)] {
			seen[filepath.Dir(path)] = true
			folders = append(folders, filepath.Dir(path))
		}
	}
	if len(folders) == 0 {
		return nil, errors.New("could not find this album's files in the music folder")
	}
	return folders, nil
}

// cleanupCover gives an album with no cover a picture: a cover.jpg in each of its folders, which Navidrome prefers over
// anything else. The picture is the cover a catalogue album has (the server fetches it: an address from the app could
// point anywhere) or one the person chose (a JPEG). It never replaces a cover that is there.
func (s *Server) cleanupCover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid album id")
		return
	}
	var body struct {
		Catalog string `json:"catalog"`
		Picture []byte `json:"picture"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	picture := body.Picture
	switch {
	case len(picture) > 0:
		if len(picture) > userdata.MaxCoverBytes {
			fail(w, http.StatusBadRequest, "that picture is too big")
			return
		}
	case body.Catalog != "" && s.eng.Catalog.ValidID(body.Catalog):
		find, cancel := context.WithTimeout(r.Context(), catalogTimeout)
		album, err := s.eng.Catalog.Album(find, body.Catalog)
		cancel()
		if err != nil || album.CoverURL == "" {
			fail(w, http.StatusBadGateway, "The catalogue has no picture for that album")
			return
		}
		if picture = s.fetchPicture(r.Context(), album.CoverURL); picture == nil {
			fail(w, http.StatusBadGateway, "Could not fetch that picture")
			return
		}
	default:
		fail(w, http.StatusBadRequest, "choose a picture")
		return
	}
	if picture = asJPEG(picture); picture == nil {
		fail(w, http.StatusBadRequest, "the picture must be a JPEG or PNG")
		return
	}
	if _, err := jpeg.DecodeConfig(bytes.NewReader(picture)); err != nil {
		fail(w, http.StatusBadRequest, "the picture must be a JPEG")
		return
	}
	folders, err := s.albumFolders(r.Context(), cred, id)
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	written := 0
	for _, dir := range folders {
		if library.FolderCover(dir) != "" {
			continue
		}
		f, err := os.OpenFile(filepath.Join(dir, "cover.jpg"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			continue
		}
		_, werr := f.Write(picture)
		if cerr := f.Close(); werr != nil || cerr != nil {
			os.Remove(f.Name())
			continue
		}
		written++
	}
	if written == 0 {
		fail(w, http.StatusConflict, "The album's folder already has a cover, or Eco cannot write there")
		return
	}
	log.Printf("admin %s added a cover to album %s (%d folders)", cred.User, id, written)
	s.rescan(r.Context(), cred)
	s.forgetLibrary()
	respond(w, http.StatusOK, map[string]any{"written": written})
}

// fetchPicture fetches a picture whose address the server chose.
func (s *Server) fetchPicture(ctx context.Context, link string) []byte {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil
	}
	return data
}
