// Package jam lets people on one server listen together: a Jam is a shared queue that everyone in it hears at the same
// moment, each on their own device, and anyone in it can add to. One person starts it (the host) and chooses whether it
// is public, so anyone on the server can see and join it, or private, so only the people they invite can. The host also
// chooses whether the others may pause, skip and change the queue, or only add songs and take out their own.
//
// The server keeps the time: what plays, from which position, since when (Playback), and moves on to the next song
// when one ends (Tick), so the music never depends on whoever started it keeping their app open. Devices only follow.
//
// A Jam is a deliberate exception to accounts not seeing each other: its members see each other's names and who added
// each song, and nothing else. It lives in memory and ends when the host leaves, when the server stops, or after Idle
// with nobody connected.
package jam

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	// MaxQueue is the most songs a Jam holds, played ones included.
	MaxQueue = 1000
	// MaxAdd is the most songs added at once.
	MaxAdd = 500
	// keepPlayed is how many played songs stay before the one playing, for going back.
	keepPlayed = 50
	// Idle is how long a Jam lasts with nobody connected to it.
	Idle = 10 * time.Minute
	// maxJams keeps one server from growing without end.
	maxJams = 64
	// MaxName is the longest name of a Jam, in characters.
	MaxName = 60
	// restartAfter is how far into a song "previous" goes back to its start instead of the song before.
	restartAfter = 3.0
)

var (
	// ErrNoJam is a Jam that does not exist or that this person may not see: the same answer for both.
	ErrNoJam = errors.New("no such jam")
	// ErrNotMember is someone who must join before doing that.
	ErrNotMember = errors.New("join the jam first")
	// ErrNotAllowed is something only the host may do, or the host has kept for themselves.
	ErrNotAllowed = errors.New("only the host can do that in this jam")
	// ErrNoEntry is a song no longer in the Jam.
	ErrNoEntry = errors.New("that song is no longer in the jam")
	// ErrFull is a Jam's queue at MaxQueue.
	ErrFull = errors.New("the jam's queue is full")
	// ErrTooMany is a server with maxJams Jams already.
	ErrTooMany = errors.New("too many jams on this server right now")
	// ErrBadName is a name too long or with characters that are not text.
	ErrBadName = errors.New("the name must be at most 60 characters of text")
	// ErrBadAction is a control the Jam does not know.
	ErrBadAction = errors.New("unknown action")
)

// Song is a song of the library as the Jam shows it. Its details travel with it, so the queue reads well on every device.
type Song struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist,omitempty"`
	ArtistID string  `json:"artistId,omitempty"`
	Album    string  `json:"album,omitempty"`
	AlbumID  string  `json:"albumId,omitempty"`
	Cover    string  `json:"cover,omitempty"`
	Duration float64 `json:"duration"` // seconds; the Jam moves on when it is over
}

// Entry is one place in the queue: a song and who added it. The same song can be in the queue twice.
type Entry struct {
	ID      string `json:"id"`
	Song    Song   `json:"song"`
	AddedBy string `json:"added_by"`
	next    bool   // added with "play next": later ones go after it
}

// Playback says what plays: the entry, how far into it, and when that was true on the server's clock. A device plays
// Position + (now − At), with now on the server's clock.
type Playback struct {
	Entry    string  `json:"entry"` // empty when nothing is left to play
	Position float64 `json:"position"`
	At       int64   `json:"at"` // Unix milliseconds
	Paused   bool    `json:"paused"`
}

// Settings are what the host chooses.
type Settings struct {
	Name         string `json:"name"`
	Public       bool   `json:"public"`
	GuestControl bool   `json:"guest_control"` // everyone may pause, skip and change the queue, not only the host
}

