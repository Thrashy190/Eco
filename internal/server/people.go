package server

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/stats"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// People on one server see each other's profiles (userdata/profile.go): the one deliberate exception to accounts not
// seeing each other. Only what a profile shows leaves the server, each part only if its owner has not hidden it, and a
// hidden part answers exactly like an empty one. A hidden profile answers like someone who never signed in. Songs go out
// with the asker's own stars and nobody's play counts: a ranking says the order, never how often.

const (
	// topDays is how far back the songs someone plays most are counted.
	topDays = 28
	topSize = 10
	// favoritesPreview is how many favourites a profile shows before "Show all".
	favoritesPreview = 10
	// favoritesCopyEvery is how old the copy of someone's favourites may get before the app opening takes it again.
	favoritesCopyEvery = 5 * time.Minute
)

type personOut struct {
	User   string `json:"user"`
	Name   string `json:"name"` // what to call them: the name they chose, else the username
	Avatar int64  `json:"avatar,omitempty"`
	Banner int64  `json:"banner,omitempty"`
	Me     bool   `json:"me,omitempty"`
}

type profilePlaylist struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SongCount int    `json:"song_count"`
	Cover     string `json:"cover,omitempty"`
}

type profileOut struct {
	personOut
	Top           []songOut         `json:"top"`
	Playlists     []profilePlaylist `json:"playlists"`
	Favorites     []songOut         `json:"favorites"`
	FavoriteCount int               `json:"favorite_count"`
	Privacy       *userdata.Privacy `json:"privacy,omitempty"` // only on your own profile
}

func outPerson(p userdata.Person, asker string) personOut {
	name := p.DisplayName
	if name == "" {
		name = p.User
	}
	return personOut{User: p.User, Name: name, Avatar: p.Avatar, Banner: p.Banner, Me: strings.EqualFold(p.User, asker)}
}

// visiblePerson finds someone the asker may see: anyone who signed in to Eco and did not hide their profile, and the
// asker themselves.
func (s *Server) visiblePerson(asker, name string) (userdata.Person, bool) {
	p, ok := s.users.Person(name)
	if !ok || (p.Privacy.HideProfile && !strings.EqualFold(p.User, asker)) {
		return userdata.Person{}, false
	}
	return p, true
}

// people lists everyone the asker may see, most recently seen first.
func (s *Server) people(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	all, err := s.users.People()
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := []personOut{}
	for _, p := range all {
		if !p.Privacy.HideProfile || strings.EqualFold(p.User, cred.User) {
			out = append(out, outPerson(p, cred.User))
		}
	}
	respond(w, http.StatusOK, map[string]any{"people": out})
}

// librarySongs turns song IDs into songs of the library, in that order, with the asker's stars. Songs no longer in
// the library are left out.
func librarySongs(lib *snapshot, ids []string, stars map[string]string) []songOut {
	out := []songOut{}
	for _, id := range ids {
		song, ok := lib.byID[id]
		if !ok {
			continue
		}
		song.Starred = stars[id] // the snapshot holds nobody's (stars.go)
		out = append(out, songsOut([]subsonic.Song{song})[0])
	}
	return out
}

// topSongs is the order of the songs someone played most in the last topDays, without the counts.
func (s *Server) topSongs(user string) []string {
	plays, imported, err := s.stats.Snapshot()
	if err != nil {
		return nil
	}
	summary := stats.Summarize(plays, imported, stats.Query{User: user, From: time.Now().AddDate(0, 0, -topDays), Top: topSize})
	ids := make([]string, 0, len(summary.Songs))
	for _, song := range summary.Songs {
		ids = append(ids, song.ID)
	}
	return ids
}

