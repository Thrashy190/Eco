package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/jam"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// Jams (internal/jam) over HTTP: making and joining them, the shared queue, and one stream per member's device that
// sends the whole Jam on every change, with the server's clock, so devices play the same moment. Songs come from the
// shared library, so every member streams them with their own sign-in and nobody gets access to anything new.

// jamTick is how often the server checks whether a Jam's song has ended. The next one starts from the moment the last
// ended, so a late tick only delays the news, not the music.
const jamTick = 250 * time.Millisecond

// maxJamBody fits MaxAdd song IDs.
const maxJamBody = 128 << 10

func jamError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, jam.ErrNoJam), errors.Is(err, jam.ErrNoEntry):
		fail(w, http.StatusNotFound, err.Error())
	case errors.Is(err, jam.ErrNotMember), errors.Is(err, jam.ErrNotAllowed):
		fail(w, http.StatusForbidden, err.Error()) // never 401: that signs the person out
	case errors.Is(err, jam.ErrTooMany):
		fail(w, http.StatusTooManyRequests, err.Error())
	default:
		fail(w, http.StatusBadRequest, err.Error())
	}
}

// jamID reads a Jam's ID from the address; one that cannot exist answers like a missing one.
func jamID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !jam.ValidID(id) {
		fail(w, http.StatusNotFound, jam.ErrNoJam.Error())
		return "", false
	}
	return id, true
}

// runJams moves Jams on to their next song and ends the quiet ones, until the server stops.
func (s *Server) runJams() {
	ticker := time.NewTicker(jamTick)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			changed, ended := s.jams.Tick()
			for _, id := range changed {
				s.jamChanged(id)
			}
			for id, members := range ended {
				s.jamEnded(id, members)
			}
		}
	}
}

// jamChanged sends the Jam to every device following it, as each person sees it. Someone who is no longer in it is told
// so, and their stream ends.
func (s *Server) jamChanged(id string) {
	s.jamMu.Lock()
	defer s.jamMu.Unlock()
	for w := range s.jamWatchers[id] {
		v, err := s.jams.View(w.viewer, id)
		switch {
		case err != nil:
			w.offer(sseEvent("ended", map[string]string{"id": id}))
			w.close()
		case !v.Member:
			w.offer(sseEvent("left", map[string]string{"id": id}))
			w.close()
		default:
			w.offer(sseEvent("jam", v))
		}
	}
}

// jamEnded tells every device following the Jam that it is over, and the people around that these people are no
// longer in it.
func (s *Server) jamEnded(id string, members []string) {
	s.jamMu.Lock()
	for w := range s.jamWatchers[id] {
		w.offer(sseEvent("ended", map[string]string{"id": id}))
		w.close()
	}
	delete(s.jamWatchers, id)
	s.jamMu.Unlock()
	for _, m := range members {
		s.announce(m, true)
	}
}

// afterJoin tells about a Jam someone left on the way into another.
func (s *Server) afterJoin(user string, change jam.Change, members []string) {
	switch {
	case change.Left == "":
	case change.Ended:
		s.jamEnded(change.Left, members)
	default:
		s.jamChanged(change.Left)
	}
	s.announce(user, true)
}

// announceMembers tells the people around about everyone in a Jam, whose Jam may have changed name or who may see it.
func (s *Server) announceMembers(id string) {
	for _, m := range s.jams.Members(id) {
		s.announce(m, true)
	}
}

func (s *Server) listJams(w http.ResponseWriter, _ *http.Request, cred subsonic.Cred) {
	mine, _ := s.jams.Of(cred.User)
	respond(w, http.StatusOK, map[string]any{"jams": s.jams.List(cred.User), "mine": mine})
}

// membersOfMyJam lists the people in the Jam this person is in now, before an action takes them out of it.
func (s *Server) membersOfMyJam(user string) []string {
	if id, ok := s.jams.Of(user); ok {
		return s.jams.Members(id)
	}
	return nil
}

func (s *Server) createJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var set jam.Settings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&set); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	before := s.membersOfMyJam(cred.User)
	v, change, err := s.jams.Create(cred.User, set)
	if err != nil {
		jamError(w, err)
		return
	}
	s.afterJoin(cred.User, change, before)
	respond(w, http.StatusOK, v)
}

func (s *Server) getJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	v, err := s.jams.View(cred.User, id)
	if err != nil {
		jamError(w, err)
		return
	}
	respond(w, http.StatusOK, v)
}

func (s *Server) joinJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	before := s.membersOfMyJam(cred.User)
	v, change, err := s.jams.Join(cred.User, id)
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	s.afterJoin(cred.User, change, before)
	respond(w, http.StatusOK, v)
}

