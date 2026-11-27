package jam

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type clock struct{ now time.Time }

func (c *clock) add(d time.Duration) { c.now = c.now.Add(d) }

func newStore() (*Store, *clock) {
	c := &clock{time.Date(2026, 11, 26, 20, 0, 0, 0, time.UTC)}
	s := New()
	s.Now = func() time.Time { return c.now }
	return s, c
}

func songs(titles ...string) []Song {
	out := make([]Song, len(titles))
	for i, t := range titles {
		out[i] = Song{ID: strings.ToLower(t), Title: t, Duration: 100}
	}
	return out
}

func titles(v View) string {
	var out []string
	for i, e := range v.Queue {
		mark := ""
		if i == v.Current {
			mark = "*"
		}
		out = append(out, mark+e.Song.Title)
	}
	return strings.Join(out, ",")
}

// ok stops the test on an error: ok(t)(s.Add(...)).
func ok(t *testing.T) func(View, error) View {
	t.Helper()
	return func(v View, err error) View {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
}

// A private Jam is only there for its host and the people invited; a public one for everyone. Joining another Jam
// leaves the first, and the host leaving ends the Jam for everyone.
func TestWhoSeesAndJoinsAJam(t *testing.T) {
	s, _ := newStore()
	private, _, err := s.Create("Ana", Settings{Name: "Late night"})
	if err != nil {
		t.Fatal(err)
	}
	public, _, _ := s.Create("Luis", Settings{Public: true})
	if public.Name != "Luis's Jam" {
		t.Errorf("default name: %q", public.Name)
	}
	if got := len(s.List("pedro")); got != 1 {
		t.Errorf("pedro sees %d jams, want only the public one", got)
	}
	if _, _, err := s.Join("pedro", private.ID); !errors.Is(err, ErrNoJam) {
		t.Errorf("pedro joining a private jam: %v", err)
	}
	if _, err := s.View("pedro", private.ID); !errors.Is(err, ErrNoJam) {
		t.Errorf("pedro looking at a private jam: %v", err)
	}
	ok(t)(s.Invite("ana", private.ID, []string{"Pedro"}))
	if _, err := s.Invite("luis", public.ID+"x", nil); !errors.Is(err, ErrNoJam) {
		t.Errorf("a jam that does not exist: %v", err)
	}
	v, _, err := s.Join("pedro", private.ID)
	if err != nil || strings.Join(v.Members, ",") != "Ana,pedro" || v.CanControl {
		t.Fatalf("pedro joining: %v %+v", err, v)
	}
	if len(v.Invited) != 0 {
		t.Error("a guest sees who was invited")
	}
	// Joining the public Jam leaves the private one
	_, change, _ := s.Join("pedro", public.ID)
	if change.Left != private.ID || change.Ended {
		t.Errorf("change: %+v", change)
	}
	if got := s.Members(private.ID); strings.Join(got, ",") != "Ana" {
		t.Errorf("private jam members: %v", got)
	}
	// The host leaves: the Jam is gone for everyone
	if ended, err := s.Leave("luis", public.ID); !ended || err != nil {
		t.Fatalf("host leaving: %v %v", ended, err)
	}
	if _, ok := s.Of("pedro"); ok {
		t.Error("pedro is still in an ended jam")
	}
	if _, err := s.View("pedro", public.ID); !errors.Is(err, ErrNoJam) {
		t.Errorf("an ended jam: %v", err)
	}
}

// Everyone adds; only the host, or everyone when the host allows it, controls. Anyone takes out what they added.
func TestWhoControlsAJam(t *testing.T) {
	s, _ := newStore()
	v, _, _ := s.Create("ana", Settings{Public: true})
	ok(t)(s.Add("ana", v.ID, songs("A"), false))
	if _, err := s.Add("luis", v.ID, songs("B"), false); !errors.Is(err, ErrNotMember) {
		t.Errorf("adding before joining: %v", err)
	}
	s.Join("luis", v.ID)
	v = ok(t)(s.Add("luis", v.ID, songs("B", "C"), false))
	if v.Queue[1].AddedBy != "luis" {
		t.Errorf("added by %q", v.Queue[1].AddedBy)
	}
	for _, action := range []string{"pause", "next", "seek"} {
		if _, err := s.Control("luis", v.ID, action, 0, ""); !errors.Is(err, ErrNotAllowed) {
			t.Errorf("guest %s: %v", action, err)
		}
	}
	if _, err := s.Remove("luis", v.ID, v.Queue[0].ID); !errors.Is(err, ErrNotAllowed) {
		t.Errorf("guest removing the host's song: %v", err)
	}
	v = ok(t)(s.Remove("luis", v.ID, v.Queue[2].ID))
	if titles(v) != "*A,B" {
		t.Errorf("after luis took out his C: %s", titles(v))
	}
	if _, err := s.Configure("luis", v.ID, Settings{GuestControl: true}); !errors.Is(err, ErrNotAllowed) {
		t.Errorf("a guest changing settings: %v", err)
	}
	ok(t)(s.Configure("ana", v.ID, Settings{Name: "Ours", Public: true, GuestControl: true}))
	v = ok(t)(s.Control("luis", v.ID, "next", 0, ""))
	if titles(v) != "A,*B" || !v.CanControl {
		t.Errorf("guest skipping with control: %s", titles(v))
	}
}

// The server keeps the time: a song plays on from where it was, a pause holds it, and when it ends the next one starts
// at the moment it ended, however late the tick that notices.
func TestTheJamKeepsTheTime(t *testing.T) {
	s, c := newStore()
	v, _, _ := s.Create("ana", Settings{})
	s.Connect("ana", v.ID) // someone listens, or an hour of pause would end it
	v = ok(t)(s.Add("ana", v.ID, songs("A", "B", "C"), false))
	if v.Playback.Entry != v.Queue[0].ID || v.Playback.Paused || v.Playback.At != c.now.UnixMilli() {
		t.Fatalf("adding to an empty jam starts it: %+v", v.Playback)
	}
	c.add(30 * time.Second)
	v = ok(t)(s.Control("ana", v.ID, "pause", 0, ""))
	if v.Playback.Position != 30 || !v.Playback.Paused {
		t.Errorf("paused at %v", v.Playback.Position)
	}
	c.add(time.Hour)
	if changed, _ := s.Tick(); len(changed) != 0 {
		t.Error("a paused song moved on")
	}
	v = ok(t)(s.Control("ana", v.ID, "play", 0, ""))
	resumed := c.now
	// A goes on from 30 s; 70 s later it ends, and the tick comes 2.5 s after that
	c.add(72500 * time.Millisecond)
	changed, _ := s.Tick()
	v, _ = s.View("ana", v.ID)
	if len(changed) != 1 || titles(v) != "A,*B,C" {
		t.Fatalf("after A ended: %v %s", changed, titles(v))
	}
	if want := resumed.Add(70 * time.Second).UnixMilli(); v.Playback.At != want || v.Playback.Position != 0 {
		t.Errorf("B started at %d, want %d (when A ended)", v.Playback.At, want)
	}
	// Two songs over while nobody looked: both pass, and the queue ends
	c.add(300 * time.Second)
	s.Tick()
	v, _ = s.View("ana", v.ID)
	if v.Playback.Entry != "" || v.Current != 3 {
		t.Errorf("after the queue ran out: %+v current %d", v.Playback, v.Current)
	}
	// Adding to an ended Jam plays the new song
	v = ok(t)(s.Add("ana", v.ID, songs("D"), false))
	if titles(v) != "A,B,C,*D" || v.Playback.Paused {
		t.Errorf("adding after the end: %s", titles(v))
	}
}

// "Play next" goes right after what plays, after the songs added that way before; moving only reorders what is to come.
func TestTheQueueKeepsItsOrder(t *testing.T) {
	s, c := newStore()
	v, _, _ := s.Create("ana", Settings{})
	v = ok(t)(s.Add("ana", v.ID, songs("A", "B", "C"), false))
	v = ok(t)(s.Add("ana", v.ID, songs("N1"), true))
	v = ok(t)(s.Add("ana", v.ID, songs("N2"), true))
	if titles(v) != "*A,N1,N2,B,C" {
		t.Errorf("play next: %s", titles(v))
	}
	v = ok(t)(s.Move("ana", v.ID, v.Queue[4].ID, 1))
	if titles(v) != "*A,C,N1,N2,B" {
		t.Errorf("moved C up: %s", titles(v))
	}
	if _, err := s.Move("ana", v.ID, v.Queue[0].ID, 3); !errors.Is(err, ErrNoEntry) {
		t.Errorf("moving what plays: %v", err)
	}
	// Previous restarts a song heard for a while, else goes back one
	c.add(10 * time.Second)
	v = ok(t)(s.Control("ana", v.ID, "jump", 0, v.Queue[2].ID))
	c.add(10 * time.Second)
	v = ok(t)(s.Control("ana", v.ID, "previous", 0, ""))
	if titles(v) != "A,C,*N1,N2,B" || v.Playback.Position != 0 {
		t.Errorf("previous after 10 s: %s", titles(v))
	}
	v = ok(t)(s.Control("ana", v.ID, "previous", 0, ""))
	if titles(v) != "A,*C,N1,N2,B" {
		t.Errorf("previous at the start: %s", titles(v))
	}
	// Taking out what plays plays what came after it
	v = ok(t)(s.Remove("ana", v.ID, v.Queue[1].ID))
	if titles(v) != "A,*N1,N2,B" {
		t.Errorf("removed what played: %s", titles(v))
	}
	if _, err := s.Add("ana", v.ID, make([]Song, MaxQueue), false); !errors.Is(err, ErrFull) {
		t.Errorf("past the limit: %v", err)
	}
}

// A Jam nobody is connected to ends after Idle; one with someone listening stays.
func TestAQuietJamEnds(t *testing.T) {
	s, c := newStore()
	quiet, _, _ := s.Create("ana", Settings{})
	busy, _, _ := s.Create("luis", Settings{})
	release, err := s.Connect("luis", busy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Connect("ana", busy.ID); !errors.Is(err, ErrNoJam) {
		t.Errorf("connecting to someone else's private jam: %v", err)
	}
	c.add(Idle + time.Second)
	_, ended := s.Tick()
	if len(ended) != 1 || ended[quiet.ID] == nil {
		t.Fatalf("ended: %v", ended)
	}
	release()
	c.add(Idle - time.Second)
	if _, ended := s.Tick(); len(ended) != 0 {
		t.Error("ended before Idle passed since the last stream closed")
	}
	c.add(2 * time.Second)
	if _, ended := s.Tick(); ended[busy.ID] == nil {
		t.Error("still there after Idle with nobody connected")
	}
}

func TestNames(t *testing.T) {
	s, _ := newStore()
	if _, _, err := s.Create("ana", Settings{Name: strings.Repeat("x", MaxName+1)}); !errors.Is(err, ErrBadName) {
		t.Errorf("long name: %v", err)
	}
	if _, _, err := s.Create("ana", Settings{Name: "a\nb"}); !errors.Is(err, ErrBadName) {
		t.Errorf("control character: %v", err)
	}
	if !ValidID("0123456789ab") || ValidID("../etc") || ValidID("0123456789abc") {
		t.Error("ValidID")
	}
}