// View is a Jam as one person sees it.
type View struct {
	ID string `json:"id"`
	Settings
	Host    string   `json:"host"`
	Members []string `json:"members"` // the host first, then in the order they joined
	Invited []string `json:"invited"` // only the host sees who was invited
	Queue   []Entry  `json:"queue"`
	// Current is the place in Queue of what plays; len(Queue) once the queue has ended.
	Current    int      `json:"current"`
	Playback   Playback `json:"playback"`
	Member     bool     `json:"member"`
	CanControl bool     `json:"can_control"`
	Rev        int      `json:"rev"`        // grows with every change
	ServerNow  int64    `json:"server_now"` // the server's clock when this was made, Unix milliseconds
}

// Summary is a Jam in the list of Jams someone may join.
type Summary struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Host    string   `json:"host"`
	Public  bool     `json:"public"`
	Members []string `json:"members"`
	Playing *Song    `json:"playing,omitempty"`
	Member  bool     `json:"member"`
	Invited bool     `json:"invited"`
}

type jam struct {
	Settings
	id        string
	host      string
	invited   map[string]bool // lowercase
	members   []string        // as they signed in, the host first
	queue     []Entry
	current   int
	playback  Playback
	entries   int            // entry IDs made so far
	streams   map[string]int // lowercase member → open streams
	quietFrom time.Time      // when the last stream closed
	rev       int
}

// Store holds every Jam of the server.
type Store struct {
	mu     sync.Mutex
	jams   map[string]*jam
	member map[string]string // lowercase user → the Jam they are in; one at a time
	// Now is the server's clock; tests set their own.
	Now func() time.Time
}

// New returns a Store with no Jams.
func New() *Store {
	return &Store{jams: map[string]*jam{}, member: map[string]string{}, Now: time.Now}
}

func key(user string) string { return strings.ToLower(user) }

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ValidID reports whether id could be a Jam's.
func ValidID(id string) bool {
	if len(id) != 12 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

func cleanName(name, host string) (string, error) {
	name = strings.TrimSpace(name)
	if len([]rune(name)) > MaxName || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return "", ErrBadName
	}
	if name == "" {
		name = host + "'s Jam"
	}
	return name, nil
}

func (j *jam) isMember(user string) bool {
	for _, m := range j.members {
		if key(m) == key(user) {
			return true
		}
	}
	return false
}

func (j *jam) isHost(user string) bool { return key(j.host) == key(user) }

func (j *jam) visibleTo(user string) bool {
	return j.Public || j.isHost(user) || j.invited[key(user)] || j.isMember(user)
}

func (j *jam) canControl(user string) bool {
	return j.isHost(user) || (j.GuestControl && j.isMember(user))
}

func (j *jam) entryAt(id string) int {
	for i, e := range j.queue {
		if e.ID == id {
			return i
		}
	}
	return -1
}

// position is how far into the song playback is at now.
func (j *jam) position(now time.Time) float64 {
	p := j.playback
	if p.Entry == "" || p.Paused {
		return p.Position
	}
	return p.Position + float64(now.UnixMilli()-p.At)/1000
}

func (j *jam) playFrom(i int, position float64, at time.Time) {
	j.current = i
	if i >= len(j.queue) {
		j.current, j.playback = len(j.queue), Playback{At: at.UnixMilli()}
		return
	}
	j.playback = Playback{Entry: j.queue[i].ID, Position: position, At: at.UnixMilli()}
}

// forget keeps only keepPlayed played songs.
func (j *jam) forget() {
	if extra := j.current - keepPlayed; extra > 0 {
		j.queue = append([]Entry(nil), j.queue[extra:]...)
		j.current -= extra
	}
}

func (j *jam) view(user string, now time.Time) View {
	v := View{
		ID: j.id, Settings: j.Settings, Host: j.host, Members: append([]string{}, j.members...), Invited: []string{},
		Queue: append([]Entry{}, j.queue...), Current: j.current, Playback: j.playback, // [] rather than null for the app
		Member: j.isMember(user), CanControl: j.canControl(user), Rev: j.rev, ServerNow: now.UnixMilli(),
	}
	if j.isHost(user) {
		for name := range j.invited {
			v.Invited = append(v.Invited, name)
		}
		sort.Strings(v.Invited)
	}
	return v
}

