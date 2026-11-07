package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/tag"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Library clean-up, for administrators: copies of the same song, "artists" that are really several people because
// a tag said "Bad Bunny, Chuwi", and albums with no cover or doubtful tags (cleanupalbums.go). eco only proposes. Everything here happens when an administrator asks for it.

// ---- Duplicates ----

type duplicateSong struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Cover    string `json:"cover,omitempty"`
	Duration int    `json:"duration"`
	Size     int64  `json:"size"`
	Starred  bool   `json:"starred"`
}

type duplicateGroup struct {
	Keep  string          `json:"keep"` // the copy eco suggests keeping
	Songs []duplicateSong `json:"songs"`
}

// sameLengthSeconds is how far apart two copies of a song can be. Further than that, it is another take.
const sameLengthSeconds = 3

// findDuplicates lists songs held more than once: same title, version and first artist, and about the same length. The
// copy suggested is the one on the fullest album, since the other is usually the single it also came out on.
func findDuplicates(songs []subsonic.Song) []duplicateGroup {
	onAlbum := map[string]int{}
	byName := map[string][]subsonic.Song{}
	for _, s := range songs {
		onAlbum[s.AlbumID]++
		key := match.Norm(s.Title) + "|" + match.FirstArtist(s.Artist)
		byName[key] = append(byName[key], s)
	}
	keys := make([]string, 0, len(byName))
	for key := range byName {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	groups := []duplicateGroup{}
	for _, key := range keys {
		same := byName[key]
		sort.SliceStable(same, func(i, j int) bool { return same[i].Duration < same[j].Duration })
		for start := 0; start < len(same); {
			end := start + 1
			for end < len(same) && same[end].Duration-same[end-1].Duration <= sameLengthSeconds && match.SameVersion(same[start].Title, same[end].Title) {
				end++
			}
			if end-start > 1 {
				groups = append(groups, duplicateGroupOf(same[start:end], onAlbum))
			}
			start = end
		}
	}
	return groups
}

func duplicateGroupOf(copies []subsonic.Song, onAlbum map[string]int) duplicateGroup {
	ordered := slices.Clone(copies)
	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		if onAlbum[a.AlbumID] != onAlbum[b.AlbumID] {
			return onAlbum[a.AlbumID] > onAlbum[b.AlbumID]
		}
		if (a.Starred != "") != (b.Starred != "") {
			return a.Starred != ""
		}
		return a.Size > b.Size
	})
	group := duplicateGroup{Keep: ordered[0].ID}
	for _, s := range ordered {
		group.Songs = append(group.Songs, duplicateSong{s.ID, s.Title, s.Artist, s.Album, s.CoverArt, s.Duration, s.Size, s.Starred != ""})
	}
	return group
}

