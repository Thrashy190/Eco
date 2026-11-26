package server

import (
	"context"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Liked songs can go to Favorites instead of a playlist (userdata.Import.Favorites). The songs of the list that the
// library has become favourites of the person who imported it, with their own credentials, so they are nobody else's.
//
// Order matters, as in lists.SyncFavorites: Navidrome dates each favourite and lists the newest first, and making a song
// a favourite again gives it a new date. So favourites are made from the oldest like to the newest, and Favorites reads
// like the list. A song that arrives later (downloaded from the list, or by anyone) can only go on top; once the list has
// no download left on its way, its favourites are made again in order (orderFavorites).
//
// Starring thousands of songs takes a while, so it runs in the background, one run per list at a time.

// favoriteGap separates favourites made one after another, so their dates keep the order.
const favoriteGap = 3 * time.Millisecond

// likeTimes are the ways files write when a song was liked.
var likeTimes = []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"}

func likedAt(text string) (time.Time, bool) {
	for _, layout := range likeTimes {
		if t, err := time.Parse(layout, strings.TrimSpace(text)); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// likeOrder lists the library's songs of a list from the oldest like to the newest: by when each was liked if the file
// says so for every one of them (Exportify's "Added At"), or else from the last row up, since Spotify lists the newest
// like first. A song listed twice keeps its newest like.
func likeOrder(rows []importRowOut) []string {
	type owned struct {
		id string
		at time.Time
	}
	var songs []owned
	dated := true
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].Library == nil {
			continue
		}
		at, ok := likedAt(rows[i].AddedAt)
		dated = dated && ok
		songs = append(songs, owned{rows[i].Library.ID, at})
	}
	if dated {
		sort.SliceStable(songs, func(i, j int) bool { return songs[i].at.Before(songs[j].at) })
	}
	last := map[string]int{}
	for i, song := range songs {
		last[song.id] = i
	}
	out := []string{}
	for i, song := range songs {
		if last[song.id] == i {
			out = append(out, song.id)
		}
	}
	return out
}

// favoritesLock gives each list one favourites run at a time.
func (s *Server) favoritesLock(user, id string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.favoriteRuns == nil {
		s.favoriteRuns = map[string]*sync.Mutex{}
	}
	k := strings.ToLower(user) + "|" + id
	if s.favoriteRuns[k] == nil {
		s.favoriteRuns[k] = &sync.Mutex{}
	}
	return s.favoriteRuns[k]
}

// startFavorites runs syncFavorites in the background. finishing is a download of the list that has just ended but
// still counts as running.
func (s *Server) startFavorites(cred subsonic.Cred, id, finishing string) {
	s.favorites.Add(1)
	go func() {
		defer s.favorites.Done()
		s.syncFavorites(s.ctx, cred, id, finishing)
	}()
}

// syncFavorites makes favourites of the list's songs that the library has and that it never made favourites before: a
// favourite taken away by hand is not given back. Then, if some went on top out of order and nothing else of the list is
// on its way, it puts them all in order.
func (s *Server) syncFavorites(ctx context.Context, cred subsonic.Cred, id, finishing string) {
	lock := s.favoritesLock(cred.User, id)
	lock.Lock()
	defer lock.Unlock()
	imp, ok := s.users.Import(cred.User, id)
	if !ok || !imp.Favorites {
		return
	}
	lib, err := s.library(ctx, cred)
	if err != nil {
		log.Printf("favourites of %s: %v", imp.Name, err)
		return
	}
	rows := matchRows(imp.Rows, lib)
	order := likeOrder(rows)
	done := map[string]bool{}
	for _, songID := range imp.Linked {
		done[songID] = true
	}
	first, unordered := len(imp.Linked) == 0, imp.Unordered
	var made []string
	for _, songID := range order {
		if done[songID] {
			continue
		}
		if err := s.nd.Star(ctx, cred, songID); err != nil {
			log.Printf("favourites of %s: %v", imp.Name, err)
			break
		}
		made = append(made, songID)
		unordered = unordered || !first
		if !pause(ctx, favoriteGap) {
			break
		}
	}
	if unordered && !s.importBusy(rows, finishing) {
		if err := s.orderFavorites(ctx, cred, order); err != nil {
			log.Printf("putting the favourites of %s in order: %v", imp.Name, err)
		} else {
			unordered = false
		}
	}
	err = s.users.UpdateImport(cred.User, id, func(saved *userdata.Import) {
		saved.Linked = append(saved.Linked, made...)
		saved.Unordered = unordered
	})
	if err != nil {
		log.Printf("favourites of %s: %v", imp.Name, err)
	}
}

// importBusy reports whether a song of the list is still on its way, other than the download that is just finishing.
func (s *Server) importBusy(rows []importRowOut, finishing string) bool {
	for _, row := range rows {
		if row.Library == nil && row.Key != finishing && s.jobs.Running(row.Key) {
			return true
		}
	}
	return false
}

// orderFavorites makes the list's songs that are favourites now favourites again, from the oldest like to the newest.
// Songs taken out of the favourites stay out.
func (s *Server) orderFavorites(ctx context.Context, cred subsonic.Cred, order []string) error {
	current, err := s.nd.Starred(ctx, cred)
	if err != nil {
		return err
	}
	starred := map[string]bool{}
	for _, song := range current {
		starred[song.ID] = true
	}
	for _, songID := range order {
		if !starred[songID] {
			continue
		}
		if err := s.nd.Star(ctx, cred, songID); err != nil {
			return err
		}
		if !pause(ctx, favoriteGap) {
			return ctx.Err()
		}
	}
	return nil
}

// pause waits, or reports false if the server is stopping.
func pause(ctx context.Context, d time.Duration) bool {
	select {
	case <-time.After(d):
		return true
	case <-ctx.Done():
		return false
	}
}
