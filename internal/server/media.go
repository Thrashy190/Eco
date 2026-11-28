package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/ytdlp"
)

// Only YouTube links are accepted. yt-dlp can fetch from thousands of sites, but letting a logged-in user
// make the server request arbitrary addresses would turn eco into a way to probe your home network.
var youtubeHosts = map[string]bool{
	"youtube.com": true, "www.youtube.com": true, "m.youtube.com": true, "music.youtube.com": true, "youtu.be": true,
}

func youtubeURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !youtubeHosts[strings.ToLower(u.Hostname())] {
		return "", errors.New("paste a YouTube link (youtube.com or youtu.be)")
	}
	if strings.HasPrefix(u.Path, "/playlist") {
		return "", errors.New("that is a playlist; paste the link of one video")
	}
	return u.String(), nil
}

type mediaPayload struct {
	Cred       subsonic.Cred
	URL        string
	Prev       ytdlp.Preview
	Kind       string
	Collection string // the show or book it goes into; empty groups it by channel (media.Adopt)
}

func previewOf(p ytdlp.Preview, existing *media.Item) map[string]any {
	out := map[string]any{"id": p.ID, "title": p.Title, "channel": p.Channel, "duration": int(p.DurationSec), "thumbnail": p.Thumbnail, "live": p.Live,
		"chapters": len(p.Chapters), "published": p.Published}
	if existing != nil {
		out["existing"] = existing
	}
	if p.Music.Track != "" {
		out["music"] = p.Music
	}
	return out
}

// mediaPreview shows what a link is before the user decides to import it.
func (s *Server) mediaPreview(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
	link, err := youtubeURL(r.URL.Query().Get("url"))
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	p, err := s.eng.YT.Preview(ctx, link)
	if err != nil {
		fail(w, http.StatusBadGateway, err.Error())
		return
	}
	var existing *media.Item
	if it, err := s.media.Find(p.ID); err == nil {
		existing = &it
	}
	respond(w, http.StatusOK, previewOf(p, existing))
}

// mediaImport queues a download. The same video is never imported twice.
func (s *Server) mediaImport(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	q := r.URL.Query()
	link, err := youtubeURL(q.Get("url"))
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	kind := q.Get("kind")
	if !media.ValidKind(kind) {
		fail(w, http.StatusBadRequest, "kind must be one of: "+strings.Join(media.Kinds, ", "))
		return
	}
	collection := q.Get("collection")
	if collection != "" {
		if c, err := s.media.Collection(collection); err != nil || c.Kind != kind {
			fail(w, http.StatusBadRequest, "that show or book does not exist")
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	prev, err := s.eng.YT.Preview(ctx, link)
	if err != nil {
		fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if prev.Live {
		fail(w, http.StatusBadRequest, "live streams cannot be imported")
		return
	}
	if it, err := s.media.Find(prev.ID); err == nil {
		respond(w, http.StatusOK, map[string]any{"existing": it})
		return
	}
	job, isNew := s.jobs.SubmitWith("media:"+prev.ID, cred.User, mediaPayload{cred, link, prev, kind, collection}, func(j *jobs.Job) {
		j.Kind, j.Title, j.Artist, j.MediaID = kind, prev.Title, prev.Channel, prev.ID
	})
	code := http.StatusOK
	if isNew {
		code = http.StatusAccepted
	}
	respond(w, code, job)
}

func (s *Server) runMedia(ctx context.Context, p mediaPayload, set func(func(*jobs.Job))) error {
	set(func(j *jobs.Job) { j.State = jobs.Downloading })
	dir := s.media.Dir(p.Kind, p.Prev.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	files, err := s.eng.YT.DownloadMedia(ctx, p.URL, dir, func(pct float64) {
		set(func(j *jobs.Job) { j.Progress = pct })
	})
	if err != nil {
		os.RemoveAll(dir) // never leave a half-finished item behind
		return err
	}
	var size int64
	if st, err := os.Stat(filepath.Join(dir, files.Media)); err == nil {
		size = st.Size()
	}
	item := media.Item{ID: p.Prev.ID, Kind: p.Kind, Title: p.Prev.Title, Channel: p.Prev.Channel, Source: p.URL,
		Duration: int(p.Prev.DurationSec), Size: size, AddedAt: time.Now().Unix(), File: files.Media, Thumb: files.Thumb,
		AddedBy: p.Cred.User, Description: media.Clip(p.Prev.Description, 5000), Published: p.Prev.Published}
	if err := s.fileUnder(&item, p.Collection); err != nil {
		os.RemoveAll(dir)
		return err
	}
	if err := s.media.Save(item); err != nil {
		os.RemoveAll(dir)
		return err
	}
	chapters := make([]media.Chapter, len(p.Prev.Chapters))
	for i, c := range p.Prev.Chapters {
		chapters[i] = media.Chapter{Start: c.Start, Title: c.Title}
	}
	if err := s.media.SetSourceChapters(item, chapters); err != nil {
		log.Printf("keeping the chapters of %s: %v", item.ID, err) // the audio is there; the chapters can be marked again
	}
	return nil
}

// fileUnder puts an item into the chosen show or book, or one named after its channel. The show may have been deleted
// while the download ran; then it is grouped by channel, rather than losing the download.
func (s *Server) fileUnder(it *media.Item, collection string) error {
	if !media.HasCollections(it.Kind) {
		return nil
	}
	if c, err := s.media.Collection(collection); err == nil && c.Kind == it.Kind {
		it.Parent = c.ID
		if c.Kind == "audiobook" {
			it.Part = s.media.NextPart(c)
		}
		return nil
	}
	return s.media.Adopt(it)
}

func (s *Server) mediaList(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
	kind := r.URL.Query().Get("kind")
	if kind != "" && !media.ValidKind(kind) {
		fail(w, http.StatusBadRequest, "unknown kind")
		return
	}
	items := s.media.List(kind)
	if items == nil {
		items = []media.Item{}
	}
	respond(w, http.StatusOK, map[string]any{"items": items})
}

// mediaFile serves an item's media or thumbnail. ServeContent handles Range requests, which seeking needs.
func (s *Server) mediaFile(thumb bool) func(http.ResponseWriter, *http.Request, subsonic.Cred) {
	return func(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
		it, err := s.media.Find(r.PathValue("id"))
		name := it.File
		if thumb {
			name = it.Thumb
		}
		if err != nil || name == "" {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(s.media.Path(it, name))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, _ := f.Stat()
		w.Header().Set("Content-Type", map[string]string{".m4a": "audio/mp4", ".jpg": "image/jpeg"}[strings.ToLower(filepath.Ext(name))])
		if thumb {
			w.Header().Set("Cache-Control", "private, max-age=86400")
		}
		http.ServeContent(w, r, name, st.ModTime(), f)
	}
}

// mediaDelete erases an item for everyone: whoever added it, or an administrator.
func (s *Server) mediaDelete(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	it, err := s.media.Find(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	if !s.mayChange(r, cred, it.AddedBy) {
		fail(w, http.StatusForbidden, "Only whoever added it, or an administrator, can delete it")
		return
	}
	if err := s.media.Delete(it.ID); err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	respond(w, http.StatusOK, map[string]bool{"deleted": true})
}
