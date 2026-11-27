package server

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/connect"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// What people play right now, for the others on the server to see, as it happens. It comes from what their devices
// report to Connect (connect.Hub.Listening), and shows unless its owner hides it (Privacy.HideListening): hidden answers
// exactly like nothing playing. A hidden profile sends nothing at all to anyone else.

// seekJump is how far a song must move from where it should be for the others to hear of it: a seek, not the clock.
const seekJump = 5.0

type listeningOut struct {
	User     string           `json:"user"`
	Song     *connect.NowSong `json:"song"` // nil when nothing plays
	Position float64          `json:"position,omitempty"`
	AgeMs    int64            `json:"age_ms,omitempty"` // how long ago the position was true
}

type peopleWatcher struct {
	viewer string // lowercase
	events chan []byte
	closed chan struct{}
	once   sync.Once
}

func (w *peopleWatcher) close() { w.once.Do(func() { close(w.closed) }) }

// offer queues an event; a watcher too slow to keep up is let go, and its browser connects again.
func (w *peopleWatcher) offer(event []byte) {
	select {
	case w.events <- event:
	default:
		w.close()
	}
}

// presence remembers what was last said about each person, and who is watching.
type presence struct {
	mu       sync.Mutex
	watchers map[*peopleWatcher]bool
	last     map[string]connect.Listening // lowercase username → what they play; absent when nothing
}

// news reports whether what someone plays changed enough to tell: another song, starting or stopping, or a seek.
func news(before connect.Listening, was bool, now connect.Listening, playing bool) bool {
	if was != playing {
		return true
	}
	if !playing {
		return false
	}
	if before.Song != now.Song {
		return true
	}
	expected := before.Position + now.At.Sub(before.At).Seconds()
	return math.Abs(now.Position-expected) > seekJump
}

// listeningFor is what viewer may see of what person plays. show is false when nothing may be sent at all.
func listeningFor(viewer string, person userdata.Person, known bool, l connect.Listening, playing bool) (out listeningOut, show bool) {
	self := strings.EqualFold(viewer, person.User)
	if !known || (person.Privacy.HideProfile && !self) {
		return listeningOut{}, self
	}
	out.User = person.User
	if !playing || (person.Privacy.HideListening && !self) {
		return out, true
	}
	song := l.Song
	out.Song, out.Position, out.AgeMs = &song, l.Position, time.Since(l.At).Milliseconds()
	return out, true
}

func sseEvent(name string, v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		data = []byte("null")
	}
	return []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", name, data))
}

// announce tells everyone watching when what a person plays has changed, or always with force (a privacy change).
// The hub is read and the events queued under one lock, so two changes close together reach everyone in their order.
func (s *Server) announce(user string, force bool) {
	person, known := s.users.Person(user)
	k := strings.ToLower(user)
	s.presence.mu.Lock()
	defer s.presence.mu.Unlock()
	now, playing := s.hub.Listening(user)
	before, was := s.presence.last[k]
	if !force && !news(before, was, now, playing) {
		return
	}
	if s.presence.last == nil {
		s.presence.last = map[string]connect.Listening{}
	}
	if playing {
		s.presence.last[k] = now
	} else {
		delete(s.presence.last, k)
	}
	for w := range s.presence.watchers {
		if out, show := listeningFor(w.viewer, person, known, now, playing); show {
			w.offer(sseEvent("listening", out))
		}
	}
}

// nowListening is everyone the viewer may see who plays something now.
func (s *Server) nowListening(viewer string) []listeningOut {
	people, _ := s.users.People()
	out := []listeningOut{}
	for _, p := range people {
		l, playing := s.hub.Listening(p.User)
		if one, show := listeningFor(viewer, p, true, l, playing); show && one.Song != nil {
			out = append(out, one)
		}
	}
	return out
}

// listening answers once: who plays what now.
func (s *Server) listening(w http.ResponseWriter, _ *http.Request, cred subsonic.Cred) {
	respond(w, http.StatusOK, map[string]any{"listening": s.nowListening(cred.User)})
}

// listeningEvents is a stream: who plays what now, then every change.
func (s *Server) listeningEvents(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	watcher := &peopleWatcher{viewer: strings.ToLower(cred.User), events: make(chan []byte, 64), closed: make(chan struct{})}
	s.presence.mu.Lock()
	if s.presence.watchers == nil {
		s.presence.watchers = map[*peopleWatcher]bool{}
	}
	s.presence.watchers[watcher] = true
	snapshot := s.nowListening(cred.User) // under the lock: every event after it is newer
	s.presence.mu.Unlock()
	defer func() {
		s.presence.mu.Lock()
		delete(s.presence.watchers, watcher)
		s.presence.mu.Unlock()
	}()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	stream := http.NewResponseController(w)
	if _, err := w.Write(sseEvent("snapshot", snapshot)); err != nil {
		return
	}
	if err := stream.Flush(); err != nil {
		return
	}
	heartbeat := time.NewTicker(connectHeartbeat)
	defer heartbeat.Stop()
	limit := time.NewTimer(connectMaxStream)
	defer limit.Stop()
	for {
		select {
		case event := <-watcher.events:
			if _, err := w.Write(event); err != nil {
				return
			}
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
		case <-watcher.closed:
			return
		case <-limit.C:
			return
		case <-r.Context().Done():
			return
		}
		if err := stream.Flush(); err != nil {
			return
		}
	}
}
