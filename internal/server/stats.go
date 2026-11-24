package server

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // the slim image may have no time zones, and days are counted in the person's own

	"github.com/Thrashy190/eco/internal/stats"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// Statistics: what people play on this server. Navidrome only tells each person their own play counts, so Eco counts
// plays as they pass through it: every app that signs in here (the web app, the TV, any Subsonic app pointed at Eco)
// reports a play with /rest/scrobble, which Eco hands to Navidrome as before and also writes down (internal/stats).
// Apps that talk to Navidrome directly are not seen. A person who turns off "Count my plays" sends no scrobbles, so
// nothing of theirs is counted.
//
// Everyone can see their own numbers. Only an administrator sees everyone's, which is the point of the page: who listens
// to what on the server. The check is made on every request, never from what the app shows.

// scrobbleBody is how much of Navidrome's answer to a scrobble is read to know it was accepted. It is a few dozen bytes.
const scrobbleBody = 4 << 10

// answerCopy passes Navidrome's answer on and keeps its beginning, to know whether the scrobble was accepted.
type answerCopy struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (a *answerCopy) WriteHeader(code int) {
	a.status = code
	a.ResponseWriter.WriteHeader(code)
}

func (a *answerCopy) Write(p []byte) (int, error) {
	if a.status == 0 {
		a.status = http.StatusOK
	}
	if room := scrobbleBody - a.body.Len(); room > 0 {
		a.body.Write(p[:min(len(p), room)])
	}
	return a.ResponseWriter.Write(p)
}

// accepted reports whether Navidrome took the scrobble, in JSON or XML. A wrong password is also HTTP 200, with an error.
func accepted(status int, body []byte) bool {
	if status != http.StatusOK {
		return false
	}
	b := bytes.ReplaceAll(body, []byte(" "), nil)
	return bytes.Contains(b, []byte(`"status":"ok"`)) || bytes.Contains(b, []byte(`status="ok"`))
}

// scrobble hands a play to Navidrome and, once Navidrome has accepted it (which also proves who sent it), counts it.
func (s *Server) scrobble(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cred, signed := subsonic.FromQuery(q)
	play := signed && !strings.EqualFold(q.Get("submission"), "false") // "now playing" is not a play
	if play && !s.stats.Imported(cred.User) {
		// Once per person, before Navidrome counts this play: then the history holds what came before, and this play
		// keeps its date. A wrong password imports nothing, since Navidrome refuses to list the songs.
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		s.importHistory(ctx, cred)
		cancel()
	}
	r.Header.Del("Accept-Encoding") // the answer must arrive readable; it is tiny anyway
	answer := &answerCopy{ResponseWriter: w}
	s.proxy.ServeHTTP(answer, r)
	if !play || !accepted(answer.status, answer.body.Bytes()) {
		return
	}
	ids := q["id"]
	times := q["time"]
	now := time.Now()
	var plays []pendingPlay
	for i, id := range ids[:min(len(ids), 50)] {
		at := now
		if i < len(times) { // apps that were offline send when each song was played, in milliseconds
			if ms, err := strconv.ParseInt(times[i], 10, 64); err == nil {
				if t := time.UnixMilli(ms); t.Before(now.Add(time.Minute)) && now.Sub(t) < 30*24*time.Hour {
					at = t
				}
			}
		}
		plays = append(plays, pendingPlay{id, at})
	}
	go s.countPlays(cred, plays)
}

type pendingPlay struct {
	id string
	at time.Time
}

// countPlays writes plays down with what the statistics need about each song. If the history could not be imported
// before, it is tried again; these plays are then part of it.
func (s *Server) countPlays(cred subsonic.Cred, plays []pendingPlay) {
	ctx, cancel := context.WithTimeout(s.ctx, 2*time.Minute)
	defer cancel()
	s.importHistory(ctx, cred)
	for _, p := range plays {
		song, err := s.nd.Song(ctx, cred, p.id)
		if err != nil {
			continue // not a song of the library: nothing to say about it
		}
		if _, err := s.stats.Add(playOf(cred.User, song, p.at)); err != nil {
			log.Printf("counting a play: %v", err)
		}
	}
}