// find returns a Jam this person may see.
func (s *Store) find(user, id string) (*jam, error) {
	j := s.jams[id]
	if j == nil || !j.visibleTo(user) {
		return nil, ErrNoJam
	}
	return j, nil
}

// changed counts a change of the Jam.
func (j *jam) changed() { j.rev++ }

// leave takes someone out of the Jam they are in, ending it if they host it. It returns the Jam they left and whether it
// ended; s.mu must be held.
func (s *Store) leave(user string) (left string, ended bool) {
	id, ok := s.member[key(user)]
	if !ok {
		return "", false
	}
	delete(s.member, key(user))
	j := s.jams[id]
	if j == nil {
		return id, true
	}
	if j.isHost(user) {
		s.end(j)
		return id, true
	}
	for i, m := range j.members {
		if key(m) == key(user) {
			j.members = append(j.members[:i:i], j.members[i+1:]...)
			break
		}
	}
	delete(j.streams, key(user))
	j.changed()
	return id, false
}

func (s *Store) end(j *jam) {
	for _, m := range j.members {
		if s.member[key(m)] == j.id {
			delete(s.member, key(m))
		}
	}
	delete(s.jams, j.id)
}

// Change says what an action did beyond the Jam itself: the Jam someone left on the way, and whether that one ended.
type Change struct {
	Left  string
	Ended bool
}

// Create starts a Jam hosted by user, who leaves any Jam they were in.
func (s *Store) Create(user string, set Settings) (View, Change, error) {
	name, err := cleanName(set.Name, user)
	if err != nil {
		return View{}, Change{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.jams) >= maxJams {
		return View{}, Change{}, ErrTooMany
	}
	var change Change
	change.Left, change.Ended = s.leave(user)
	now := s.Now()
	set.Name = name
	j := &jam{Settings: set, id: newID(), host: user, invited: map[string]bool{}, members: []string{user}, streams: map[string]int{}, quietFrom: now}
	j.playFrom(0, 0, now)
	s.jams[j.id] = j
	s.member[key(user)] = j.id
	return j.view(user, now), change, nil
}

// Join puts someone in a Jam they may see, taking them out of any other.
func (s *Store) Join(user, id string) (View, Change, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.find(user, id)
	if err != nil {
		return View{}, Change{}, err
	}
	var change Change
	if !j.isMember(user) {
		change.Left, change.Ended = s.leave(user)
		j.members = append(j.members, user)
		s.member[key(user)] = id
		j.changed()
	}
	return j.view(user, s.Now()), change, nil
}

// Leave takes someone out of a Jam. The host leaving ends it. It reports whether it ended.
func (s *Store) Leave(user, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.member[key(user)] != id {
		if _, err := s.find(user, id); err != nil {
			return false, err
		}
		return false, ErrNotMember
	}
	_, ended := s.leave(user)
	return ended, nil
}

// Of returns the Jam someone is in.
func (s *Store) Of(user string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.member[key(user)]
	return id, ok
}

// Members lists who is in a Jam, whoever asks.
func (s *Store) Members(id string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j := s.jams[id]; j != nil {
		return append([]string(nil), j.members...)
	}
	return nil
}

// Name returns a Jam's name and whether it is public, if this person may see it.
func (s *Store) Name(user, id string) (name string, public bool, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.find(user, id)
	if err != nil {
		return "", false, false
	}
	return j.Name, j.Public, true
}

// View is a Jam as this person sees it.
func (s *Store) View(user, id string) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.find(user, id)
	if err != nil {
		return View{}, err
	}
	return j.view(user, s.Now()), nil
}

// List is every Jam this person may see: public ones, the ones they were invited to and their own.
func (s *Store) List(user string) []Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Summary{}
	for _, j := range s.jams {
		if !j.visibleTo(user) {
			continue
		}
		one := Summary{ID: j.id, Name: j.Name, Host: j.host, Public: j.Public, Members: append([]string(nil), j.members...), Member: j.isMember(user), Invited: j.invited[key(user)]}
		if i := j.entryAt(j.playback.Entry); i >= 0 && !j.playback.Paused {
			song := j.queue[i].Song
			one.Playing = &song
		}
		out = append(out, one)
	}
	sort.Slice(out, func(a, b int) bool {
		return len(out[a].Members) > len(out[b].Members) || (len(out[a].Members) == len(out[b].Members) && out[a].Name < out[b].Name)
	})
	return out
}

