package server

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Shows (podcasts) and books (audiobooks): what episodes and parts belong to. Everyone can make one and add to any;
// changing or deleting one is for whoever made it, or an administrator. The routes are /api/shows and /api/books
// rather than /api/media/collections/{id}, which would overlap /api/media/{id}/file and make ServeMux panic.

// collectionOut is a show or book with what a list of them needs to say about its contents.
type collectionOut struct {
	media.Collection
	Count    int    `json:"count"`
	Duration int    `json:"duration"`
	Latest   int64  `json:"latest"`          // when its newest item was added
	Thumb    string `json:"thumb,omitempty"` // the item whose picture stands in when it has none of its own
	CanEdit  bool   `json:"can_edit"`
}

func summarise(c media.Collection, items []media.Item, canEdit bool) collectionOut {
	out := collectionOut{Collection: c, Count: len(items), CanEdit: canEdit}
	for _, it := range items {
		out.Duration += it.Duration
		if it.AddedAt > out.Latest {
			out.Latest = it.AddedAt
		}
		if out.Thumb == "" && it.Thumb != "" {
			out.Thumb = it.ID
		}
	}
	return out
}

// isAdmin asks Navidrome. When it cannot answer, the person is treated as not one: these checks guard changes.
func (s *Server) isAdmin(r *http.Request, cred subsonic.Cred) bool {
	admin, err := s.nd.IsAdmin(r.Context(), cred)
	return err == nil && admin
}

// mayChange tells whether cred may change something made by owner. Things nobody made (from before this was
// recorded, or grouped by themselves) are an administrator's.
func (s *Server) mayChange(r *http.Request, cred subsonic.Cred, owner string) bool {
	if owner != "" && strings.EqualFold(owner, cred.User) {
		return true
	}
	return s.isAdmin(r, cred)
}

// collectionRoutes registers the routes of one kind under prefix.
func (s *Server) collectionRoutes(mux *http.ServeMux, prefix, kind string) {
	mux.HandleFunc("GET "+prefix, s.authed(s.listCollections(kind)))
	mux.HandleFunc("POST "+prefix, s.authed(s.createCollection(kind)))
	mux.HandleFunc("GET "+prefix+"/{id}", s.authed(s.getCollection(kind)))
	mux.HandleFunc("PATCH "+prefix+"/{id}", s.authed(s.editCollection(kind)))
	mux.HandleFunc("DELETE "+prefix+"/{id}", s.authed(s.deleteCollection(kind)))
	mux.HandleFunc("GET "+prefix+"/{id}/cover", s.authed(s.collectionCover(kind)))
	mux.HandleFunc("PUT "+prefix+"/{id}/cover", s.authed(s.setCollectionCover(kind)))
	mux.HandleFunc("DELETE "+prefix+"/{id}/cover", s.authed(s.removeCollectionCover(kind)))
}

// findCollection reads the collection in the path, answering 404 when it is not one of this kind.
func (s *Server) findCollection(w http.ResponseWriter, r *http.Request, kind string) (media.Collection, bool) {
	c, err := s.media.Collection(r.PathValue("id"))
	if err != nil || c.Kind != kind {
		fail(w, http.StatusNotFound, "not found")
		return c, false
	}
	return c, true
}

func (s *Server) listCollections(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		byParent := map[string][]media.Item{}
		for _, it := range s.media.List(kind) {
			byParent[it.Parent] = append(byParent[it.Parent], it)
		}
		admin := s.isAdmin(r, cred)
		out := []collectionOut{}
		for _, c := range s.media.Collections(kind) {
			mine := c.CreatedBy != "" && strings.EqualFold(c.CreatedBy, cred.User)
			out = append(out, summarise(c, media.Order(c, byParent[c.ID]), admin || mine))
		}
		respond(w, http.StatusOK, map[string]any{"collections": out})
	}
}

func readCollection(w http.ResponseWriter, r *http.Request) (media.Collection, bool) {
	var c media.Collection
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&c); err != nil {
		fail(w, http.StatusBadRequest, "could not read the details")
		return c, false
	}
	return c, true
}

func (s *Server) createCollection(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		in, ok := readCollection(w, r)
		if !ok {
			return
		}
		in.Kind = kind
		c, err := s.media.CreateCollection(in, cred.User)
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		respond(w, http.StatusCreated, summarise(c, nil, true))
	}
}

func (s *Server) getCollection(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		c, ok := s.findCollection(w, r, kind)
		if !ok {
			return
		}
		items := s.media.Items(c)
		respond(w, http.StatusOK, map[string]any{"collection": summarise(c, items, s.mayChange(r, cred, c.CreatedBy)), "items": items})
	}
}

func (s *Server) editCollection(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		c, ok := s.findCollection(w, r, kind)
		if !ok {
			return
		}
		if !s.mayChange(r, cred, c.CreatedBy) {
			fail(w, http.StatusForbidden, "Only whoever made it, or an administrator, can change it")
			return
		}
		in, ok := readCollection(w, r)
		if !ok {
			return
		}
		c, err := s.media.UpdateCollection(c.ID, in)
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		respond(w, http.StatusOK, summarise(c, s.media.Items(c), true))
	}
}

