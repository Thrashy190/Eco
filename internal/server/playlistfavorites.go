package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"

	"github.com/Thrashy190/eco/internal/subsonic"
)

// The heart on a playlist or an album makes every song of it a favourite of whoever taps it, with their own
// credentials. Songs that already are favourites are left alone: starring a song again gives it a new date, and it
// would leave its place in Favorites.
//
// Order matters, as in syncFavorites: Navidrome lists the newest favourite first, so the songs are starred from the
// bottom of the list up, and the new favourites read like the playlist or the album.

// toFavorite lists the songs of a playlist that are not favourites yet, in the order to star them, and counts the ones
// that already are. A song listed twice counts once, where it first appears.
func toFavorite(songs []subsonic.Song) (order []string, already int) {
	seen := map[string]bool{}
	for _, song := range songs {
		if seen[song.ID] {
			continue
		}
		seen[song.ID] = true
		if song.Starred != "" {
			already++
			continue
		}
		order = append(order, song.ID)
	}
	slices.Reverse(order)
	return order, already
}

// errNoPlaylist is a playlist that does not exist or that this user cannot see.
var errNoPlaylist = errors.New("no such playlist")

type favoritesAdded struct {
	Added   int `json:"added"`
	Already int `json:"already"`
}

// favoritePlaylist makes the songs of a playlist this user can see their favourites.
func (s *Server) favoritePlaylist(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	s.runFavorites(w, r, func(ctx context.Context) (favoritesAdded, error) { return s.starPlaylist(ctx, cred, id) })
}

// maxFavoriteSongs is the most songs one heart stars, far more than any album.
const maxFavoriteSongs = 2000

// favoriteSongs makes songs of the library the asker's favourites, in the order given: an album's heart sends its songs
// as the page lists them, the catalogue's matched to the library included. Only IDs come from the app; songs the
// library does not have are left out.
func (s *Server) favoriteSongs(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in struct {
		Songs []string `json:"songs"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&in); err != nil || len(in.Songs) == 0 || len(in.Songs) > maxFavoriteSongs {
		fail(w, http.StatusBadRequest, "send the songs to add, at most 2000")
		return
	}
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	known := make([]subsonic.Song, 0, len(in.Songs))
	for _, id := range in.Songs {
		if song, ok := lib.byID[id]; ok {
			known = append(known, song)
		}
	}
	if len(known) == 0 {
		fail(w, http.StatusBadRequest, "those songs are not in the library")
		return
	}
	s.runFavorites(w, r, func(ctx context.Context) (favoritesAdded, error) {
		lock := s.favoritesLock(cred.User, "songs")
		lock.Lock()
		defer lock.Unlock()
		// The asker's stars as they are now, never the cached ones: starring a favourite again would move it
		current, err := s.nd.Starred(ctx, cred)
		if err != nil {
			return favoritesAdded{}, err
		}
		starred := make(map[string]string, len(current))
		for _, song := range current {
			starred[song.ID] = song.Starred
		}
		for i := range known {
			known[i].Starred = starred[known[i].ID] // the snapshot holds nobody's (stars.go)
		}
		return s.starInOrder(ctx, cred, known)
	})
}

// runFavorites stars songs in the background and answers when it is done. The stars carry on if the app goes away
// halfway (a phone locking), so a list never ends up half in Favorites.
func (s *Server) runFavorites(w http.ResponseWriter, r *http.Request, work func(context.Context) (favoritesAdded, error)) {
	type outcome struct {
		added favoritesAdded
		err   error
	}
	done := make(chan outcome, 1)
	s.favorites.Add(1)
	go func() {
		defer s.favorites.Done()
		added, err := work(s.ctx)
		done <- outcome{added, err}
	}()
	select {
	case got := <-done:
		switch {
		case errors.Is(got.err, errNoPlaylist):
			fail(w, http.StatusNotFound, got.err.Error())
		case got.err != nil:
			fail(w, http.StatusBadGateway, "Navidrome: "+got.err.Error())
		default:
			respond(w, http.StatusOK, got.added)
		}
	case <-r.Context().Done():
	}
}

// starPlaylist stars the songs of the playlist that are not favourites yet, one run per playlist and person at a time,
// so two taps never star a song twice.
func (s *Server) starPlaylist(ctx context.Context, cred subsonic.Cred, id string) (favoritesAdded, error) {
	lock := s.favoritesLock(cred.User, "playlist/"+id)
	lock.Lock()
	defer lock.Unlock()
	songs, err := s.nd.PlaylistSongs(ctx, cred, id)
	var refused *subsonic.APIError
	if errors.As(err, &refused) {
		return favoritesAdded{}, errNoPlaylist
	}
	if err != nil {
		return favoritesAdded{}, err
	}
	return s.starInOrder(ctx, cred, songs)
}

// starInOrder stars the songs that are not favourites yet, from the last up (toFavorite), and tells the lists and the
// profile.
func (s *Server) starInOrder(ctx context.Context, cred subsonic.Cred, songs []subsonic.Song) (favoritesAdded, error) {
	order, already := toFavorite(songs)
	if len(order) > 0 {
		defer func() {
			s.forgetStars(cred.User) // lists and the profile show the new hearts at once
			s.copyFavoritesSoon(cred)
		}()
	}
	for i, songID := range order {
		if i > 0 && !pause(ctx, favoriteGap) {
			return favoritesAdded{}, ctx.Err()
		}
		if err := s.nd.Star(ctx, cred, songID); err != nil {
			return favoritesAdded{}, err
		}
	}
	return favoritesAdded{Added: len(order), Already: already}, nil
}