// person is someone's profile: their top songs, public playlists and newest favourites.
func (s *Server) person(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	p, ok := s.visiblePerson(cred.User, r.PathValue("name"))
	if !ok {
		fail(w, http.StatusNotFound, "no such person")
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	out := profileOut{personOut: outPerson(p, cred.User), Top: []songOut{}, Playlists: []profilePlaylist{}, Favorites: []songOut{}}
	stars := s.myStars(r.Context(), cred)
	if !p.Privacy.HideTop || out.Me {
		out.Top = librarySongs(lib, s.topSongs(p.User), stars)
	}
	if !p.Privacy.HideFavorites || out.Me {
		favorites := librarySongs(lib, s.users.FavoritesOf(p.User).Songs, stars)
		out.FavoriteCount = len(favorites)
		out.Favorites = favorites[:min(len(favorites), favoritesPreview)]
	}
	// Navidrome lists the asker's playlists and everyone's public ones: a profile shows only the public ones, also your own
	if lists, err := s.nd.Playlists(r.Context(), cred); err == nil {
		for _, l := range lists {
			if l.Public && strings.EqualFold(l.Owner, p.User) {
				out.Playlists = append(out.Playlists, profilePlaylist{l.ID, l.Name, l.SongCount, l.CoverArt})
			}
		}
	}
	if out.Me {
		out.Privacy = &p.Privacy
	}
	respond(w, http.StatusOK, out)
}

// personFavorites is all of someone's favourites, newest first, as of the last time they used Eco.
func (s *Server) personFavorites(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	p, ok := s.visiblePerson(cred.User, r.PathValue("name"))
	if !ok {
		fail(w, http.StatusNotFound, "no such person")
		return
	}
	songs := []songOut{}
	if !p.Privacy.HideFavorites || strings.EqualFold(p.User, cred.User) {
		lib, err := s.library(r.Context(), cred)
		if err != nil {
			fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
			return
		}
		songs = librarySongs(lib, s.users.FavoritesOf(p.User).Songs, s.myStars(r.Context(), cred))
	}
	respond(w, http.StatusOK, map[string]any{"songs": songs})
}

// personPicture serves someone's profile picture or the cover of their profile.
func (s *Server) personPicture(banner bool) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		p, ok := s.visiblePerson(cred.User, r.PathValue("name"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		if banner {
			serveJPEG(w, r, s.users.BannerPath(p.User))
		} else {
			serveJPEG(w, r, s.users.AvatarPath(p.User))
		}
	}
}

type profileSettings struct {
	DisplayName string           `json:"display_name"`
	Privacy     userdata.Privacy `json:"privacy"`
	Banner      int64            `json:"banner,omitempty"`
}

func (s *Server) myProfile(w http.ResponseWriter, _ *http.Request, cred subsonic.Cred) {
	st := s.users.Get(cred.User)
	respond(w, http.StatusOK, profileSettings{st.DisplayName, st.Privacy, st.Banner})
}

func (s *Server) setMyProfile(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in profileSettings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	st, err := s.users.SetProfile(cred.User, in.DisplayName, in.Privacy)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, profileSettings{st.DisplayName, st.Privacy, st.Banner})
}

func (s *Server) myBanner(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	serveJPEG(w, r, s.users.BannerPath(cred.User))
}

func (s *Server) setMyBanner(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	data, err := io.ReadAll(io.LimitReader(r.Body, userdata.MaxCoverBytes+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "could not read the picture")
		return
	}
	st, err := s.users.SetBanner(cred.User, data)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, profileSettings{st.DisplayName, st.Privacy, st.Banner})
}

func (s *Server) deleteMyBanner(w http.ResponseWriter, _ *http.Request, cred subsonic.Cred) {
	st, err := s.users.RemoveBanner(cred.User)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, profileSettings{st.DisplayName, st.Privacy, st.Banner})
}

// copyFavoritesSoon copies someone's favourites in the background. A change while a copy is being taken makes one more,
// so a burst of hearts makes at most two requests, and the last copy is never older than the last change.
func (s *Server) copyFavoritesSoon(cred subsonic.Cred) {
	k := strings.ToLower(cred.User)
	s.mu.Lock()
	if s.copying == nil {
		s.copying, s.copyAgain = map[string]bool{}, map[string]bool{}
	}
	if s.copying[k] {
		s.copyAgain[k] = true
		s.mu.Unlock()
		return
	}
	s.copying[k] = true
	s.mu.Unlock()
	s.favorites.Add(1)
	go func() {
		defer s.favorites.Done()
		for {
			s.copyFavorites(cred)
			s.mu.Lock()
			if !s.copyAgain[k] {
				delete(s.copying, k)
				s.mu.Unlock()
				return
			}
			delete(s.copyAgain, k)
			s.mu.Unlock()
		}
	}()
}

// copyFavorites asks Navidrome for someone's favourites with their own credentials and keeps their IDs, newest first.
func (s *Server) copyFavorites(cred subsonic.Cred) {
	ctx, cancel := context.WithTimeout(s.ctx, time.Minute)
	defer cancel()
	songs, err := s.nd.Starred(ctx, cred)
	if err != nil {
		log.Printf("copying the favourites of %s: %v", cred.User, err)
		return
	}
	starredAt := func(song subsonic.Song) time.Time {
		t, _ := time.Parse(time.RFC3339Nano, song.Starred)
		return t
	}
	sort.SliceStable(songs, func(i, j int) bool { return starredAt(songs[i]).After(starredAt(songs[j])) })
	ids := make([]string, len(songs))
	for i, song := range songs {
		ids[i] = song.ID
	}
	if err := s.users.SetFavorites(cred.User, ids); err != nil {
		log.Printf("copying the favourites of %s: %v", cred.User, err)
	}
}
