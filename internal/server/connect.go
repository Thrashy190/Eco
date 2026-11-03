package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/Thrashy190/eco/internal/connect"
	"github.com/Thrashy190/eco/internal/subsonic"
)

const (
	// Comments keep the stream alive through tunnels and proxies, which close connections that look idle.
	connectHeartbeat = 25 * time.Second
	// Credentials are checked when a stream opens. Ending it now and then makes the browser reconnect, which checks
	// them again, so a changed password cannot keep a stream open for ever.
	connectMaxStream = time.Hour
	maxStateBytes    = 256 << 10
	maxCommandBytes  = 4 << 20 // moving playback sends the whole queue
)

// connectEvents is a device's stream: the list of the user's devices, what they play, and commands for it.
func (s *Server) connectEvents(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := r.URL.Query()
	id := q.Get("device")
	if !connect.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid device")
		return
	}
	conn, leave, err := s.hub.Join(cred.User, connect.Info{ID: id, Name: q.Get("name"), CanVolume: q.Get("can_volume") == "1"})
	if err != nil {
		fail(w, http.StatusTooManyRequests, err.Error())
		return
	}
	defer leave()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	stream := http.NewResponseController(w)
	if err := stream.Flush(); err != nil {
		return
	}
	heartbeat := time.NewTicker(connectHeartbeat)
	defer heartbeat.Stop()
	limit := time.NewTimer(connectMaxStream)
	defer limit.Stop()
	for {
		select {
		case e := <-conn.Events:
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Name, e.Data); err != nil {
				return
			}
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
		case <-conn.Closed:
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

func hubError(w http.ResponseWriter, err error) {
	if errors.Is(err, connect.ErrUnknownDevice) {
		fail(w, http.StatusNotFound, "That device is not connected")
		return
	}
	fail(w, http.StatusInternalServerError, err.Error())
}

// connectState records what the calling device is playing.
func (s *Server) connectState(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var state json.RawMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, maxStateBytes)).Decode(&state); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := s.hub.Report(cred.User, r.URL.Query().Get("device"), state); err != nil {
		hubError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// connectCommand passes a command to another device of the same user.
func (s *Server) connectCommand(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var body struct {
		Target string          `json:"target"`
		Action string          `json:"action"`
		Value  json.RawMessage `json:"value"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxCommandBytes)).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	if !connect.ValidAction(body.Action) {
		fail(w, http.StatusBadRequest, "unknown action")
		return
	}
	if err := s.hub.Send(cred.User, r.URL.Query().Get("device"), body.Target, body.Action, body.Value); err != nil {
		hubError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})
}
