package lists

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/spotify"
	"github.com/Thrashy190/eco/internal/ytdlp"
)

// Runner executes the steps of the workflow on one CSV, printing progress to Out.
type Runner struct {
	Engine *engine.Engine
	CSV    string    // the list being worked on
	Out    io.Writer // progress messages
}

func (r *Runner) printf(format string, a ...any) { fmt.Fprintf(r.Out, format, a...) }

// state is the part of a row that took work to compute and must survive a re-export.
func state(r Row) Row {
	return Row{YoutubeURL: r.YoutubeURL, YoutubeTitle: r.YoutubeTitle, YoutubeDiffS: r.YoutubeDiffS,
		Status: r.Status, File: r.File, Note: r.Note}
}

func (r *Row) setState(s Row) {
	r.YoutubeURL, r.YoutubeTitle, r.YoutubeDiffS = s.YoutubeURL, s.YoutubeTitle, s.YoutubeDiffS
	r.Status, r.File, r.Note = s.Status, s.File, s.Note
}

func rowOf(it spotify.Item) Row {
	m := it.Track.Meta()
	num := func(n int) string {
		if n == 0 {
			return ""
		}
		return strconv.Itoa(n)
	}
	return Row{SpotifyID: it.Track.ID, Title: m.Title, Artist: m.Artist, AlbumArtist: m.AlbumArtist, Album: m.Album,
		Date: m.Date, Track: num(m.Track), Tracks: num(m.Tracks), Disc: num(m.Disc), ISRC: m.ISRC,
		DurationMs: strconv.Itoa(m.DurationMs), CoverURL: m.CoverURL, SpotifyURL: m.SpotifyURL,
		AddedAt: it.AddedAt, Status: Pending}
}

// Export fetches the songs from Spotify into the CSV. Work already done on a song (its YouTube link,
// its status) is kept. For a playlist, pass the likes CSV as seed: whatever it already knows is reused,
// and songs removed from the playlist leave the CSV. Liked songs you un-liked stay, with their state.
func (r *Runner) Export(ctx context.Context, walk func(context.Context, func(spotify.Item, int) error) error, seed string, keepRemoved bool) error {
	previous, err := Read(r.CSV)
	if err != nil {
		return err
	}
	known := map[string]Row{}
	for _, p := range previous {
		known[p.SpotifyID] = p
	}
	seeded := map[string]Row{}
	if seed != "" {
		seedRows, _ := Read(seed)
		for _, s := range seedRows {
			seeded[s.SpotifyID] = s
		}
	}

	var rows []Row
	seen := map[string]bool{}
	err = walk(ctx, func(it spotify.Item, total int) error {
		if seen[it.Track.ID] { // a playlist may repeat a song
			return nil
		}
		seen[it.Track.ID] = true
		row := rowOf(it)
		if p, ok := known[row.SpotifyID]; ok {
			row.setState(state(p))
		} else if s, ok := seeded[row.SpotifyID]; ok && s.Status != Pending {
			st := state(s)
			if st.Status == Failed { // the link is fine; only the download failed
				st.Status, st.Note = Found, ""
			}
			row.setState(st)
		}
		rows = append(rows, row)
		r.printf("\r%d / %d songs", len(rows), total)
		return nil
	})
	if err != nil {
		return err
	}
	if keepRemoved {
		for _, p := range previous {
			if !seen[p.SpotifyID] {
				rows = append(rows, p)
			}
		}
	}
	r.printf("\n")
	if err := Write(r.CSV, rows); err != nil {
		return err
	}
	r.printf("✔ CSV: %s\n", r.CSV)
	return nil
}

// MarkExisting marks as downloaded every song whose file is already in the library (matching by tags,
// so songs fetched by hand count too). It returns how many it marked.
func MarkExisting(rows []Row, idx *library.Index) int {
	n := 0
	for i := range rows {
		if rows[i].Status == Downloaded {
			continue
		}
		if path, ok := idx.Find(rows[i].Title, rows[i].Artist); ok {
			rows[i].Status, rows[i].File, rows[i].Note = Downloaded, idx.Rel(path), "already in the library"
			n++
		}
	}
	return n
}

// load reads the CSV and applies MarkExisting, saving if anything changed.
func (r *Runner) load() ([]Row, error) {
	rows, err := Read(r.CSV)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("%s is empty or missing; run the export step first", r.CSV)
	}
	if n := MarkExisting(rows, library.Scan(r.Engine.Cfg.MusicDir)); n > 0 {
		r.printf("%d songs were already in the library; skipping them.\n", n)
		if err := Write(r.CSV, rows); err != nil {
			return nil, err
		}
	}
	return rows, nil
}

func head(rows []Row, first int) []Row {
	if first > 0 && first < len(rows) {
		return rows[:first]
	}
	return rows
}

func durationSec(r Row) float64 {
	ms, _ := strconv.Atoi(r.DurationMs)
	return float64(ms) / 1000
}

// Options limit a step: only the first N rows of the list, at most Limit songs, etc.
type Options struct {
	First   int           // consider only the first N rows (the most recent likes)
	Limit   int           // process at most N songs
	Workers int           // parallel searches
	Pause   time.Duration // wait between downloads
}

