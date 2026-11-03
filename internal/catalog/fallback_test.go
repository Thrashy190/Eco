package catalog

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fake is a catalogue with fixed answers. It counts how often it is asked.
type fake struct {
	prefix  string
	results Results
	track   Track
	album   Album
	found   bool
	err     error
	asked   int
}

func (f *fake) Name() string           { return f.prefix }
func (f *fake) Ready() error           { return nil }
func (f *fake) ValidID(id string) bool { return strings.HasPrefix(id, f.prefix) }
func (f *fake) Search(context.Context, string) (Results, error) {
	f.asked++
	return f.results, f.err
}
func (f *fake) Track(_ context.Context, id string) (Track, error) {
	f.asked++
	return Track{ID: id, Meta: Meta{Album: f.prefix}}, f.err
}
func (f *fake) Album(_ context.Context, id string) (Album, error) {
	f.asked++
	return Album{ID: id, Name: f.prefix}, f.err
}
func (f *fake) FindAlbum(context.Context, string, string) (Album, bool, error) {
	f.asked++
	return f.album, f.found, f.err
}
func (f *fake) FindTrack(context.Context, Wanted) (Track, bool, error) {
	f.asked++
	return f.track, f.found, f.err
}
func (f *fake) ByArtist(context.Context, string) ([]Track, []Album, error) {
	f.asked++
	return f.results.Tracks, f.results.Albums, f.err
}

func song(id, title, artist string, ms int) Track {
	return Track{ID: id, Meta: Meta{Title: title, Artist: artist, DurationMs: ms}}
}

type busy struct{}

func (busy) Error() string { return "busy" }
func (busy) Busy()         {}

// MusicBrainz answers "espresso" with a band called Espresso. That is not "found".
func TestSearchesItCannotBeSureOfGoToTheBackup(t *testing.T) {
	main := &fake{prefix: "mb", results: Results{Tracks: []Track{song("mb1", "Espresso", "Fresh Espresso", 84000)}}}
	backup := &fake{prefix: "it", results: Results{Tracks: []Track{song("it1", "Espresso", "Sabrina Carpenter", 175000)}}}
	got, err := (&Fallback{main, backup}).Search(context.Background(), "espresso")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tracks) != 2 || got.Tracks[0].Artist != "Sabrina Carpenter" {
		t.Errorf("tracks = %+v", got.Tracks)
	}
}

// iTunes did not have the song, and listed a medley mentioning it first.
func TestWhatWasTypedComesBeforeWhatMentionsIt(t *testing.T) {
	main := &fake{prefix: "mb", results: Results{Tracks: []Track{song("mb1", "BAILE INoLVIDABLE", "Bad Bunny", 367000), song("mb2", "Bad Bunny on BAILE INoLVIDABLE", "Bad Bunny", 251000)}}}
	backup := &fake{prefix: "it", results: Results{Tracks: []Track{song("it1", "Mix Bad Bunny Cumbia (BAILE INoLVIDABLE / KLOuFRENS)", "URI", 176000)}}}
	got, err := (&Fallback{main, backup}).Search(context.Background(), "bad bunny baile inolvidable")
	if err != nil || got.Tracks[0].ID != "mb1" {
		t.Fatalf("%+v %v", got.Tracks, err)
	}
}

// Bad Bunny's is the one in both catalogues. iTunes alone lists covers of it first.
func TestWhatBothCataloguesHaveComesFirst(t *testing.T) {
	main := []Track{song("mb1", "Tití me preguntó", "Bad Bunny", 243000), song("mb2", "Tití me preguntó", "Karavana", 179000)}
	backup := []Track{song("it1", "Tití Me Preguntó", "Antonio González", 208000), song("it2", "Titi Me Pregunto", "Los Talamantes", 165000), song("it3", "Tití Me Preguntó", "Bad Bunny", 243500)}
	ids := []string{}
	for _, track := range mergeTracks(main, backup) {
		ids = append(ids, track.ID)
	}
	if strings.Join(ids, ",") != "mb1,it1,mb2,it2" {
		t.Fatalf("ids = %v", ids)
	}
}

func TestASongInBothStaysMainsUnlessTheLengthsDisagree(t *testing.T) {
	main := []Track{song("mb1", "Tití Me Preguntó", "Bad Bunny", 243000), song("mb2", "One", "Metallica", 494000), song("mb3", "Only Here", "Someone", 100000)}
	backup := []Track{song("it2", "One", "Metallica", 446000), song("it1", "Tití me preguntó", "Bad Bunny", 243500)}
	backup[1].CoverURL = "https://apple/cover"
	got := mergeTracks(main, backup)
	ids := []string{}
	for _, track := range got {
		ids = append(ids, track.ID)
	}
	if strings.Join(ids, ",") != "it2,mb1,mb3" {
		t.Fatalf("ids = %v", ids)
	}
	if got[1].CoverURL != "https://apple/cover" {
		t.Errorf("the backup's picture was not kept: %+v", got[1])
	}
}

func TestMainBeingDownIsNotTheEnd(t *testing.T) {
	main := &fake{prefix: "mb", err: busy{}}
	backup := &fake{prefix: "it", results: Results{Tracks: []Track{song("it1", "One", "Metallica", 1)}}, found: true, track: song("it1", "One", "Metallica", 1), album: Album{ID: "it9"}}
	f := &Fallback{main, backup}
	if got, err := f.Search(context.Background(), "one"); err != nil || len(got.Tracks) != 1 {
		t.Errorf("search: %+v %v", got, err)
	}
	if got, ok, err := f.FindTrack(context.Background(), Wanted{Title: "One"}); err != nil || !ok || got.ID != "it1" {
		t.Errorf("find track: %+v %v %v", got, ok, err)
	}
	if got, ok, err := f.FindAlbum(context.Background(), "A", "B"); err != nil || !ok || got.ID != "it9" {
		t.Errorf("find album: %+v %v %v", got, ok, err)
	}
	if tracks, _, err := f.ByArtist(context.Background(), "X"); err != nil || len(tracks) != 1 {
		t.Errorf("by artist: %+v %v", tracks, err)
	}
}

func TestWhenBothFailTheReasonIsMains(t *testing.T) {
	failed := errors.New("main failed")
	f := &Fallback{&fake{prefix: "mb", err: failed}, &fake{prefix: "it", err: busy{}}}
	if _, err := f.Search(context.Background(), "x"); !errors.Is(err, failed) {
		t.Errorf("search: %v", err)
	}
	if _, _, err := f.FindTrack(context.Background(), Wanted{}); !errors.Is(err, failed) {
		t.Errorf("find track: %v", err)
	}
}

func TestNotFoundInBothIsNotFound(t *testing.T) {
	f := &Fallback{&fake{prefix: "mb"}, &fake{prefix: "it"}}
	if _, ok, err := f.FindTrack(context.Background(), Wanted{Title: "x"}); ok || err != nil {
		t.Errorf("ok = %v, err = %v", ok, err)
	}
}

func TestAnIDGoesBackToItsOwnCatalogue(t *testing.T) {
	main, backup := &fake{prefix: "mb"}, &fake{prefix: "it"}
	f := &Fallback{main, backup}
	if got, _ := f.Track(context.Background(), "it-1"); got.Album != "it" {
		t.Errorf("got %+v", got)
	}
	if got, _ := f.Album(context.Background(), "mb1"); got.Name != "mb" {
		t.Errorf("got %+v", got)
	}
	if !f.ValidID("it-1") || !f.ValidID("mb1") || f.ValidID("../x") {
		t.Error("ValidID")
	}
}
