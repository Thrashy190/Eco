package server

import (
	"bytes"
	"image"
	"net/http"
	"os"
	"strconv"
	"sync"

	"github.com/Thrashy190/eco/internal/coverart"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// shapeCache keeps the covers already cut, up to a budget: a TV's home screen asks for dozens at once, and again each
// time it opens.
type shapeCache struct {
	mu    sync.Mutex
	items map[string][]byte
	order []string
	bytes int
}

const shapeBudget = 48 << 20

func (c *shapeCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, ok := c.items[key]
	return data, ok
}

func (c *shapeCache) put(key string, data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.items == nil {
		c.items = map[string][]byte{}
	}
	if _, ok := c.items[key]; ok {
		return
	}
	for c.bytes+len(data) > shapeBudget && len(c.order) > 0 {
		oldest := c.order[0]
		c.order = c.order[1:]
		c.bytes -= len(c.items[oldest])
		delete(c.items, oldest)
	}
	c.items[key] = data
	c.order = append(c.order, key)
	c.bytes += len(data)
}

// shapedCover is a cover cut to the web app's shape (soft or sharp corners, or round), as a PNG with transparent
// corners, for the Roku app (internal/coverart). The picture is Navidrome's cover art (id=) or a playlist picture
// chosen in Eco (playlist=), which only its owner sees, like /api/covers/playlists.
func (s *Server) shapedCover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := r.URL.Query()
	shape := q.Get("shape")
	size, err := strconv.Atoi(q.Get("size"))
	if !coverart.ValidShape(shape) || err != nil || size < 32 || size > 800 {
		fail(w, http.StatusBadRequest, "shape must be soft, sharp or circle, and size 32 to 800")
		return
	}
	id, playlist := q.Get("id"), q.Get("playlist")
	var key string
	switch {
	case playlist != "" && userdata.ValidID(playlist):
		key = "p\x00" + cred.User + "\x00" + playlist + "\x00" + q.Get("cover")
	case id != "" && len(id) <= 200:
		key = "c\x00" + id
	default:
		fail(w, http.StatusBadRequest, "id or playlist is required")
		return
	}
	key += "\x00" + shape + "\x00" + strconv.Itoa(size)

	data, ok := s.shapes.get(key)
	if !ok {
		var raw []byte
		if playlist != "" {
			raw, err = os.ReadFile(s.users.CoverPath(cred.User, playlist))
		} else {
			raw, err = s.nd.CoverArt(r.Context(), cred, id, size)
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
		img, _, err := image.Decode(bytes.NewReader(raw))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if data, err = coverart.PNG(coverart.Cut(img, size, shape)); err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.shapes.put(key, data)
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(data)
}