// songArtists lists who a song credits: Navidrome's list when it sends one, or the artist shown, separated.
func songArtists(song subsonic.Song) []string {
	var out []string
	for _, a := range song.Participants {
		if a.Name != "" {
			out = append(out, a.Name)
		}
	}
	if len(out) > 0 {
		return out
	}
	for _, part := range strings.Split(strings.ReplaceAll(song.Artist, " • ", "; "), "; ") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func playOf(user string, song subsonic.Song, at time.Time) stats.Play {
	return stats.Play{
		At: at, User: user, SongID: song.ID, Title: song.Title, Artists: songArtists(song), Album: song.Album, AlbumID: song.AlbumID,
		Cover: song.CoverArt, Genres: song.GenreList(), Duration: song.Duration,
	}
}

// importHistory reads, once per person, what they played before Eco counted: Navidrome keeps a count per song and the
// time of the last play, which only that person can read. Plays Eco counted before it are part of it (stats.Store.Import).
func (s *Server) importHistory(ctx context.Context, cred subsonic.Cred) {
	if s.stats.Imported(cred.User) {
		return
	}
	lock := s.importing(cred.User)
	lock.Lock()
	defer lock.Unlock()
	if s.stats.Imported(cred.User) {
		return
	}
	at := time.Now()
	songs, err := s.nd.AllSongs(ctx, cred)
	if err != nil {
		log.Printf("reading the play history of %s: %v", cred.User, err)
		return // the next play tries again; plays counted until then are left out once the history is in
	}
	var history []stats.Play
	for _, song := range songs {
		if song.PlayCount <= 0 {
			continue
		}
		last, _ := time.Parse(time.RFC3339, song.Played)
		p := playOf(cred.User, song, last)
		p.Count = int(min(song.PlayCount, 1<<30))
		history = append(history, p)
	}
	if err := s.stats.Import(cred.User, at, history); err != nil {
		log.Printf("saving the play history of %s: %v", cred.User, err)
		return
	}
	log.Printf("imported the play history of %s: %d songs", cred.User, len(history))
}

// importing gives each person's history import a lock of its own, so two plays at once do not import it twice.
func (s *Server) importing(user string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.imports == nil {
		s.imports = map[string]*sync.Mutex{}
	}
	k := strings.ToLower(user)
	if s.imports[k] == nil {
		s.imports[k] = &sync.Mutex{}
	}
	return s.imports[k]
}

// statsRanges are the periods the page offers.
var statsRanges = map[string]time.Duration{"7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "90d": 90 * 24 * time.Hour, "365d": 365 * 24 * time.Hour, "all": 0}

// libraryStats describes the library itself: the same for everyone.
type libraryStats struct {
	Songs     int            `json:"songs"`
	Albums    int            `json:"albums"`
	Artists   int            `json:"artists"`
	Hours     int            `json:"hours"`
	WithGenre int            `json:"with_genre"` // songs with at least one genre
	Genres    []stats.Ranked `json:"genres"`     // the genres with most songs; Plays holds the number of songs
}

func describeLibrary(songs []subsonic.Song) libraryStats {
	out := libraryStats{Songs: len(songs), Genres: []stats.Ranked{}}
	albums, artists, genres := map[string]bool{}, map[string]bool{}, map[string]*stats.Ranked{}
	seconds := 0
	for _, song := range songs {
		seconds += song.Duration
		albums[song.AlbumID] = true
		for _, a := range songArtists(song) {
			artists[strings.ToLower(a)] = true
		}
		list := song.GenreList()
		if len(list) > 0 {
			out.WithGenre++
		}
		for _, g := range list {
			k := strings.ToLower(g)
			if genres[k] == nil {
				genres[k] = &stats.Ranked{Name: g}
			}
			genres[k].Plays++
			genres[k].Minutes += song.Duration / 60
		}
	}
	out.Albums, out.Artists, out.Hours = len(albums), len(artists), seconds/3600
	for _, g := range genres {
		out.Genres = append(out.Genres, *g)
	}
	sort.Slice(out.Genres, func(i, j int) bool {
		if out.Genres[i].Plays != out.Genres[j].Plays {
			return out.Genres[i].Plays > out.Genres[j].Plays
		}
		return out.Genres[i].Name < out.Genres[j].Name
	})
	out.Genres = out.Genres[:min(len(out.Genres), 12)]
	return out
}

// statsSummary answers GET /api/stats?range=30d&user=&tz=America/Mexico_City. An administrator may ask about anyone,
// or everyone (no user); anyone else only ever gets their own numbers, whatever they ask for.
func (s *Server) statsSummary(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := r.URL.Query()
	period, ok := statsRanges[q.Get("range")]
	if !ok {
		period = statsRanges["30d"]
	}
	loc, err := time.LoadLocation(q.Get("tz"))
	if err != nil || q.Get("tz") == "" {
		loc = time.Local
	}
	admin, err := s.nd.IsAdmin(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	user := cred.User
	if admin {
		user = q.Get("user")
	}
	plays, imported, err := s.stats.Snapshot()
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := time.Now()
	query := stats.Query{User: user, Loc: loc, Now: now, Top: 10}
	if period > 0 {
		query.From = now.Add(-period)
	}
	sum := stats.Summarize(plays, imported, query)
	out := map[string]any{"admin": admin, "user": user, "range": q.Get("range"), "summary": sum}
	if admin {
		// Everyone who has played something, for choosing whose numbers to see
		seen := map[string]string{}
		for _, p := range plays {
			if k := strings.ToLower(p.User); seen[k] == "" {
				seen[k] = p.User
			}
		}
		people := make([]string, 0, len(seen))
		for _, name := range seen {
			people = append(people, name)
		}
		sort.Slice(people, func(i, j int) bool { return strings.ToLower(people[i]) < strings.ToLower(people[j]) })
		out["people"] = people
	}
	if lib, err := s.library(r.Context(), cred); err == nil {
		out["library"] = describeLibrary(lib.songs)
	}
	respond(w, http.StatusOK, out)
}
