// Package imports reads lists of songs made elsewhere: CSV files from exporting tools (Exportify, TuneMyMusic, Soundiiz,
// eco's own likes.csv) and the JSON in the "account data" Spotify sends you on request. No account or API is involved:
// a file is the one way to bring a list over that works for everybody.
package imports

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
)

// Row is one song of a list.
type Row struct {
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album,omitempty"`
	ISRC       string `json:"isrc,omitempty"`
	DurationMs int    `json:"duration_ms,omitempty"`
}

// List is a named list of songs.
type List struct {
	Name string `json:"name"`
	Rows []Row  `json:"rows"`
}

// MaxRows is the most songs eco reads from one list.
const MaxRows = 10000

// Parse reads a file. name is the file's name, which names the list when the file itself does not.
func Parse(name string, data []byte) ([]List, error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	if first := bytes.TrimLeft(data, " \t\r\n"); len(first) > 0 && (first[0] == '{' || first[0] == '[') {
		return parseJSON(name, data)
	}
	return parseCSV(name, data)
}

// listName turns "Road trip.csv" into "Road trip".
func listName(file string) string {
	file = file[strings.LastIndexAny(file, `/\`)+1:]
	if i := strings.LastIndex(file, "."); i > 0 {
		file = file[:i]
	}
	if file = strings.TrimSpace(file); file != "" {
		return file
	}
	return "Imported"
}

var columns = map[string][]string{
	"title":    {"track name", "trackname", "title", "track", "song", "song name", "name"},
	"artist":   {"artist name(s)", "artist names", "artist name", "artistname", "artist", "artists"},
	"album":    {"album name", "albumname", "album", "release"},
	"isrc":     {"isrc"},
	"ms":       {"duration (ms)", "duration_ms", "duration ms", "track duration (ms)"},
	"playlist": {"playlist name", "playlist"},
}

// delimiter looks at the header: some tools write ";" or a tab.
func delimiter(data []byte) rune {
	line, _, _ := bytes.Cut(data, []byte("\n"))
	best, count := ',', bytes.Count(line, []byte(","))
	for _, d := range []rune{';', '\t'} {
		if n := bytes.Count(line, []byte(string(d))); n > count {
			best, count = d, n
		}
	}
	return best
}

func parseCSV(name string, data []byte) ([]List, error) {
	reader := csv.NewReader(bytes.NewReader(data))
	reader.Comma = delimiter(data)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	header, err := reader.Read()
	if err != nil {
		return nil, errors.New("this file is empty or is not a list of songs")
	}
	at := map[string]int{}
	for key, names := range columns {
		at[key] = -1
		for _, wanted := range names { // in order of preference: "name" alone is only a title if nothing better is there
			for i, col := range header {
				if at[key] < 0 && strings.EqualFold(strings.TrimSpace(col), wanted) {
					at[key] = i
				}
			}
		}
	}
	if at["title"] < 0 || at["artist"] < 0 {
		return nil, errors.New("this file has no columns for the song and the artist")
	}
	cell := func(rec []string, key string) string {
		if i := at[key]; i >= 0 && i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	fallback := listName(name)
	order := []string{}
	byName := map[string][]Row{}
	for {
		rec, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue // a damaged line loses one song, not the list
		}
		row := Row{Title: cell(rec, "title"), Artist: cleanArtists(cell(rec, "artist")), Album: cell(rec, "album"), ISRC: cell(rec, "isrc")}
		row.DurationMs, _ = strconv.Atoi(cell(rec, "ms"))
		if row.Title == "" || row.Artist == "" {
			continue
		}
		list := cell(rec, "playlist")
		if list == "" {
			list = fallback
		}
		if _, seen := byName[list]; !seen {
			order = append(order, list)
		}
		if len(byName[list]) < MaxRows {
			byName[list] = append(byName[list], row)
		}
	}
	return collect(order, byName)
}

// cleanArtists writes every tool's way of listing artists in one form.
func cleanArtists(s string) string {
	parts := strings.Split(s, ";")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return strings.Join(parts, ", ")
}

func collect(order []string, byName map[string][]Row) ([]List, error) {
	out := make([]List, 0, len(order))
	for _, name := range order {
		if len(byName[name]) > 0 {
			out = append(out, List{name, byName[name]})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no songs were found in this file")
	}
	return out, nil
}

// The two files in Spotify's "account data" that hold songs. Their format is not documented, so nothing is required.
type spotifyExport struct {
	Playlists []struct {
		Name  string `json:"name"`
		Items []struct {
			Track *struct {
				TrackName  string `json:"trackName"`
				ArtistName string `json:"artistName"`
				AlbumName  string `json:"albumName"`
			} `json:"track"`
		} `json:"items"`
	} `json:"playlists"`
	Tracks []struct { // YourLibrary.json: the liked songs
		Track  string `json:"track"`
		Artist string `json:"artist"`
		Album  string `json:"album"`
	} `json:"tracks"`
}

func parseJSON(name string, data []byte) ([]List, error) {
	var file spotifyExport
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, errors.New("this file is not a list of songs eco can read")
	}
	order := []string{}
	byName := map[string][]Row{}
	for _, p := range file.Playlists {
		list := strings.TrimSpace(p.Name)
		if list == "" {
			list = listName(name)
		}
		for _, item := range p.Items {
			if t := item.Track; t != nil && t.TrackName != "" && t.ArtistName != "" && len(byName[list]) < MaxRows {
				if _, seen := byName[list]; !seen {
					order = append(order, list)
				}
				byName[list] = append(byName[list], Row{Title: t.TrackName, Artist: t.ArtistName, Album: t.AlbumName})
			}
		}
	}
	const liked = "Liked songs"
	for _, t := range file.Tracks {
		if t.Track != "" && t.Artist != "" && len(byName[liked]) < MaxRows {
			if _, seen := byName[liked]; !seen {
				order = append(order, liked)
			}
			byName[liked] = append(byName[liked], Row{Title: t.Track, Artist: t.Artist, Album: t.Album})
		}
	}
	return collect(order, byName)
}
