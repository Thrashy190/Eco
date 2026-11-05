package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
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
	respond(w, http.StatusOK, st)
}

func (s *Server) deleteMyAvatar(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	st, err := s.users.RemoveAvatar(cred.User)
	answer(w, st, err)
}

// userAvatar shows someone else's picture to an administrator. Nobody else can look at another account.
func (s *Server) userAvatar(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
	serveJPEG(w, r, s.users.AvatarPath(r.PathValue("name")))
}

type userOut struct {
	Username string `json:"username"`
	Admin    bool   `json:"admin"`
	Avatar   int64  `json:"avatar,omitempty"`
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	users, err := s.nd.Users(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	out := make([]userOut, len(users))
	for i, u := range users {
		out[i] = userOut{Username: u.Username, Admin: u.AdminRole, Avatar: s.users.AvatarVersion(u.Username)}
	}
	respond(w, http.StatusOK, map[string]any{"users": out})
}

var usernamePattern = regexp.MustCompile(`^[\p{L}\p{N}._-]{1,64}$`)

// MinPassword is the shortest password accepted for a new account.
const MinPassword = 8

// createUser adds a regular account. The password of the administrator asking is used for this one call (see
// subsonic.CreateUser), and neither password is stored or written to any log.
func (s *Server) createUser(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in struct {
		Username      string `json:"username"`
		Name          string `json:"name"`
		Password      string `json:"password"`
		AdminPassword string `json:"admin_password"`
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
	case in.AdminPassword == "":
		fail(w, http.StatusBadRequest, "Enter your own password to confirm")
		return
	}
	err := s.nd.CreateUser(r.Context(), cred.User, in.AdminPassword, username, name, in.Password)
	switch {
	case errors.Is(err, subsonic.ErrWrongPassword):
		// Not a 401: the app takes that as an expired session and signs the administrator out
		fail(w, http.StatusForbidden, "That is not your password")
	case errors.Is(err, subsonic.ErrUserExists):
		fail(w, http.StatusConflict, "That username is taken")
	case err != nil:
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
	default:
		respond(w, http.StatusCreated, userOut{Username: username})
	}
}
