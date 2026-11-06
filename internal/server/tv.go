package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Thrashy190/eco/internal/connect"
	"github.com/Thrashy190/eco/internal/pairing"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// What a TV app needs that a browser does not: signing in with a code instead of a password typed on a remote, and
// Connect without a stream, since a Roku cannot read a response that has not finished (see roku/ and
// docs/tv.md).

const (
	// A poll waits this long for something to happen: well under the 100 s Cloudflare allows a request.
	pollWait = 25 * time.Second
	// A TV stays connected this long after its last poll, so the gap before the next one goes unnoticed.
	pollLinger = 20 * time.Second
	// The most events one poll returns; the rest wait for the next.
	pollBatch = 32
)

// pairStart creates a code for a TV to show. It needs no sign-in: the TV has none yet.
func (s *Server) pairStart(w http.ResponseWriter, r *http.Request) {
	code, secret, err := s.pairs.Start()
	if errors.Is(err, pairing.ErrBusy) {
		fail(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"code": code, "secret": secret, "expires_in": int(pairing.Lifetime.Seconds())})
}

// pairCollect is the TV asking whether its code was approved: 202 while it waits, the credentials once it was, and
// 404 when the code expired (or the secret is wrong).
func (s *Server) pairCollect(w http.ResponseWriter, r *http.Request) {
	cred, err := s.pairs.Collect(r.PathValue("code"), r.URL.Query().Get("secret"))
	switch {
	case errors.Is(err, pairing.ErrPending):
		respond(w, http.StatusAccepted, map[string]bool{"pending": true})
	case err != nil:
		fail(w, http.StatusNotFound, err.Error())
	default:
		w.Header().Set("Cache-Control", "no-store")
		respond(w, http.StatusOK, cred)
	}
}

// pairApprove signs the TV showing this code in to the caller's account.
func (s *Server) pairApprove(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Only a token is handed over. Someone signed in with a plain password (p=) would be giving it to the TV
	if cred.Token == "" || cred.Salt == "" || cred.Password != "" {
		fail(w, http.StatusBadRequest, "Sign in to Eco again on this device, then try the code")
		return
	}
	err := s.pairs.Approve(body.Code, pairing.Cred{User: cred.User, Token: cred.Token, Salt: cred.Salt})
	switch {
	case errors.Is(err, pairing.ErrUnknown):
		fail(w, http.StatusNotFound, "That code has expired or is not right. Check the TV")
	case errors.Is(err, pairing.ErrTaken):
		fail(w, http.StatusConflict, err.Error())
	case err != nil:
		fail(w, http.StatusInternalServerError, err.Error())
	default:
		respond(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

type pollEvent struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data"`
}

// connectPoll is Connect for a device that cannot keep a stream open: it waits until something happens (or
// pollWait passes) and returns what did, the same events /api/connect/events streams. Credentials are checked on
// every poll.
func (s *Server) connectPoll(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := r.URL.Query()
	id := q.Get("device")
	if !connect.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid device")
		return
	}
	conn, release, err := s.hub.Hold(cred.User, connect.Info{ID: id, Name: q.Get("name"), CanVolume: q.Get("can_volume") == "1"}, pollLinger)
	if err != nil {
		fail(w, http.StatusTooManyRequests, err.Error())
		return
	}
	defer release()

	out := []pollEvent{}
	wait := time.NewTimer(pollWait)
	defer wait.Stop()
	select {
	case e := <-conn.Events:
		out = append(out, pollEvent{e.Name, e.Data})
	case <-wait.C:
	case <-conn.Closed:
	case <-r.Context().Done():
		return
	}
	// Whatever else is already waiting goes along with it
	for len(out) > 0 && len(out) < pollBatch {
		select {
		case e := <-conn.Events:
			out = append(out, pollEvent{e.Name, e.Data})
			continue
		default:
		}
		break
	}
	w.Header().Set("Cache-Control", "no-store")
	respond(w, http.StatusOK, map[string]any{"events": out})
}
