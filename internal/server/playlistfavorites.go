package server

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/Thrashy190/eco/internal/subsonic"
)

// The heart on a playlist makes every song of it a favourite of whoever taps it, with their own credentials. Songs that
// already are favourites are left alone: starring a song again gives it a new date, and it would leave its place in
// Favorites.
//
// Order matters, as in syncFavorites: Navidrome lists the newest favourite first, so the songs are starred from the
// bottom of the playlist up, and the new favourites read like the playlist.

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

// favoritePlaylist makes the songs of a playlist this user can see their favourites. The stars carry on if the app goes
// away halfway (a phone locking), so the playlist never ends up half in Favorites.
func (s *Server) favoritePlaylist(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	type outcome struct {
		added favoritesAdded
		err   error
	}
	done := make(chan outcome, 1)
	s.favorites.Add(1)
	go func() {
		defer s.favorites.Done()
		added, err := s.starPlaylist(s.ctx, cred, id)
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
	order, already := toFavorite(songs)
	if len(order) > 0 {
		defer s.forgetStars(cred.User) // lists show the new hearts at once (stars.go)
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