func (s *Server) leaveJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	members := s.jams.Members(id)
	ended, err := s.jams.Leave(cred.User, id)
	if err != nil {
		jamError(w, err)
		return
	}
	if ended {
		s.jamEnded(id, members)
	} else {
		s.jamChanged(id)
		s.announce(cred.User, true)
	}
	respond(w, http.StatusOK, map[string]bool{"ended": ended})
}

func (s *Server) endJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	members := s.jams.Members(id)
	if err := s.jams.End(cred.User, id); err != nil {
		jamError(w, err)
		return
	}
	s.jamEnded(id, members)
	respond(w, http.StatusOK, map[string]bool{"ended": true})
}

func (s *Server) configureJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	var set jam.Settings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&set); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	v, err := s.jams.Configure(cred.User, id, set)
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	s.announceMembers(id)
	respond(w, http.StatusOK, v)
}

func (s *Server) inviteToJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	var in struct {
		Users []string `json:"users"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	v, err := s.jams.Invite(cred.User, id, in.Users)
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	s.announceMembers(id) // the people invited can now see where the host is
	respond(w, http.StatusOK, v)
}

// addToJam puts songs of the library in the queue. Only IDs come from the app; their details come from the library, so
// nobody can put a made-up song in front of everyone.
func (s *Server) addToJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	var in struct {
		Songs []string `json:"songs"`
		Next  bool     `json:"next"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJamBody)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(in.Songs) > jam.MaxAdd {
		jamError(w, jam.ErrFull)
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	songs := make([]jam.Song, 0, len(in.Songs))
	for _, songID := range in.Songs {
		if song, ok := lib.byID[songID]; ok {
			songs = append(songs, jam.Song{ID: song.ID, Title: song.Title, Artist: song.Artist, ArtistID: song.ArtistID, Album: song.Album, AlbumID: song.AlbumID, Cover: song.CoverArt, Duration: float64(song.Duration)})
		}
	}
	if len(songs) == 0 {
		fail(w, http.StatusBadRequest, "those songs are not in the library")
		return
	}
	v, err := s.jams.Add(cred.User, id, songs, in.Next)
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	respond(w, http.StatusOK, v)
}

func (s *Server) removeFromJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	v, err := s.jams.Remove(cred.User, id, r.PathValue("entry"))
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	respond(w, http.StatusOK, v)
}

func (s *Server) moveInJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	var in struct {
		Entry string `json:"entry"`
		To    int    `json:"to"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	v, err := s.jams.Move(cred.User, id, in.Entry, in.To)
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	respond(w, http.StatusOK, v)
}

func (s *Server) controlJam(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	var in struct {
		Action string  `json:"action"`
		Value  float64 `json:"value"`
		Entry  string  `json:"entry"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	v, err := s.jams.Control(cred.User, id, in.Action, in.Value, in.Entry)
	if err != nil {
		jamError(w, err)
		return
	}
	s.jamChanged(id)
	respond(w, http.StatusOK, v)
}

// serverTime is the server's clock, for devices to measure how far theirs is from it.
func (s *Server) serverTime(w http.ResponseWriter, _ *http.Request, _ subsonic.Cred) {
	w.Header().Set("Cache-Control", "no-store")
	respond(w, http.StatusOK, map[string]int64{"now": time.Now().UnixMilli()})
}

// jamEvents is a member's stream: the whole Jam now and after every change, then "left" or "ended".
func (s *Server) jamEvents(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id, ok := jamID(w, r)
	if !ok {
		return
	}
	release, err := s.jams.Connect(cred.User, id)
	if err != nil {
		jamError(w, err)
		return
	}
	defer release()
	watcher := &peopleWatcher{viewer: strings.ToLower(cred.User), events: make(chan []byte, 64), closed: make(chan struct{})}
	s.jamMu.Lock()
	if s.jamWatchers == nil {
		s.jamWatchers = map[string]map[*peopleWatcher]bool{}
	}
	if s.jamWatchers[id] == nil {
		s.jamWatchers[id] = map[*peopleWatcher]bool{}
	}
	s.jamWatchers[id][watcher] = true
	first, err := s.jams.View(cred.User, id) // under the lock: every event after it is newer
	s.jamMu.Unlock()
	defer func() {
		s.jamMu.Lock()
		delete(s.jamWatchers[id], watcher)
		if len(s.jamWatchers[id]) == 0 {
			delete(s.jamWatchers, id)
		}
		s.jamMu.Unlock()
	}()
	if err != nil {
		jamError(w, err)
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	stream := http.NewResponseController(w)
	if _, err := w.Write(sseEvent("jam", first)); err != nil {
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
			// What closed it (left, ended) is queued: send it before going
			for {
				select {
				case event := <-watcher.events:
					w.Write(event)
					continue
				default:
				}
				break
			}
			stream.Flush()
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
