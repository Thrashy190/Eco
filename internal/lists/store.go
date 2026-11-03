// Package lists is the "liked songs / playlist → CSV → YouTube → library" workflow.
// The CSV is the source of truth: each step reads it, does its work and saves it after every song,
// so any step can be interrupted and resumed.
package lists

import (
	"encoding/csv"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Status of a row. The progression is pending → found/review → downloaded (or error).
const (
	Pending    = "pending"    // not searched on YouTube yet
	Found      = "found"      // a confident video was found; `download` will fetch it
	Review     = "review"     // the best candidate is doubtful; needs a human, never downloaded automatically
	Downloaded = "downloaded" // the file is in the library (see File)
	Failed     = "error"      // the download failed (see Note); set it back to "found" to retry
)

// Row is one song of the CSV.
type Row struct {
	SpotifyID, Title, Artist, AlbumArtist, Album, Date string
	Track, Tracks, Disc, ISRC, DurationMs              string
	CoverURL, SpotifyURL, AddedAt                      string
	YoutubeURL, YoutubeTitle, YoutubeDiffS             string
	Status, File, Note                                 string // File is relative to the music folder
}

type column struct {
	name string
	old  string // header used by the previous (Spanish) version, migrated on read
	ptr  func(*Row) *string
}

var columns = []column{
	{"spotify_id", "", func(r *Row) *string { return &r.SpotifyID }},
	{"title", "", func(r *Row) *string { return &r.Title }},
	{"artist", "", func(r *Row) *string { return &r.Artist }},
	{"album_artist", "", func(r *Row) *string { return &r.AlbumArtist }},
	{"album", "", func(r *Row) *string { return &r.Album }},
	{"date", "", func(r *Row) *string { return &r.Date }},
	{"track", "", func(r *Row) *string { return &r.Track }},
	{"tracks", "", func(r *Row) *string { return &r.Tracks }},
	{"disc", "", func(r *Row) *string { return &r.Disc }},
	{"isrc", "", func(r *Row) *string { return &r.ISRC }},
	{"duration_ms", "", func(r *Row) *string { return &r.DurationMs }},
	{"cover_url", "", func(r *Row) *string { return &r.CoverURL }},
	{"spotify_url", "", func(r *Row) *string { return &r.SpotifyURL }},
	{"added_at", "", func(r *Row) *string { return &r.AddedAt }},
	{"youtube_url", "", func(r *Row) *string { return &r.YoutubeURL }},
	{"youtube_title", "", func(r *Row) *string { return &r.YoutubeTitle }},
	{"youtube_diff_s", "youtube_dif_s", func(r *Row) *string { return &r.YoutubeDiffS }},
	{"status", "estado", func(r *Row) *string { return &r.Status }},
	{"file", "archivo", func(r *Row) *string { return &r.File }},
	{"note", "nota", func(r *Row) *string { return &r.Note }},
}

// oldStatus maps the statuses of the previous Spanish version.
var oldStatus = map[string]string{
	"": Pending, "pendiente": Pending, "encontrada": Found, "revisar": Review, "descargada": Downloaded,
}

// Read loads a CSV. A missing file is an empty list. Files written by the previous Spanish version
// are understood and upgraded the next time they are written.
func Read(path string) ([]Row, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	records, err := csv.NewReader(f).ReadAll()
	if err != nil || len(records) == 0 {
		return nil, err
	}
	index := map[string]int{}
	for i, h := range records[0] {
		index[h] = i
	}
	rows := make([]Row, 0, len(records)-1)
	for _, rec := range records[1:] {
		var r Row
		for _, c := range columns {
			i, ok := index[c.name]
			if !ok && c.old != "" {
				i, ok = index[c.old]
			}
			if ok && i < len(rec) {
				*c.ptr(&r) = rec[i]
			}
		}
		if s, ok := oldStatus[r.Status]; ok {
			r.Status = s
		}
		rows = append(rows, r)
	}
	return rows, nil
}

// Write saves the rows atomically, so an interruption never leaves a half-written file.
func Write(path string, rows []Row) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := csv.NewWriter(f)
	head := make([]string, len(columns))
	for i, c := range columns {
		head[i] = c.name
	}
	w.Write(head)
	for i := range rows {
		rec := make([]string, len(columns))
		for j, c := range columns {
			rec[j] = *c.ptr(&rows[i])
		}
		w.Write(rec)
	}
	w.Flush()
	if err := errors.Join(w.Error(), f.Close()); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// Count tallies rows by status.
func Count(rows []Row) map[string]int {
	n := map[string]int{}
	for _, r := range rows {
		n[r.Status]++
	}
	return n
}