// member returns a Jam this person is in; s.mu must be held.
func (s *Store) memberOf(user, id string) (*jam, error) {
	j, err := s.find(user, id)
	if err != nil {
		return nil, err
	}
	if !j.isMember(user) {
		return nil, ErrNotMember
	}
	return j, nil
}

// End ends a Jam; only its host may.
func (s *Store) End(user, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.find(user, id)
	if err != nil {
		return err
	}
	if !j.isHost(user) {
		return ErrNotAllowed
	}
	s.end(j)
	return nil
}

// Configure changes a Jam's name and who may see it and control it; only its host may.
func (s *Store) Configure(user, id string, set Settings) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.find(user, id)
	if err != nil {
		return View{}, err
	}
	if !j.isHost(user) {
		return View{}, ErrNotAllowed
	}
	name, err := cleanName(set.Name, j.host)
	if err != nil {
		return View{}, err
	}
	set.Name = name
	j.Settings = set
	j.changed()
	return j.view(user, s.Now()), nil
}

// Invite lets these people see a private Jam and join it; only its host may invite.
func (s *Store) Invite(user, id string, people []string) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.find(user, id)
	if err != nil {
		return View{}, err
	}
	if !j.isHost(user) {
		return View{}, ErrNotAllowed
	}
	for _, p := range people {
		if p = strings.TrimSpace(p); p != "" && len(j.invited) < 200 {
			j.invited[key(p)] = true
		}
	}
	j.changed()
	return j.view(user, s.Now()), nil
}

// Add puts songs in the queue: at the end, or with next right after what plays and the songs added that way before.
// Any member may add. A Jam with nothing left to play starts with them.
func (s *Store) Add(user, id string, songs []Song, next bool) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.memberOf(user, id)
	if err != nil {
		return View{}, err
	}
	if len(songs) > MaxAdd || len(j.queue)+len(songs) > MaxQueue {
		return View{}, ErrFull
	}
	added := make([]Entry, len(songs))
	for i, song := range songs {
		j.entries++
		added[i] = Entry{ID: "e" + strconv.Itoa(j.entries), Song: song, AddedBy: user, next: next}
	}
	at := len(j.queue)
	if next && j.current < len(j.queue) {
		at = j.current + 1
		for at < len(j.queue) && j.queue[at].next {
			at++
		}
	}
	j.queue = append(j.queue[:at:at], append(added, j.queue[at:]...)...)
	now := s.Now()
	if j.playback.Entry == "" && len(added) > 0 {
		j.playFrom(at, 0, now)
	}
	j.changed()
	return j.view(user, now), nil
}

// Remove takes a song out of the queue. Anyone may take out what they added; the rest needs control.
func (s *Store) Remove(user, id, entry string) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.memberOf(user, id)
	if err != nil {
		return View{}, err
	}
	i := j.entryAt(entry)
	if i < 0 {
		return View{}, ErrNoEntry
	}
	if key(j.queue[i].AddedBy) != key(user) && !j.canControl(user) {
		return View{}, ErrNotAllowed
	}
	now := s.Now()
	playing, paused := i == j.current, j.playback.Paused
	j.queue = append(j.queue[:i:i], j.queue[i+1:]...)
	switch {
	case playing:
		j.playFrom(i, 0, now) // what came after it plays now
		j.playback.Paused = paused && j.playback.Entry != ""
	case i < j.current:
		j.current--
	}
	j.changed()
	return j.view(user, now), nil
}