func (s *Server) deleteCollection(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		c, ok := s.findCollection(w, r, kind)
		if !ok {
			return
		}
		if !s.mayChange(r, cred, c.CreatedBy) {
			fail(w, http.StatusForbidden, "Only whoever made it, or an administrator, can delete it")
			return
		}
		if err := s.media.DeleteCollection(c.ID); err != nil {
			fail(w, http.StatusConflict, err.Error())
			return
		}
		respond(w, http.StatusOK, map[string]bool{"deleted": true})
	}
}

// collectionCover serves its own picture, or else the picture of its first item that has one.
func (s *Server) collectionCover(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
		c, ok := s.findCollection(w, r, kind)
		if !ok {
			return
		}
		if c.Cover > 0 {
			serveJPEG(w, r, s.media.CoverPath(c.ID))
			return
		}
		for _, it := range s.media.Items(c) {
			if it.Thumb == "" {
				continue
			}
			f, err := os.Open(s.media.Path(it, it.Thumb))
			if err != nil {
				continue
			}
			defer f.Close()
			st, _ := f.Stat()
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Cache-Control", "private, max-age=3600")
			http.ServeContent(w, r, "", st.ModTime(), f)
			return
		}
		http.NotFound(w, r)
	}
}

func (s *Server) setCollectionCover(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		c, ok := s.findCollection(w, r, kind)
		if !ok {
			return
		}
		if !s.mayChange(r, cred, c.CreatedBy) {
			fail(w, http.StatusForbidden, "Only whoever made it, or an administrator, can change its picture")
			return
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, userdata.MaxCoverBytes+1))
		if err != nil {
			fail(w, http.StatusBadRequest, "could not read the picture")
			return
		}
		if err := userdata.SaveJPEG(s.media.CoverPath(c.ID), data); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		c, err = s.media.CoverSet(c.ID, true)
		answerCollection(w, c, err)
	}
}

func (s *Server) removeCollectionCover(kind string) apiHandler {
	return func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
		c, ok := s.findCollection(w, r, kind)
		if !ok {
			return
		}
		if !s.mayChange(r, cred, c.CreatedBy) {
			fail(w, http.StatusForbidden, "Only whoever made it, or an administrator, can change its picture")
			return
		}
		c, err := s.media.CoverSet(c.ID, false)
		answerCollection(w, c, err)
	}
}

func answerCollection(w http.ResponseWriter, c media.Collection, err error) {
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, c)
}

// ---- One item: its details and its chapters ----

// editMedia changes an item's title, text, or which show or book it is in (and where in the book). Whoever added
// it, or an administrator.
func (s *Server) editMedia(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	it, err := s.media.Find(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	if !s.mayChange(r, cred, it.AddedBy) {
		fail(w, http.StatusForbidden, "Only whoever added it, or an administrator, can change it")
		return
	}
	var in struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Parent      *string `json:"parent"`
		Part        *int    `json:"part"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "could not read the details")
		return
	}
	if in.Title != nil {
		if t := media.Clip(*in.Title, 200); t != "" {
			it.Title = t
		}
	}
	if in.Description != nil {
		it.Description = media.Clip(*in.Description, 5000)
	}
	if in.Parent != nil && *in.Parent != it.Parent {
		c, err := s.media.Collection(*in.Parent)
		if err != nil || c.Kind != it.Kind {
			fail(w, http.StatusBadRequest, "that show or book does not exist")
			return
		}
		it.Parent, it.Part = c.ID, 0
		if c.Kind == "audiobook" {
			it.Part = s.media.NextPart(c)
		}
	}
	if in.Part != nil && *in.Part > 0 && *in.Part < 100000 && it.Kind == "audiobook" {
		it.Part = *in.Part
	}
	if err := s.media.Save(it); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, it)
}

func (s *Server) mediaChapters(w http.ResponseWriter, r *http.Request, _ subsonic.Cred) {
	it, err := s.media.Find(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	respond(w, http.StatusOK, map[string]any{"chapters": s.media.Chapters(it)})
}

type chapterIn struct {
	Start float64 `json:"start"`
	Title string  `json:"title"`
}

func readChapter(w http.ResponseWriter, r *http.Request) (chapterIn, bool) {
	var in chapterIn
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "could not read the chapter")
		return in, false
	}
	return in, true
}

// addChapter marks a chapter. Anyone signed in may: everyone sees it, which is the point.
func (s *Server) addChapter(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	it, err := s.media.Find(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	in, ok := readChapter(w, r)
	if !ok {
		return
	}
	list, err := s.media.AddChapter(it, in.Start, in.Title, cred.User)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"chapters": list})
}

// changeChapter renames a chapter, or removes it when the title is empty.
func (s *Server) changeChapter(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	it, err := s.media.Find(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	in, ok := readChapter(w, r)
	if !ok {
		return
	}
	list, err := s.media.ChangeChapter(it, in.Start, in.Title, cred.User, s.isAdmin(r, cred))
	switch {
	case errors.Is(err, media.ErrNotYours):
		fail(w, http.StatusForbidden, err.Error())
	case errors.Is(err, fs.ErrNotExist):
		fail(w, http.StatusNotFound, "there is no chapter at "+strconv.FormatFloat(in.Start, 'f', 1, 64)+" s")
	case err != nil:
		fail(w, http.StatusInternalServerError, err.Error())
	default:
		respond(w, http.StatusOK, map[string]any{"chapters": list})
	}
}