// cleanupDuplicate deletes the other copies of a song. The person doing it keeps what they had on them: their favourite
// and their playlists move to the copy that stays. Other people's cannot be read, and go with the file.
func (s *Server) cleanupDuplicate(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var body struct {
		Keep   string   `json:"keep"`
		Remove []string `json:"remove"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil || !userdata.ValidID(body.Keep) || len(body.Remove) == 0 {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	for _, id := range body.Remove {
		if !userdata.ValidID(id) || id == body.Keep {
			fail(w, http.StatusBadRequest, "invalid song id")
			return
		}
	}
	session, ok := s.admins.get(cred.User) // removing a copy deletes it in Navidrome too (see deleteSong)
	if !ok {
		askForPassword(w)
		return
	}
	ctx := r.Context()
	keep, err := s.nd.Song(ctx, cred, body.Keep)
	if err != nil {
		fail(w, http.StatusConflict, "The copy to keep is no longer in the library")
		return
	}
	deleted := []string{}
	for _, id := range body.Remove {
		song, err := s.nd.Song(ctx, cred, id)
		if err != nil {
			continue // already gone
		}
		// Refusing here is what stands between a look-alike and a lost song, whatever the app sent
		if match.Norm(song.Title) != match.Norm(keep.Title) || match.FirstArtist(song.Artist) != match.FirstArtist(keep.Artist) {
			fail(w, http.StatusBadRequest, "These are not copies of the same song")
			return
		}
		// Before anything changes: a copy that cannot be identified must stay exactly as it was, favourite and all
		if _, err := library.FindSongFile(s.cfg.MusicDir, song.Size, song.Suffix, song.Title); err != nil {
			fail(w, http.StatusConflict, "Nothing was deleted: "+err.Error())
			return
		}
		if song.Starred != "" && keep.Starred == "" {
			if err := s.nd.Star(ctx, cred, keep.ID); err == nil {
				keep.Starred = song.Starred
			}
		}
		if err := s.movePlaylistEntries(ctx, cred, id, keep.ID); err != nil {
			fail(w, http.StatusBadGateway, "Nothing was deleted: "+err.Error())
			return
		}
		gone, code, err := s.removeSong(ctx, cred, session, id)
		if err != nil {
			fail(w, code, err.Error())
			return
		}
		deleted = append(deleted, gone.File)
	}
	respond(w, http.StatusOK, map[string]any{"deleted": deleted})
}

// movePlaylistEntries points this user's playlists at the copy that stays.
func (s *Server) movePlaylistEntries(ctx context.Context, cred subsonic.Cred, from, to string) error {
	lists, err := s.nd.Playlists(ctx, cred)
	if err != nil {
		return err
	}
	for _, list := range lists {
		songs, err := s.nd.PlaylistSongs(ctx, cred, list.ID)
		if err != nil {
			continue
		}
		ids := make([]string, 0, len(songs))
		changed := false
		for _, song := range songs {
			id := song.ID
			if id == from {
				id, changed = to, true
			}
			if !slices.Contains(ids, id) || id != to {
				ids = append(ids, id)
			}
		}
		if changed {
			// A playlist of somebody else's that this user can see is theirs to change: Navidrome refuses, and nothing is lost
			if _, err := s.nd.SavePlaylist(ctx, cred, list.ID, list.Name, ids); err != nil {
				var refused *subsonic.APIError
				if !errors.As(err, &refused) {
					return err
				}
			}
		}
	}
	return nil
}

// ---- Artists ----

type artistFix struct {
	Name  string   `json:"name"`
	Parts []string `json:"parts"`
	Songs int      `json:"songs"`
	// Sure is false when nothing else in the library suggests the pieces are artists: "Tyler, The Creator" is one.
	Sure bool `json:"sure"`
}

func splitNames(name string) []string {
	parts := strings.Split(name, ", ")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// knownArtistNames says who counts as an artist: anyone listed alone, or named in more than one group. The same rule as
// knownArtists in the web app.
func knownArtistNames(names []string) map[string]bool {
	known := map[string]bool{}
	inGroups := map[string]int{}
	for _, name := range names {
		if !strings.Contains(name, ", ") {
			known[match.Norm(name)] = true
			continue
		}
		for _, part := range splitNames(name) {
			key := match.Norm(part)
			if inGroups[key]++; inGroups[key] > 1 {
				known[key] = true
			}
		}
	}
	return known
}

// findCombinedArtists lists artist names that hold a comma, and how they would split.
func findCombinedArtists(songs []subsonic.Song) []artistFix {
	count := map[string]int{}
	seen := map[string]bool{}
	var names []string
	add := func(tag string) {
		for _, name := range strings.Split(tag, "; ") { // already separated: each one is a name of its own
			if name != "" && !seen[name] {
				seen[name] = true
				names = append(names, name)
			}
		}
	}
	// A tag that already uses "; " was separated before, by hand or here: a comma left in it belongs to a name
	// ("Tyler, The Creator; Kali Uchis"), so it is not offered again
	combined := func(tag string) bool { return strings.Contains(tag, ", ") && !strings.Contains(tag, "; ") }
	for _, song := range songs {
		add(song.Artist)
		add(song.AlbumArtist)
		if combined(song.Artist) {
			count[song.Artist]++
		}
		if song.AlbumArtist != song.Artist && combined(song.AlbumArtist) {
			count[song.AlbumArtist]++
		}
	}
	known := knownArtistNames(names)
	out := []artistFix{}
	for name, n := range count {
		parts := splitNames(name)
		sure := false
		for _, part := range parts {
			sure = sure || known[match.Norm(part)]
		}
		out = append(out, artistFix{name, parts, n, sure})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Sure != out[j].Sure {
			return out[i].Sure
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// retagTask is the artist clean-up: it can take minutes, longer than a tunnel keeps a request open.
type retagTask struct {
	Running bool         `json:"running"`
	Done    int          `json:"done"`
	Total   int          `json:"total"`
	Failed  []retagError `json:"failed"`
	Backup  string       `json:"backup,omitempty"`
}

type retagError struct {
	Title string `json:"title"`
	Error string `json:"error"`
}

func (s *Server) cleanupReport(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	songs, err := s.nd.AllSongs(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	s.mu.Lock()
	task := s.retag
	s.mu.Unlock()
	respond(w, http.StatusOK, map[string]any{"songs": len(songs), "duplicates": findDuplicates(songs), "artists": findCombinedArtists(songs), "albums": s.albumIssues(songs), "task": task})
}

// separated writes a chosen name with the separator Navidrome splits on, between the parts chosen for it. Anything
// else stays as it is.
func separated(name string, chosen map[string][]string) string {
	parts, ok := chosen[name]
	if !ok {
		return ""
	}
	return strings.Join(parts, tag.Separator)
}

// chosenParts decides how each chosen name splits: at every comma, unless the request says where. A name can hold a
// comma ("Tyler, The Creator, Kali Uchis" is two artists, not three), but the parts may only move the separators: put
// back together with commas they must give the name exactly, so no word of a tag can change.
func chosenParts(names []string, parts map[string][]string) map[string][]string {
	chosen := map[string][]string{}
	for _, name := range names {
		split := splitNames(name)
		if given, ok := parts[name]; ok {
			if strings.Join(given, ", ") != name {
				continue
			}
			split = given
		}
		if len(split) > 1 {
			chosen[name] = split
		}
	}
	return chosen
}

// cleanupArtists starts rewriting the artist tags of the songs with the chosen names. It keeps a copy of every file it
// changes, and only replaces a file once the audio of the new one is proven identical (tag.SetArtists). In tests on a
// real Navidrome, songs kept their IDs, favourites and playlists; albums whose album artist changes get a new ID.
func (s *Server) cleanupArtists(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var body struct {
		Names []string            `json:"names"`
		Parts map[string][]string `json:"parts"` // optional: where a name splits, when not at every comma
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil || len(body.Names) == 0 {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	chosen := chosenParts(body.Names, body.Parts)
	songs, err := s.nd.AllSongs(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	var todo []subsonic.Song
	for _, song := range songs {
		_, artist := chosen[song.Artist]
		_, albumArtist := chosen[song.AlbumArtist]
		if artist || albumArtist {
			todo = append(todo, song)
		}
	}
	if len(todo) == 0 {
		fail(w, http.StatusBadRequest, "No songs have those artists")
		return
	}
	backup := filepath.Join(s.cfg.DataDir, "backup", "artists-"+time.Now().Format("2006-01-02-150405"))
	s.mu.Lock()
	if s.retag.Running {
		s.mu.Unlock()
		fail(w, http.StatusConflict, "A clean-up is already running")
		return
	}
	s.retag = retagTask{Running: true, Total: len(todo), Failed: []retagError{}, Backup: library.Rel(s.cfg.DataDir, backup)}
	task := s.retag
	s.mu.Unlock()
	log.Printf("admin %s is separating the artists of %d songs (backup in %s)", cred.User, len(todo), backup)
	go s.runRetag(cred, todo, chosen, backup)
	respond(w, http.StatusAccepted, task)
}

func (s *Server) runRetag(cred subsonic.Cred, todo []subsonic.Song, chosen map[string][]string, backup string) {
	for _, song := range todo {
		err := s.ctx.Err()
		if err == nil {
			err = s.retagSong(song, chosen, backup)
		}
		s.mu.Lock()
		s.retag.Done++
		if err != nil {
			s.retag.Failed = append(s.retag.Failed, retagError{song.Title, err.Error()})
		}
		s.mu.Unlock()
	}
	s.rescan(s.ctx, cred)
	s.forgetLibrary()
	s.mu.Lock()
	s.retag.Running = false
	log.Printf("artist clean-up finished: %d songs, %d failed", s.retag.Total, len(s.retag.Failed))
	s.mu.Unlock()
}

func (s *Server) retagSong(song subsonic.Song, chosen map[string][]string, backup string) error {
	path, err := library.FindSongFile(s.cfg.MusicDir, song.Size, song.Suffix, song.Title)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 2*time.Minute)
	defer cancel()
	saved := filepath.Join(backup, library.Rel(s.cfg.MusicDir, path))
	return tag.SetArtists(ctx, s.cfg.FFmpeg, path, separated(song.Artist, chosen), separated(song.AlbumArtist, chosen), saved)
}
