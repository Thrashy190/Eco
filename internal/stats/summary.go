package stats

import (
	"sort"
	"strings"
	"time"
)

// Query says what a summary covers.
type Query struct {
	// From and To bound the plays (To excluded). A zero From means since the beginning, and only then does imported
	// history count, since its plays have no dates. A zero To means until now.
	From, To time.Time
	// User limits the summary to one person; empty is everyone.
	User string
	// Loc is the time zone days and hours are counted in.
	Loc *time.Location
	// Top is how long each ranking is.
	Top int
	// Now is the end of a range with no To. Zero means time.Now().
	Now time.Time

	alone bool // the summary of the time before, which is not compared with what came before it
}

// Totals are the headline numbers.
type Totals struct {
	Plays     int `json:"plays"`
	Minutes   int `json:"minutes"` // songs' lengths added up: Eco knows a play counted, not how much of it was heard
	Songs     int `json:"songs"`   // different songs
	Artists   int `json:"artists"`
	Albums    int `json:"albums"`
	Genres    int `json:"genres"`
	Listeners int `json:"listeners"`
	// FirstListens counts songs someone played for the first time.
	FirstListens int `json:"first_listens"`
	// ActiveDays counts days with at least one play.
	ActiveDays int `json:"active_days"`
	// NoGenre counts plays of songs with no genre.
	NoGenre int `json:"no_genre"`
}

// Ranked is one line of a ranking: a song, an artist, an album or a genre.
type Ranked struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	Artist    string `json:"artist,omitempty"`
	Cover     string `json:"cover,omitempty"`
	Plays     int    `json:"plays"`
	Minutes   int    `json:"minutes"`
	Listeners int    `json:"listeners"`
}

// Bucket is the plays of one day, week or month.
type Bucket struct {
	Start   string `json:"start"` // its first day, 2006-01-02
	Plays   int    `json:"plays"`
	Minutes int    `json:"minutes"`
}

// Listener is what one person played.
type Listener struct {
	User      string    `json:"user"`
	Plays     int       `json:"plays"`
	Minutes   int       `json:"minutes"`
	Songs     int       `json:"songs"`
	TopSong   string    `json:"top_song,omitempty"`
	TopArtist string    `json:"top_artist,omitempty"`
	TopGenre  string    `json:"top_genre,omitempty"`
	Last      time.Time `json:"last"`
}

// Recent is a play from the latest ones.
type Recent struct {
	At     time.Time `json:"at"`
	User   string    `json:"user"`
	ID     string    `json:"id"`
	Title  string    `json:"title"`
	Artist string    `json:"artist"`
	Cover  string    `json:"cover,omitempty"`
}

// Summary is everything the statistics page shows.
type Summary struct {
	Totals Totals `json:"totals"`
	// Previous are the totals of the same length of time just before, for comparing. Only for a range with a start.
	Previous *Totals `json:"previous,omitempty"`
	// Step is how long each bucket of Timeline is: "day", "week" or "month".
	Step     string   `json:"step"`
	Timeline []Bucket `json:"timeline"`
	Hours    [24]int  `json:"hours"`
	Weekdays [7]int   `json:"weekdays"` // Monday first
	Songs    []Ranked `json:"songs"`
	Artists  []Ranked `json:"artists"`
	Albums   []Ranked `json:"albums"`
	Genres   []Ranked `json:"genres"`
	// Listeners is set when the summary is about everyone.
	Listeners []Listener `json:"listeners,omitempty"`
	Recent    []Recent   `json:"recent"`
	// Since is the first play Eco counted itself, in or out of the range. Zero when there is none.
	Since *time.Time `json:"since,omitempty"`
	// WithHistory says imported history is part of the numbers.
	WithHistory bool `json:"with_history"`
}

// Artist is how a play's artists are shown together.
func (p Play) Artist() string { return strings.Join(p.Artists, ", ") }

// counts reports whether a play of the filtered person counts at all: a play Eco counted before that person's history
// was imported is already in the history.
func counts(p Play, user string, imported map[string]time.Time) bool {
	if user != "" && key(p.User) != key(user) {
		return false
	}
	if at, ok := imported[key(p.User)]; ok && !p.Imported && p.At.Before(at) {
		return false
	}
	return true
}

func inRange(p Play, from, to time.Time) bool {
	if p.Imported {
		return from.IsZero()
	}
	return !p.At.Before(from) && (to.IsZero() || p.At.Before(to))
}

// tally adds up plays and minutes of anything ranked.
type tally struct {
	Ranked
	seconds int
	users   map[string]bool
	songs   map[string]int // for artists and albums: plays of each song, to pick a cover
	covers  map[string]string
}

