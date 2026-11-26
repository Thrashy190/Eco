package stats

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

var day0 = time.Date(2026, 11, 2, 21, 30, 0, 0, time.UTC) // a Monday evening

func play(user, song string, at time.Time, artists ...string) Play {
	return Play{At: at, User: user, SongID: song, Title: "Song " + song, Artists: artists, Album: "Album of " + song, AlbumID: "al-" + song, Duration: 180, Genres: []string{"Reggaeton"}}
}

func TestPlaysSurviveARestartAndARepeatIsCountedOnce(t *testing.T) {
	dir := t.TempDir()
	s := &Store{Dir: dir}
	if ok, err := s.Add(play("ana", "1", day0, "Bad Bunny")); !ok || err != nil {
		t.Fatal(ok, err)
	}
	// The same song from the same person seconds later is a client sending it twice
	if ok, _ := s.Add(play("Ana", "1", day0.Add(20*time.Second), "Bad Bunny")); ok {
		t.Error("counted twice")
	}
	if ok, _ := s.Add(play("ana", "1", day0.Add(4*time.Minute), "Bad Bunny")); !ok {
		t.Error("playing it again later counts")
	}
	// A line cut short when the server stopped does not lose the others
	f, _ := os.OpenFile(filepath.Join(dir, "plays.jsonl"), os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString(`{"at":"2026-11-02T`)
	f.Close()
	again := &Store{Dir: dir}
	plays, _, err := again.Snapshot()
	if err != nil || len(plays) != 2 {
		t.Errorf("%d plays, %v", len(plays), err)
	}
}

func TestHistoryIsImportedOnceAndNotCountedTwice(t *testing.T) {
	s := &Store{Dir: t.TempDir()}
	// Counted by Eco before the history was read: Navidrome's count already holds this play
	s.Add(play("ana", "1", day0, "Bad Bunny"))
	imported := day0.Add(time.Hour)
	old := play("", "1", day0.Add(-24*time.Hour), "Bad Bunny")
	old.Count = 5
	if err := s.Import("ana", imported, []Play{old}); err != nil {
		t.Fatal(err)
	}
	if err := s.Import("ana", imported, []Play{old}); err != nil || !s.Imported("ANA") {
		t.Fatal("a second import must do nothing", err)
	}
	s.Add(play("ana", "1", day0.Add(2*time.Hour), "Bad Bunny"))
	plays, at, _ := s.Snapshot()
	all := Summarize(plays, at, Query{Now: day0.Add(3 * time.Hour), Loc: time.UTC})
	if all.Totals.Plays != 6 || all.Totals.Minutes != 18 || !all.WithHistory {
		t.Errorf("all time: %+v", all.Totals)
	}
	// Imported history has no dates, so a week only holds what Eco counted
	week := Summarize(plays, at, Query{From: day0.Add(-7 * 24 * time.Hour), Now: day0.Add(3 * time.Hour), Loc: time.UTC})
	if week.Totals.Plays != 1 || week.WithHistory {
		t.Errorf("week: %+v", week.Totals)
	}
	// The song was known from before, so playing it is not a first listen
	if week.Totals.FirstListens != 0 {
		t.Errorf("first listens = %d", week.Totals.FirstListens)
	}
}

func TestRankingsAndListeners(t *testing.T) {
	plays := []Play{
		play("ana", "titi", day0, "Bad Bunny"),
		play("ana", "titi", day0.Add(time.Hour), "Bad Bunny"),
		play("ana", "mule", day0.Add(2*time.Hour), "Bad Bunny", "Chuwi"),
		play("luis", "titi", day0.Add(3*time.Hour), "Bad Bunny"),
		play("luis", "espresso", day0.Add(4*time.Hour), "Sabrina Carpenter"),
	}
	plays[4].Genres = []string{"Pop"}
	plays[2].Genres = nil
	sum := Summarize(plays, nil, Query{Now: day0.Add(5 * time.Hour), Loc: time.UTC})
	if sum.Totals.Plays != 5 || sum.Totals.Listeners != 2 || sum.Totals.Songs != 3 || sum.Totals.Artists != 3 || sum.Totals.NoGenre != 1 || sum.Totals.FirstListens != 4 {
		t.Errorf("totals = %+v", sum.Totals)
	}
	if sum.Songs[0].Name != "Song titi" || sum.Songs[0].Plays != 3 || sum.Songs[0].Listeners != 2 {
		t.Errorf("top song = %+v", sum.Songs[0])
	}
	// Each artist of a song counts: Chuwi is on one play
	if sum.Artists[0].Name != "Bad Bunny" || sum.Artists[0].Plays != 4 || len(sum.Artists) != 3 {
		t.Errorf("artists = %+v", sum.Artists)
	}
	if sum.Genres[0].Name != "Reggaeton" || sum.Genres[0].Plays != 3 {
		t.Errorf("genres = %+v", sum.Genres)
	}
	if len(sum.Listeners) != 2 || sum.Listeners[0].User != "ana" || sum.Listeners[0].TopSong != "Song titi" || sum.Listeners[1].TopArtist == "" {
		t.Errorf("listeners = %+v", sum.Listeners)
	}
	if sum.Recent[0].Title != "Song espresso" {
		t.Errorf("recent = %+v", sum.Recent)
	}
	// 21:30 on Monday, then each hour after
	if sum.Hours[21] != 1 || sum.Hours[22] != 1 || sum.Weekdays[0] != 3 || sum.Weekdays[1] != 2 {
		t.Errorf("hours %v, weekdays %v", sum.Hours, sum.Weekdays)
	}
}

// Accounts do not see each other: a summary of one person holds nothing of anyone else's.
func TestASummaryOfOnePersonIsOnlyTheirs(t *testing.T) {
	plays := []Play{play("ana", "titi", day0, "Bad Bunny"), play("luis", "espresso", day0, "Sabrina Carpenter")}
	sum := Summarize(plays, nil, Query{User: "Luis", Now: day0.Add(time.Hour), Loc: time.UTC})
	if sum.Totals.Plays != 1 || sum.Songs[0].Name != "Song espresso" || len(sum.Listeners) != 0 {
		t.Errorf("%+v", sum)
	}
	for _, r := range sum.Recent {
		if r.User != "luis" {
			t.Errorf("someone else's play: %+v", r)
		}
	}
}

func TestTheTimelineHasEveryDayAndComparesWithBefore(t *testing.T) {
	now := day0.Add(48 * time.Hour)
	plays := []Play{play("ana", "1", day0.Add(-10*24*time.Hour)), play("ana", "2", day0), play("ana", "3", day0.Add(47*time.Hour))}
	sum := Summarize(plays, nil, Query{From: now.Add(-7 * 24 * time.Hour), Now: now, Loc: time.UTC})
	if sum.Step != "day" || len(sum.Timeline) != 8 {
		t.Fatalf("%s × %d", sum.Step, len(sum.Timeline))
	}
	total := 0
	for _, b := range sum.Timeline {
		total += b.Plays
	}
	if total != 2 || sum.Timeline[5].Plays != 1 || sum.Timeline[5].Start != "2026-11-02" {
		t.Errorf("timeline = %+v", sum.Timeline)
	}
	if sum.Previous == nil || sum.Previous.Plays != 1 {
		t.Errorf("previous = %+v", sum.Previous)
	}
	// A year goes by weeks, starting on Mondays
	year := Summarize(plays, nil, Query{From: now.AddDate(-1, 0, 0), Now: now, Loc: time.UTC})
	if year.Step != "week" {
		t.Errorf("step = %s", year.Step)
	}
	if start, _ := time.Parse(time.DateOnly, year.Timeline[0].Start); start.Weekday() != time.Monday {
		t.Errorf("weeks start on %s", start.Weekday())
	}
}

// An artist's popular songs are ordered by everyone's plays, with the history imported from Navidrome, and a play Eco
// counted before that history was read is not counted twice.
func TestSongPlaysAddUpEveryoneOnce(t *testing.T) {
	s := &Store{Dir: t.TempDir()}
	s.Add(play("ana", "1", day0, "Bad Bunny")) // already in Ana's history below
	old := play("", "1", day0.Add(-24*time.Hour), "Bad Bunny")
	old.Count = 5
	s.Import("ana", day0.Add(time.Hour), []Play{old})
	s.Add(play("ana", "1", day0.Add(2*time.Hour), "Bad Bunny"))
	s.Add(play("luis", "1", day0.Add(3*time.Hour), "Bad Bunny"))
	s.Add(play("luis", "2", day0.Add(4*time.Hour), "Bad Bunny"))
	plays, at, _ := s.Snapshot()
	got := SongPlays(plays, at)
	if got["1"] != 7 || got["2"] != 1 || len(got) != 2 {
		t.Errorf("got %v, want 1:7 2:1", got)
	}
}
