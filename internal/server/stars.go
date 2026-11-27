package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/subsonic"
)

// The library snapshot is shared by everyone and rebuilt by whoever asks once it is old. Navidrome marks each song with
// the stars of whoever asked, so the snapshot keeps none (library), or one person's hearts would reach the others.
// Lists made from it get the asker's own stars here, asked of Navidrome and kept as long as the snapshot.

type starsEntry struct {
	at    time.Time
	stars map[string]string // song ID → when it became a favourite
}

// myStars returns when the asker made each song a favourite. Without an answer from Navidrome the hearts stay empty,
// never someone else's.
func (s *Server) myStars(ctx context.Context, cred subsonic.Cred) map[string]string {
	k := strings.ToLower(cred.User)
	s.mu.Lock()
	cached, ok := s.stars[k]
	s.mu.Unlock()
	if ok && time.Since(cached.at) < snapshotTTL {
		return cached.stars
	}
	songs, err := s.nd.Starred(ctx, cred)
	if err != nil {
		return nil
	}
	stars := make(map[string]string, len(songs))
	for _, song := range songs {
		stars[song.ID] = song.Starred
	}
	s.mu.Lock()
	if s.stars == nil {
		s.stars = map[string]starsEntry{}
	}
	s.stars[k] = starsEntry{time.Now(), stars}
	s.mu.Unlock()
	return stars
}

// forgetStars makes the next list ask Navidrome for this person's stars again.
func (s *Server) forgetStars(user string) {
	s.mu.Lock()
	delete(s.stars, strings.ToLower(user))
	s.mu.Unlock()
}

// withStars gives songs of the shared library the asker's own hearts.
func withStars(songs []songOut, stars map[string]string) []songOut {
	for i := range songs {
		songs[i].Starred = stars[songs[i].ID]
	}
	return songs
}

// importWithStars gives the songs of an imported list the asker's own hearts.
func importWithStars(out importOut, stars map[string]string) importOut {
	for _, row := range out.Rows {
		if row.Library != nil {
			row.Library.Starred = stars[row.Library.ID]
		}
	}
	return out
}

// passStar hands a favourite, or its removal, to Navidrome. Once Navidrome has accepted it, which proves who sent it,
// the next list asks for that person's stars again.
func (s *Server) passStar(w http.ResponseWriter, r *http.Request) {
	cred, signed := subsonic.FromQuery(r.URL.Query())
	r.Header.Del("Accept-Encoding") // the answer must arrive readable; it is tiny anyway
	answer := &answerCopy{ResponseWriter: w}
	s.proxy.ServeHTTP(answer, r)
	if signed && accepted(answer.status, answer.body.Bytes()) {
		s.forgetStars(cred.User)
	}
}
