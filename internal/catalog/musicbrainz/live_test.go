package musicbrainz

import (
	"context"
	"encoding/csv"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
)

// TestLive asks the real MusicBrainz, at one request per second, how well it answers. It only runs when asked:
//
//	ECO_LIVE_MUSICBRAINZ=1 go test ./internal/catalog/musicbrainz -run TestLive -v -timeout 15m
//
// ECO_LIVE_CSV may name a likes.csv to sample songs from. It is only read.
func TestLive(t *testing.T) {
	if os.Getenv("ECO_LIVE_MUSICBRAINZ") == "" {
		t.Skip("set ECO_LIVE_MUSICBRAINZ=1")
	}
	c := New("")
	ctx := context.Background()
	for _, q := range []string{"metallica one", "bad bunny baile inolvidable", "tití me preguntó", "ella baila sola", "peso pluma", "un verano sin ti", "espresso"} {
		start := time.Now()
		r, err := c.Search(ctx, q)
		t.Logf("SEARCH %q %.1fs artist=%q err=%v", q, time.Since(start).Seconds(), r.Artist, err)
		for i, x := range r.Tracks {
			if i < 5 {
				t.Logf("   song  %s — %s [%s] %ds", x.Artist, x.Title, x.Album, x.DurationMs/1000)
			}
		}
		for i, x := range r.Albums {
			if i < 3 {
				t.Logf("   album %s — %s (%s %s)", x.Artist(), x.Name, x.Type, x.Date)
			}
		}
	}
	tracks, albums, err := c.ByArtist(ctx, "Bad Bunny")
	t.Logf("BY ARTIST songs=%d albums=%d err=%v", len(tracks), len(albums), err)
	for i, x := range albums {
		if i < 8 {
			t.Logf("   %s (%s %s)", x.Name, x.Type, x.Date)
		}
	}
	for i, x := range tracks {
		if i < 8 {
			t.Logf("   %s [%s]", x.Title, x.Album)
		}
	}
	album, ok, err := c.FindAlbum(ctx, "DeBÍ TiRAR MáS FOToS", "Bad Bunny")
	t.Logf("FIND ALBUM ok=%v err=%v tracks=%d cover=%s", ok, err, len(album.Tracks), album.CoverURL)
	if len(album.Tracks) > 0 {
		one := album.Tracks[0]
		t.Logf("   first: %d-%d %s by %q on %q aa=%q id=%s", one.Disc, one.Meta.Track, one.Title, one.Artist, one.Album, one.AlbumArtist, one.ID)
		full, err := c.Track(ctx, one.ID)
		t.Logf("   track lookup: %+v err=%v", full.Meta, err)
	}

	path := os.Getenv("ECO_LIVE_CSV")
	if path == "" {
		return
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	rows, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	col := map[string]int{}
	for i, name := range rows[0] {
		col[name] = i
	}
	random := rand.New(rand.NewSource(7))
	rows = rows[1:]
	random.Shuffle(len(rows), func(i, j int) { rows[i], rows[j] = rows[j], rows[i] })
	found, covers, want := 0, 0, 40
	for _, row := range rows[:want] {
		ms, _ := strconv.Atoi(row[col["duration_ms"]])
		w := catalog.Wanted{Title: row[col["title"]], Artist: row[col["artist"]], Album: row[col["album"]], ISRC: row[col["isrc"]], DurationMs: ms}
		track, ok, err := c.FindTrack(ctx, w)
		mark, cover := "NO ", ""
		if ok {
			found++
			mark = "OK "
			if resp, err := http.Head(track.CoverURL); err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					covers++
					cover = "cover"
				}
			}
		}
		t.Log(fmt.Sprintf("%s %-5s %s — %s [%s]  err=%v  → album %q", mark, cover, w.Artist, w.Title, w.Album, err, track.Album))
	}
	t.Logf("FOUND %d of %d, with cover %d", found, want, covers)
}
