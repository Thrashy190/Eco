package server

import (
	"bytes"
	"image"
	_ "image/jpeg" // covers are JPEG or PNG
	_ "image/png"
	"net/http"
	"sync"

	"github.com/Thrashy190/eco/internal/palette"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// The page colours of the web app's dark themes, which accents must read on (BACKGROUNDS in stores/settings.ts).
var pages = map[string]palette.RGB{"dark": {11, 11, 15}, "black": {0, 0, 0}}

type accentOut struct {
	Color  string `json:"color"`  // the cover's own colour
	Accent string `json:"accent"` // what the web app's dynamic colour makes of it
	Ink    string `json:"ink"`    // text on top of the accent
}

// accentCache remembers the answer per cover: a song change on the TV should not fetch and decode a picture each time.
type accentCache struct {
	mu sync.Mutex
	m  map[string]accentOut
}

func (c *accentCache) get(key string) (accentOut, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	out, ok := c.m[key]
	return out, ok
}

func (c *accentCache) put(key string, out accentOut) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil || len(c.m) >= 4096 {
		c.m = map[string]accentOut{}
	}
	c.m[key] = out
}

// coverAccent is the dynamic colour of a cover, worked out like the web app does in the browser, for the TV app,
// which cannot read a picture's pixels. Without a usable picture the fields are empty and the app keeps the accent
// the person chose.
func (s *Server) coverAccent(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.URL.Query().Get("id")
	theme := r.URL.Query().Get("theme")
	page, ok := pages[theme]
	if !ok {
		theme, page = "dark", pages["dark"]
	}
	if id == "" || len(id) > 200 {
		fail(w, http.StatusBadRequest, "id is required")
		return
	}
	key := theme + "\x00" + id
	out, cached := s.accents.get(key)
	if !cached {
		ctx := r.Context()
		data, err := s.nd.CoverArt(ctx, cred, id, 64)
		if err == nil {
			if img, _, err := image.Decode(bytes.NewReader(data)); err == nil {
				color := palette.Dominant(img)
				accent := palette.Accent(color, page)
				out = accentOut{Color: color.Hex(), Accent: accent.Hex(), Ink: palette.Ink(accent).Hex()}
			}
		}
		if ctx.Err() != nil {
			return
		}
		s.accents.put(key, out)
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	respond(w, http.StatusOK, out)
}