// Move puts a song that has not played yet at another place among the songs to come.
func (s *Store) Move(user, id, entry string, to int) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.memberOf(user, id)
	if err != nil {
		return View{}, err
	}
	if !j.canControl(user) {
		return View{}, ErrNotAllowed
	}
	from := j.entryAt(entry)
	if from <= j.current {
		return View{}, ErrNoEntry
	}
	moved := j.queue[from]
	moved.next = false
	rest := append(j.queue[:from:from], j.queue[from+1:]...)
	to = min(max(to, j.current+1), len(rest))
	j.queue = append(rest[:to:to], append([]Entry{moved}, rest[to:]...)...)
	j.changed()
	return j.view(user, s.Now()), nil
}

// Control plays, pauses, seeks (value in seconds), goes to the next or previous song, or jumps to an entry.
func (s *Store) Control(user, id, action string, value float64, entry string) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.memberOf(user, id)
	if err != nil {
		return View{}, err
	}
	if !j.canControl(user) {
		return View{}, ErrNotAllowed
	}
	now := s.Now()
	p := &j.playback
	switch action {
	case "play":
		if p.Entry == "" {
			j.playFrom(j.current, 0, now) // the queue had ended: songs added since play
		} else if p.Paused {
			p.Paused, p.At = false, now.UnixMilli()
		}
	case "pause":
		if p.Entry != "" && !p.Paused {
			p.Position, p.At, p.Paused = j.position(now), now.UnixMilli(), true
		}
	case "seek":
		if i := j.entryAt(p.Entry); i >= 0 {
			limit := j.queue[i].Song.Duration
			if limit <= 0 {
				limit = value
			}
			p.Position, p.At = min(max(value, 0), limit), now.UnixMilli()
		}
	case "next":
		paused := p.Paused
		j.playFrom(j.current+1, 0, now)
		j.playback.Paused = paused && j.playback.Entry != ""
	case "previous":
		paused := p.Paused
		if j.position(now) > restartAfter || j.current == 0 {
			j.playFrom(j.current, 0, now)
		} else {
			j.playFrom(j.current-1, 0, now)
		}
		j.playback.Paused = paused && j.playback.Entry != ""
	case "jump":
		i := j.entryAt(entry)
		if i < 0 {
			return View{}, ErrNoEntry
		}
		j.playFrom(i, 0, now)
	default:
		return View{}, ErrBadAction
	}
	j.forget()
	j.changed()
	return j.view(user, now), nil
}

// Connect counts a member's stream open; the returned function closes it. A Jam nobody is connected to ends after Idle.
func (s *Store) Connect(user, id string) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, err := s.memberOf(user, id)
	if err != nil {
		return nil, err
	}
	j.streams[key(user)]++
	var once sync.Once
	return func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if j.streams[key(user)] > 0 {
				j.streams[key(user)]--
			}
			if j.streams[key(user)] == 0 {
				delete(j.streams, key(user))
			}
			if len(j.streams) == 0 {
				j.quietFrom = s.Now()
			}
		})
	}, nil
}

// Tick moves every Jam whose song is over on to the next, and ends the ones nobody has been connected to for Idle. It
// returns the Jams that changed and the ones that ended, with who was in them.
func (s *Store) Tick() (changed []string, ended map[string][]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.Now()
	ended = map[string][]string{}
	for id, j := range s.jams {
		if len(j.streams) == 0 && now.Sub(j.quietFrom) > Idle {
			ended[id] = append([]string(nil), j.members...)
			s.end(j)
			continue
		}
		moved := false
		for j.playback.Entry != "" && !j.playback.Paused {
			i := j.entryAt(j.playback.Entry)
			if i < 0 || j.queue[i].Song.Duration <= 0 {
				break
			}
			left := j.queue[i].Song.Duration - j.playback.Position
			end := time.UnixMilli(j.playback.At).Add(time.Duration(left * float64(time.Second)))
			if now.Before(end) {
				break
			}
			// The next song starts when this one ended, not when the tick came, so every device agrees on its position
			j.playFrom(i+1, 0, end)
			moved = true
		}
		if moved {
			j.forget()
			j.changed()
			changed = append(changed, id)
		}
	}
	return changed, ended
}
