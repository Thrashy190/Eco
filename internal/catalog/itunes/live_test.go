package itunes

import (
	"context"
	"encoding/csv"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/catalog/musicbrainz"
)

// TestLive asks the real services what MusicBrainz alone got wrong. It only runs when asked:
//
//	ECO_LIVE_ITUNES=1 go test ./internal/catalog/itunes -run TestLive -v
func TestLive(t *testing.T) {
	if os.Getenv("ECO_LIVE_ITUNES") == "" {
		t.Skip("set ECO_LIVE_ITUNES=1")
	}
	ctx := context.Background()
	f := &catalog.Fallback{Main: musicbrainz.New(""), Backup: New("us")}
	for _, q := range []string{"espresso", "metallica one", "ella baila sola", "peso pluma", "tití me preguntó", "bad bunny baile inolvidable"} {
		start := time.Now()
		r, err := f.Search(ctx, q)
		t.Logf("SEARCH %q %.1fs err=%v", q, time.Since(start).Seconds(), err)
		for i, x := range r.Tracks {
			if i < 4 {
				t.Logf("   song  %s — %s [%s] %ds  %s", x.Artist, x.Title, x.Album, x.DurationMs/1000, x.ID[:min(12, len(x.ID))])
			}
		}
		for i, x := range r.Albums {
			if i < 2 {
				t.Logf("   album %s — %s (%s %s) %s", x.Artist(), x.Name, x.Type, x.Date, x.ID[:min(12, len(x.ID))])
			}
		}
	}
	// The five of 40 likes that MusicBrainz did not have, with their real lengths from ECO_LIVE_CSV
	lengths := map[string]int{}
	if path := os.Getenv("ECO_LIVE_CSV"); path != "" {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		rows, _ := csv.NewReader(file).ReadAll()
		at := map[string]int{}
		for i, name := range rows[0] {
			at[name] = i
		}
		for _, row := range rows[1:] {
			lengths[row[at["title"]]], _ = strconv.Atoi(row[at["duration_ms"]])
		}
	}
	for _, country := range []string{"us", "mx"} {
		g := &catalog.Fallback{Main: f.Main, Backup: New(country)}
		for _, w := range []catalog.Wanted{
			{Title: "EL GATO MALANDRIN (PASSION VALLENATA EN VIVO) - En vivo", Artist: "APV Passion Vallenata"},
			{Title: "Verónika", Artist: "SERBIA", Album: "Satélites"},
			{Title: "Brattiputy", Artist: "Yeri Mua, Uzielito Mix, Jey F, El Gudi, Alan Dazmel, Oviña", Album: "Brattiputy"},
			{Title: "The Cruel Angel's Thesis (Director's Edit Version)", Artist: "高橋　洋子", Album: "NEON GENESIS EVANGELION (Original Series Soundtrack)"},
			{Title: "El Toro Encartado - Spotify Singles", Artist: "Natanael Cano", Album: "El Toro Encartado - Spotify Singles"},
		} {
			w.DurationMs = lengths[w.Title]
			track, ok, err := g.FindTrack(ctx, w)
			t.Logf("FIND %s %s — %s (%dms): ok=%v err=%v → %s [%s] %ds cover=%v", country, w.Artist, w.Title, w.DurationMs, ok, err, track.Title, track.Album, track.DurationMs/1000, track.CoverURL != "")
		}
	}
	album, ok, err := f.FindAlbum(ctx, "Brattiputy", "Yeri Mua")
	t.Logf("FIND ALBUM ok=%v err=%v %s tracks=%d", ok, err, album.ID, len(album.Tracks))
}