// Search finds the YouTube video of every pending song. Workers only query YouTube;
// the CSV is modified and saved here, in one goroutine.
func (r *Runner) Search(ctx context.Context, o Options) error {
	rows, err := r.load()
	if err != nil {
		return err
	}
	var todo []*Row
	for i := range head(rows, o.First) {
		if rows[i].Status == Pending {
			todo = append(todo, &rows[i])
		}
	}
	if o.Limit > 0 && o.Limit < len(todo) {
		todo = todo[:o.Limit]
	}
	workers := max(o.Workers, 1)
	r.printf("Searching %d songs with %d workers…\n", len(todo), workers)

	type outcome struct {
		row  *Row
		set  Row
		line string
	}
	jobs, results := make(chan *Row), make(chan outcome)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for row := range jobs {
				set, line := r.searchOne(ctx, *row)
				results <- outcome{row, set, line}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, row := range todo {
			select {
			case jobs <- row:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { wg.Wait(); close(results) }()

	done := 0
	for o := range results {
		done++
		o.row.setState(o.set)
		r.printf("[%d/%d] %s — %s\n    %s\n", done, len(todo), o.row.Artist, o.row.Title, o.line)
		if err := Write(r.CSV, rows); err != nil {
			return err
		}
	}
	return ctx.Err()
}

func (r *Runner) searchOne(ctx context.Context, row Row) (Row, string) {
	res, ok, err := r.Engine.FindVideo(ctx, match.Song{Title: row.Title, Artist: row.Artist, DurationSec: durationSec(row)})
	switch {
	case err != nil:
		return Row{Status: Pending, Note: truncate("search failed: "+err.Error(), 200)}, "✖ " + err.Error()
	case !ok:
		return Row{Status: Review, Note: "no results on YouTube"}, "? no results"
	}
	st := Row{YoutubeURL: "https://www.youtube.com/watch?v=" + res.Video.ID, YoutubeTitle: res.Video.Title,
		YoutubeDiffS: fmt.Sprintf("%.0f", res.DiffSec), Status: Review}
	mark := "?"
	if res.OK() {
		st.Status, mark = Found, "✔"
	} else {
		st.Note = strings.TrimSpace(fmt.Sprintf("diff %.0fs %s", res.DiffSec, strings.Join(res.Odd, " ")))
	}
	return st, fmt.Sprintf("%s %s  (%s, Δ%.0fs)", mark, res.Video.Title, res.Video.Channel, res.DiffSec)
}

// Download fetches every "found" song. If YouTube starts demanding a sign-in it stops and leaves
// the rest as "found": waiting a few hours (or providing cookies) fixes it.
func (r *Runner) Download(ctx context.Context, o Options) error {
	rows, err := r.load()
	if err != nil {
		return err
	}
	var queue []*Row
	for i := range head(rows, o.First) {
		switch {
		case rows[i].Status == Found && rows[i].YoutubeURL == "":
			rows[i].Status = Pending // marked found without a link: it needs a search first
		case rows[i].Status == Found:
			queue = append(queue, &rows[i])
		}
	}
	if o.Limit > 0 && o.Limit < len(queue) {
		queue = queue[:o.Limit]
	}
	dest := r.Engine.DestDir()
	for i, row := range queue {
		r.printf("[%d/%d] %s — %s\n", i+1, len(queue), row.Artist, row.Title)
		m := metaOf(*row)
		final := library.DestPath(m, engine.Codec, dest)
		fetched := false
		if _, err := os.Stat(final); err != nil {
			fetched = true
			if final, err = r.Engine.Fetch(ctx, strings.ReplaceAll(row.YoutubeURL, `\`, ""), m, dest, nil); err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if ytdlp.IsBlocked(err) {
					r.printf("    ✖ YouTube blocked the downloads. %d songs left; wait a few hours or set YT_COOKIES_BROWSER, then run this step again.\n", len(queue)-i)
					return nil
				}
				row.Status, row.Note = Failed, truncate(err.Error(), 200)
				r.printf("    ✖ %s\n", err)
				if err := Write(r.CSV, rows); err != nil {
					return err
				}
				continue
			}
		}
		row.Status, row.File, row.Note = Downloaded, library.Rel(r.Engine.Cfg.MusicDir, final), ""
		r.printf("    ✔ %s\n", library.Rel(dest, final))
		if err := Write(r.CSV, rows); err != nil {
			return err
		}
		if fetched && o.Pause > 0 {
			select {
			case <-time.After(o.Pause):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return nil
}

func metaOf(r Row) spotify.Meta {
	n := func(s string) int { v, _ := strconv.Atoi(s); return v }
	return spotify.Meta{Title: r.Title, Artist: r.Artist, AlbumArtist: r.AlbumArtist, Album: r.Album, Date: r.Date,
		Track: n(r.Track), Tracks: n(r.Tracks), Disc: n(r.Disc), ISRC: r.ISRC, CoverURL: r.CoverURL,
		SpotifyURL: r.SpotifyURL, DurationMs: n(r.DurationMs)}
}

// WritePlaylist writes <music>/Playlists/<name>.m3u with the downloaded songs in list order.
// Navidrome imports the .m3u files it finds and keeps them in sync when they change.
func (r *Runner) WritePlaylist(name string) error {
	rows, err := r.load()
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("#EXTM3U\n#PLAYLIST:" + name + "\n")
	count := 0
	for _, row := range rows {
		if row.Status != Downloaded || row.File == "" {
			continue
		}
		path := row.File
		if !filepath.IsAbs(path) {
			path = "../" + path
		}
		secs := -1
		if ms, err := strconv.Atoi(row.DurationMs); err == nil {
			secs = ms / 1000
		}
		fmt.Fprintf(&b, "#EXTINF:%d,%s - %s\n%s\n", secs, row.Artist, row.Title, path)
		count++
	}
	dir := filepath.Join(r.Engine.Cfg.MusicDir, "Playlists")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	out := filepath.Join(dir, library.Safe(name)+".m3u")
	if err := os.WriteFile(out, []byte(b.String()), 0o644); err != nil {
		return err
	}
	r.printf("✔ Playlist %q: %d songs → %s\n", name, count, out)
	return nil
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