func (t *tally) add(p Play) {
	n := p.times()
	t.Plays += n
	t.seconds += p.Duration * n
	if t.users == nil {
		t.users = map[string]bool{}
	}
	t.users[key(p.User)] = true
	if p.Cover != "" {
		if t.songs == nil {
			t.songs, t.covers = map[string]int{}, map[string]string{}
		}
		t.songs[p.SongID] += n
		t.covers[p.SongID] = p.Cover
	}
}

func (t *tally) done() Ranked {
	r := t.Ranked
	r.Minutes = t.seconds / 60
	r.Listeners = len(t.users)
	if r.Cover == "" {
		best := -1
		for song, n := range t.songs {
			if n > best || (n == best && song < r.ID) {
				best, r.Cover = n, t.covers[song]
			}
		}
	}
	return r
}

type tallies map[string]*tally

func (ts tallies) get(k string, start func() Ranked) *tally {
	t, ok := ts[k]
	if !ok {
		t = &tally{Ranked: start()}
		ts[k] = t
	}
	return t
}

// ranked orders the most played first, then the most minutes, then by name.
func (ts tallies) ranked(top int) []Ranked {
	out := make([]Ranked, 0, len(ts))
	for _, t := range ts {
		out = append(out, t.done())
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Plays != b.Plays {
			return a.Plays > b.Plays
		}
		if a.Minutes != b.Minutes {
			return a.Minutes > b.Minutes
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	if top > 0 && len(out) > top {
		out = out[:top]
	}
	return out
}

func first(r []Ranked) string {
	if len(r) == 0 {
		return ""
	}
	return r[0].Name
}

// rankings counts the songs, artists, albums and genres of some plays.
type rankings struct {
	songs, artists, albums, genres tallies
	seconds, plays, noGenre        int
}

func newRankings() *rankings {
	return &rankings{songs: tallies{}, artists: tallies{}, albums: tallies{}, genres: tallies{}}
}

func (r *rankings) add(p Play) {
	n := p.times()
	r.plays += n
	r.seconds += p.Duration * n
	r.songs.get(p.SongID, func() Ranked { return Ranked{ID: p.SongID, Name: p.Title, Artist: p.Artist(), Cover: p.Cover} }).add(p)
	seen := map[string]bool{}
	for _, name := range p.Artists {
		k := strings.ToLower(strings.TrimSpace(name))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		r.artists.get(k, func() Ranked { return Ranked{Name: name} }).add(p)
	}
	if p.Album != "" {
		k := p.AlbumID
		if k == "" {
			k = strings.ToLower(p.Album + "|" + p.Artist())
		}
		r.albums.get(k, func() Ranked { return Ranked{ID: p.AlbumID, Name: p.Album, Artist: p.Artist(), Cover: p.Cover} }).add(p)
	}
	if len(p.Genres) == 0 {
		r.noGenre += n
	}
	seen = map[string]bool{}
	for _, name := range p.Genres {
		k := strings.ToLower(strings.TrimSpace(name))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		r.genres.get(k, func() Ranked { return Ranked{Name: name} }).add(p)
	}
}

// Summarize sums up the plays a query covers.
func Summarize(plays []Play, imported map[string]time.Time, q Query) Summary {
	loc := q.Loc
	if loc == nil {
		loc = time.Local
	}
	now := q.Now
	if now.IsZero() {
		now = time.Now()
	}
	to := q.To
	if to.IsZero() {
		to = now
	}
	everyone := q.User == ""

	// The first time each person played each song, to tell first listens apart
	firstPlay := map[string]time.Time{}
	var since time.Time
	for _, p := range plays {
		if !counts(p, q.User, imported) {
			continue
		}
		if !p.Imported && (since.IsZero() || p.At.Before(since)) {
			since = p.At
		}
		k := key(p.User) + "|" + p.SongID
		at := p.At
		if p.Imported {
			at = time.Time{} // before anything Eco counted
		}
		if prev, ok := firstPlay[k]; !ok || at.Before(prev) {
			firstPlay[k] = at
		}
	}

	sum := Summary{Recent: []Recent{}, WithHistory: q.From.IsZero()}
	if !since.IsZero() {
		sum.Since = &since
	}
	var firstInRange time.Time
	all := newRankings()
	users := map[string]*rankings{}
	names := map[string]string{} // lower-case → as written
	last := map[string]time.Time{}
	days := map[string]bool{}
	firsts := map[string]bool{}
	var recent []Play
	for _, p := range plays {
		if !counts(p, q.User, imported) || !inRange(p, q.From, q.To) {
			continue
		}
		u := key(p.User)
		if names[u] == "" {
			names[u] = p.User
		}
		all.add(p)
		if users[u] == nil {
			users[u] = newRankings()
		}
		users[u].add(p)
		if p.At.After(last[u]) {
			last[u] = p.At
		}
		if p.Imported {
			continue
		}
		local := p.At.In(loc)
		days[local.Format(time.DateOnly)] = true
		sum.Hours[local.Hour()]++
		sum.Weekdays[(int(local.Weekday())+6)%7]++
		if firstInRange.IsZero() || p.At.Before(firstInRange) {
			firstInRange = p.At
		}
		k := u + "|" + p.SongID
		if firstPlay[k].Equal(p.At) {
			firsts[k] = true
		}
		recent = append(recent, p)
	}

	sum.Totals = Totals{
		Plays: all.plays, Minutes: all.seconds / 60, Songs: len(all.songs), Artists: len(all.artists), Albums: len(all.albums), Genres: len(all.genres),
		Listeners: len(users), FirstListens: len(firsts), ActiveDays: len(days), NoGenre: all.noGenre,
	}
	top := q.Top
	if top <= 0 {
		top = 10
	}
	sum.Songs, sum.Artists, sum.Albums, sum.Genres = all.songs.ranked(top), all.artists.ranked(top), all.albums.ranked(top), all.genres.ranked(top)

	if everyone {
		for u, r := range users {
			sum.Listeners = append(sum.Listeners, Listener{
				User: names[u], Plays: r.plays, Minutes: r.seconds / 60, Songs: len(r.songs),
				TopSong: first(r.songs.ranked(1)), TopArtist: first(r.artists.ranked(1)), TopGenre: first(r.genres.ranked(1)), Last: last[u],
			})
		}
		sort.Slice(sum.Listeners, func(i, j int) bool {
			a, b := sum.Listeners[i], sum.Listeners[j]
			if a.Minutes != b.Minutes {
				return a.Minutes > b.Minutes
			}
			return key(a.User) < key(b.User)
		})
	}

	sort.SliceStable(recent, func(i, j int) bool { return recent[i].At.After(recent[j].At) })
	for _, p := range recent[:min(len(recent), 20)] {
		sum.Recent = append(sum.Recent, Recent{At: p.At, User: p.User, ID: p.SongID, Title: p.Title, Artist: p.Artist(), Cover: p.Cover})
	}

	start := q.From
	if start.IsZero() {
		start = firstInRange
	}
	sum.Step, sum.Timeline = timeline(recent, start, to, loc)

	if !q.From.IsZero() && !q.alone {
		length := to.Sub(q.From)
		prev := Summarize(plays, imported, Query{From: q.From.Add(-length), To: q.From, User: q.User, Loc: loc, Top: 1, Now: now, alone: true})
		sum.Previous = &prev.Totals
	}
	return sum
}

// timeline puts plays in days, weeks or months, from start to end, with the empty ones too: a chart with gaps left out
// would show a quiet week as no time at all.
func timeline(plays []Play, start, end time.Time, loc *time.Location) (string, []Bucket) {
	if start.IsZero() || !start.Before(end) {
		return "day", []Bucket{}
	}
	start, end = start.In(loc), end.In(loc)
	span := end.Sub(start)
	step := "day"
	switch {
	case span > 400*24*time.Hour:
		step = "month"
	case span > 62*24*time.Hour:
		step = "week"
	}
	floor := func(t time.Time) time.Time {
		t = t.In(loc)
		day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
		switch step {
		case "week":
			return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
		case "month":
			return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, loc)
		}
		return day
	}
	next := func(t time.Time) time.Time {
		switch step {
		case "week":
			return t.AddDate(0, 0, 7)
		case "month":
			return t.AddDate(0, 1, 0)
		}
		return t.AddDate(0, 0, 1)
	}
	index := map[string]int{}
	var out []Bucket
	for t := floor(start); t.Before(end); t = next(t) {
		index[t.Format(time.DateOnly)] = len(out)
		out = append(out, Bucket{Start: t.Format(time.DateOnly)})
	}
	seconds := make([]int, len(out))
	for _, p := range plays {
		i, ok := index[floor(p.At).Format(time.DateOnly)]
		if !ok {
			continue
		}
		out[i].Plays += p.times()
		seconds[i] += p.Duration * p.times()
	}
	for i := range out {
		out[i].Minutes = seconds[i] / 60
	}
	return step, out
}

// SongPlays counts how many times each song was played on this server: everyone's plays, all time, imported history
// included, by song ID. Artist pages order their popular songs with it.
func SongPlays(plays []Play, imported map[string]time.Time) map[string]int {
	out := map[string]int{}
	for _, p := range plays {
		if counts(p, "", imported) {
			out[p.SongID] += p.times()
		}
	}
	return out
}
