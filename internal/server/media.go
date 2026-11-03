package server

import (
	"context"
	"errors"
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
	Cred subsonic.Cred
	URL  string
	Prev ytdlp.Preview
	Kind string
}

func previewOf(p ytdlp.Preview, existing *media.Item) map[string]any {
	out := map[string]any{"id": p.ID, "title": p.Title, "channel": p.Channel, "duration": int(p.DurationSec), "thumbnail": p.Thumbnail, "live": p.Live}
	if existing != nil {
		out["existing"] = existing
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
	job, isNew := s.jobs.SubmitWith("media:"+prev.ID, cred.User, mediaPayload{cred, link, prev, kind}, func(j *jobs.Job) {
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
		Duration: int(p.Prev.DurationSec), Size: size, AddedAt: time.Now().Unix(), File: files.Media, Thumb: files.Thumb}
	if err := s.media.Save(item); err != nil {
		os.RemoveAll(dir)
		return err
	}
	return nil
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

func (s *Server) mediaDelete(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
	if err := s.media.Delete(r.PathValue("id")); err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	respond(w, http.StatusOK, map[string]bool{"deleted": true})
}
