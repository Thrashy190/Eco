package match

import "testing"

func TestNorm(t *testing.T) {
	for in, want := range map[string]string{
		"Tití Me Preguntó (Remastered) - 2011 feat. X": "titi me pregunto",
		"Song - Remastered 2011":                       "song",
		"Hello  World!!":                               "hello world",
	} {
		if got := Norm(in); got != want {
			t.Errorf("Norm(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormKeepsOtherAlphabets(t *testing.T) {
	if Norm("не попался") == "" || Norm("ちょうど") == "" {
		t.Fatal("non-Latin titles must not collapse to an empty string")
	}
	if Norm("не попался") == Norm("ちょうど") {
		t.Fatal("different titles must stay different")
	}
}

func TestSameTitle(t *testing.T) {
	cases := []struct {
		song, video string
		want        bool
	}{
		{"Mi Niña", "Wisin & Yandel - My Girl", false}, // same duration, different song
		{"Table Dance", "TABLEDANCE (Official Video)", true},
		{"0:00", "00:00", true},
		{"Sexy Movimiento", "Wisin & Yandel - Sexy Movimiento (Visualizer)", true},
	}
	for _, c := range cases {
		if got := SameTitle(c.song, c.video); got != c.want {
			t.Errorf("SameTitle(%q, %q) = %v, want %v", c.song, c.video, got, c.want)
		}
	}
}

func TestBestPrefersTheRightVersion(t *testing.T) {
	song := Song{Title: "Sexy Movimiento", Artist: "Wisin & Yandel", DurationSec: 210}
	best, ok := Best(song, []Video{
		{ID: "live", Title: "Wisin & Yandel - Sexy Movimiento (En Vivo)", Channel: "Fan", DurationSec: 212},
		{ID: "remix", Title: "Sexy Movimiento Remix", Channel: "DJ", DurationSec: 210},
		{ID: "good", Title: "Wisin & Yandel - Sexy Movimiento (Audio)", Channel: "Wisin & Yandel", DurationSec: 210},
	})
	if !ok || best.Video.ID != "good" || !best.OK() || !best.Clear() {
		t.Fatalf("got %+v", best)
	}
}

func TestWantedVersionIsNotPenalised(t *testing.T) {
	r := Score(Song{Title: "Song (Live)", Artist: "A", DurationSec: 200}, Video{Title: "A - Song (Live)", DurationSec: 201})
	if len(r.Odd) != 0 {
		t.Fatalf("live was requested, got %v", r.Odd)
	}
}

func TestTooFarOffIsNotOK(t *testing.T) {
	r := Score(Song{Title: "Song", Artist: "A", DurationSec: 200}, Video{Title: "A - Song", DurationSec: 230})
	if r.OK() {
		t.Fatal("30 s off must need a human check")
	}
}
