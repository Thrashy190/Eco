package server

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// Podcast episodes and audiobooks sent from a device, in pieces (internal/media/upload.go). Anyone signed in may send
// one; the file is checked with ffprobe before it joins the library, and only audio is kept.

func (s *Server) maxUpload() int64 {
	if s.cfg.MaxUploadMB > 0 {
		return s.cfg.MaxUploadMB << 20
	}
	return 4096 << 20
}

func (s *Server) startUpload(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var in struct {
		Kind       string `json:"kind"`
		Collection string `json:"collection"`
		Name       string `json:"name"`
		Size       int64  `json:"size"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "could not read the details")
		return
	}
	if in.Collection != "" {
		if c, err := s.media.Collection(in.Collection); err != nil || c.Kind != in.Kind {
			fail(w, http.StatusBadRequest, "that show or book does not exist")
			return
		}
	}
	s.media.CleanUploads(24 * time.Hour)
	u, err := s.media.StartUpload(media.Upload{User: cred.User, Kind: in.Kind, Collection: in.Collection, Name: in.Name, Size: in.Size}, s.maxUpload())
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusCreated, map[string]any{"upload": u, "chunk": media.ChunkSize})
}

func (s *Server) uploadStatus(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	u, err := s.media.GetUpload(r.PathValue("id"), cred.User)
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	respond(w, http.StatusOK, u)
}

// uploadPiece takes the piece that starts at ?offset=. A piece already received answers 409 with where to go on.
func (s *Server) uploadPiece(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || offset < 0 {
		fail(w, http.StatusBadRequest, "say where the piece starts (offset)")
		return
	}
	u, err := s.media.AppendUpload(r.PathValue("id"), cred.User, offset, http.MaxBytesReader(w, r.Body, media.ChunkSize+1))
	switch {
	case errors.Is(err, media.ErrNoUpload):
		fail(w, http.StatusNotFound, "not found")
	case errors.Is(err, media.ErrWrongOffset):
		respond(w, http.StatusConflict, u)
	case err != nil:
		fail(w, http.StatusBadRequest, err.Error())
	default:
		respond(w, http.StatusOK, u)
	}
}

func (s *Server) cancelUpload(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if err := s.media.CancelUpload(r.PathValue("id"), cred.User); err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	respond(w, http.StatusOK, map[string]bool{"cancelled": true})
}

// finishUpload checks the whole file and files it: under its show or book (or one named after its artist tag), with
// the title, chapters and picture inside it. Anything that is not audio is thrown away.
func (s *Server) finishUpload(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	u, dir, err := s.media.TakeUpload(r.PathValue("id"), cred.User)
	if errors.Is(err, media.ErrNoUpload) {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	data := filepath.Join(dir, "data")
	ffprobe, ffmpeg := s.cfg.FFprobe, s.cfg.FFmpeg
	if ffprobe == "" {
		ffprobe = "ffprobe"
	}
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	p, err := media.Probe(r.Context(), ffprobe, data, u.Name)
	if err != nil {
		os.RemoveAll(dir)
		fail(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	title := p.Title
	if title == "" {
		title = strings.TrimSuffix(u.Name, filepath.Ext(u.Name))
	}
	channel := p.Artist
	if channel == "" {
		channel = p.Album
	}
	thumb := ""
	if p.Picture && media.ExtractPicture(r.Context(), ffmpeg, data, filepath.Join(dir, "media.jpg")) == nil {
		thumb = "media.jpg"
	}
	it := media.Item{ID: media.NewItemID(), Kind: u.Kind, Title: media.Clip(title, 200), Channel: media.Clip(channel, 200), Source: "upload",
		Duration: int(p.Duration), Size: u.Size, AddedAt: time.Now().Unix(), AddedBy: cred.User, Description: media.Clip(p.Comment, 5000)}
	if err := s.fileUnder(&it, u.Collection); err != nil {
		os.RemoveAll(dir)
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.media.FileItem(it, dir, "media"+p.Ext, thumb); err != nil {
		os.RemoveAll(dir)
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	it, _ = s.media.Find(it.ID)
	if err := s.media.SetSourceChapters(it, p.Chapters); err != nil {
		log.Printf("keeping the chapters of %s: %v", it.ID, err)
	}
	respond(w, http.StatusCreated, it)
}
