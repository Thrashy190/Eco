package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Profile pictures, and the accounts an administrator can see and add. The accounts themselves stay Navidrome's.

// serveJPEG sends a stored picture. Its URL changes with the picture, so it can be kept for good.
func serveJPEG(w http.ResponseWriter, r *http.Request, path string) {
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (s *Server) myAvatar(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	serveJPEG(w, r, s.users.AvatarPath(cred.User))
}

func (s *Server) setMyAvatar(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	data, err := io.ReadAll(io.LimitReader(r.Body, userdata.MaxCoverBytes+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "could not read the picture")
		return
	}
	st, err := s.users.SetAvatar(cred.User, data)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, withoutLook(st))
}

func (s *Server) deleteMyAvatar(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	st, err := s.users.RemoveAvatar(cred.User)
	answer(w, st, err)
}

// ---- How the app looks, the same on every device ----

func (s *Server) myWallpaper(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	serveJPEG(w, r, s.users.WallpaperPath(cred.User))
}

func (s *Server) setMyWallpaper(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	data, err := io.ReadAll(io.LimitReader(r.Body, userdata.MaxCoverBytes+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "could not read the picture")
		return
	}
	st, err := s.users.SetWallpaper(cred.User, data)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]int64{"wallpaper": st.Wallpaper})
}

func (s *Server) deleteMyWallpaper(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if _, err := s.users.RemoveWallpaper(cred.User); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]int64{"wallpaper": 0})
}

// myLook answers with the look saved for this account (null when none was), when it was saved, and the version of the
// background picture.
func (s *Server) myLook(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	st := s.users.Get(cred.User)
	look := st.Look
	if look == nil {
		look = json.RawMessage("null")
	}
	respond(w, http.StatusOK, map[string]any{"look": look, "at": st.LookAt, "wallpaper": st.Wallpaper})
}

func (s *Server) setMyLook(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	data, err := io.ReadAll(io.LimitReader(r.Body, userdata.MaxLookBytes+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "could not read the look")
		return
	}
	at, err := s.users.SetLook(cred.User, data)
	if errors.Is(err, userdata.ErrBadLook) {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]int64{"at": at})
}

// userAvatar shows someone else's picture to an administrator. Nobody else can look at another account.
func (s *Server) userAvatar(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
	serveJPEG(w, r, s.users.AvatarPath(r.PathValue("name")))
}

// adminSessions remembers Navidrome sessions in memory, for as long as a page of accounts stays useful. Only the session is
// kept, never the password, and it is lost when the server restarts. Every request still passes adminOnly.
type adminSessions struct {
	mu   sync.Mutex
	open map[string]adminSession
}

type adminSession struct {
	token string
	until time.Time
}

const adminSessionLife = 15 * time.Minute

func (a *adminSessions) get(user string) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.open[strings.ToLower(user)]
	if !ok || time.Now().After(session.until) {
		delete(a.open, strings.ToLower(user))
		return "", false
	}
	return session.token, true
}

func (a *adminSessions) set(user, token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.open == nil {
		a.open = map[string]adminSession{}
	}
	a.open[strings.ToLower(user)] = adminSession{token, time.Now().Add(adminSessionLife)}
}

func (a *adminSessions) forget(user string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.open, strings.ToLower(user))
}

// unlockAdmin has the administrator confirm their password, which opens the session and is then forgotten. The
// session lets Eco list and add accounts, and remove deleted songs from Navidrome.
func (s *Server) unlockAdmin(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil || in.Password == "" {
		fail(w, http.StatusBadRequest, "Enter your password")
		return
	}
	token, err := s.nd.OpenSession(r.Context(), cred.User, in.Password)
	switch {
	case errors.Is(err, subsonic.ErrWrongPassword):
		// Not a 401: the app takes that as an expired session and signs the administrator out
		fail(w, http.StatusForbidden, "That is not your password")
	case err != nil:
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
	default:
		s.admins.set(cred.User, token)
		respond(w, http.StatusOK, map[string]any{"unlocked": true})
	}
}

type userOut struct {
	Username string `json:"username"`
	Name     string `json:"name,omitempty"`
	Admin    bool   `json:"admin"`
	LastSeen string `json:"last_seen,omitempty"`
	Avatar   int64  `json:"avatar,omitempty"`
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	session, ok := s.admins.get(cred.User)
	if !ok {
		respond(w, http.StatusOK, map[string]any{"locked": true})
		return
	}
	accounts, err := s.nd.Accounts(r.Context(), session)
	if errors.Is(err, subsonic.ErrSessionOver) {
		s.admins.forget(cred.User)
		respond(w, http.StatusOK, map[string]any{"locked": true})
		return
	}
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	out := make([]userOut, len(accounts))
	for i, a := range accounts {
		out[i] = userOut{Username: a.UserName, Name: a.Name, Admin: a.IsAdmin, LastSeen: a.LastAccessAt, Avatar: s.users.AvatarVersion(a.UserName)}
	}
	respond(w, http.StatusOK, map[string]any{"users": out})
}

var usernamePattern = regexp.MustCompile(`^[\p{L}\p{N}._-]{1,64}$`)

// MinPassword is the shortest password accepted for a new account.
const MinPassword = 8

// createUser adds a regular account. The new password goes to Navidrome and is neither stored nor written to any log.
func (s *Server) createUser(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in struct {
		Username string `json:"username"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	username := strings.TrimSpace(in.Username)
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = username
	}
	switch {
	case !usernamePattern.MatchString(username):
		fail(w, http.StatusBadRequest, "A username can have letters, numbers, dots, dashes and underscores")
		return
	case utf8.RuneCountInString(in.Password) < MinPassword:
		fail(w, http.StatusBadRequest, "The password needs at least 8 characters")
		return
	}
	session, ok := s.admins.get(cred.User)
	if !ok {
		fail(w, http.StatusLocked, "Confirm your password again")
		return
	}
	err := s.nd.CreateAccount(r.Context(), session, username, name, in.Password)
	switch {
	case errors.Is(err, subsonic.ErrSessionOver):
		s.admins.forget(cred.User)
		fail(w, http.StatusLocked, "Confirm your password again")
	case errors.Is(err, subsonic.ErrUserExists):
		fail(w, http.StatusConflict, "That username is taken")
	case err != nil:
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
	default:
		respond(w, http.StatusCreated, userOut{Username: username})
	}
}
