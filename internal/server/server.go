// Package server is eco's web server. It sits in front of Navidrome and serves the web app:
//
//	/rest/*   passed through to Navidrome (Subsonic API: audio with Range, covers, playlists…),
//	          so any Subsonic client keeps working when pointed at eco
//	/api/*    what Navidrome cannot do: search beyond your library, discover, download, import lists, clean up
//	/         the web app
//
// Every /api request carries the same Subsonic credentials the app uses with Navidrome (u + t + s);
// they are verified against Navidrome, so eco has no user database of its own.
package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/connect"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Server holds everything the handlers share.
type Server struct {
	cfg  *config.Config
	eng  *engine.Engine
	nd   *subsonic.Client
	jobs *jobs.Manager
	web  fs.FS

	media media.Store
	users *userdata.Store
	hub   *connect.Hub

	proxy *httputil.ReverseProxy

	ctx context.Context // ends when the server stops; work that outlives a request uses it

	mu             sync.Mutex
	valid          map[string]time.Time // credentials verified recently
	lib            *snapshot            // cached copy of the library
	youtubeBlocked time.Time            // YouTube said "not a bot": no downloads until then
	retag          retagTask            // the artist clean-up, if one ran
}

// New builds a server. web is the root of the static web app. ctx stops the download worker.
func New(ctx context.Context, cfg *config.Config, eng *engine.Engine, web fs.FS) (*Server, error) {
	target, err := url.Parse(cfg.NavidromeURL)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, eng: eng, nd: subsonic.New(cfg.NavidromeURL), web: web, ctx: ctx, valid: map[string]time.Time{}, media: media.Store{Root: cfg.MediaDir}, users: &userdata.Store{Root: cfg.UsersDir}, hub: connect.NewHub()}
	s.proxy = httputil.NewSingleHostReverseProxy(target)
	s.proxy.FlushInterval = -1 // stream audio as it arrives
	director := s.proxy.Director
	s.proxy.Director = func(r *http.Request) { director(r); r.Host = target.Host }
	s.jobs = jobs.NewManager(ctx, s.runJob)
	return s, nil
}

// Handler returns the HTTP handler for the whole app.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/rest/", s.proxy)
	mux.HandleFunc("/api/search", s.authed(s.search))
	mux.HandleFunc("/api/search/external", s.authed(s.searchExternal))
	mux.HandleFunc("GET /api/artists/lookup", s.authed(s.artistLookup))
	mux.HandleFunc("/api/discover", s.authed(s.discover))
	mux.HandleFunc("/api/home", s.authed(s.home))
	mux.HandleFunc("/api/songs", s.authed(s.songs))
	mux.HandleFunc("/api/download", s.authed(s.download))
	mux.HandleFunc("/api/jobs", s.authed(s.listJobs))
	mux.HandleFunc("GET /api/media/preview", s.authed(s.mediaPreview))
	mux.HandleFunc("POST /api/media/import", s.authed(s.mediaImport))
	mux.HandleFunc("GET /api/media", s.authed(s.mediaList))
	mux.HandleFunc("GET /api/media/{id}/file", s.authed(s.mediaFile(false)))
	mux.HandleFunc("GET /api/media/{id}/thumb", s.authed(s.mediaFile(true)))
	mux.HandleFunc("DELETE /api/media/{id}", s.authed(s.adminOnly(s.mediaDelete)))
	mux.HandleFunc("DELETE /api/admin/songs/{id}", s.authed(s.adminOnly(s.deleteSong)))
	mux.HandleFunc("GET /api/admin/cleanup", s.authed(s.adminOnly(s.cleanupReport)))
	mux.HandleFunc("POST /api/admin/cleanup/duplicates", s.authed(s.adminOnly(s.cleanupDuplicate)))
	mux.HandleFunc("POST /api/admin/cleanup/artists", s.authed(s.adminOnly(s.cleanupArtists)))
	mux.HandleFunc("POST /api/imports/parse", s.authed(s.importParse))
	mux.HandleFunc("GET /api/imports", s.authed(s.importList))
	mux.HandleFunc("POST /api/imports", s.authed(s.importSave))
	mux.HandleFunc("GET /api/imports/{id}", s.authed(s.importGet))
	mux.HandleFunc("POST /api/imports/{id}/sync", s.authed(s.importSync))
	mux.HandleFunc("POST /api/imports/{id}/download", s.authed(s.importDownload))
	mux.HandleFunc("DELETE /api/imports/{id}", s.authed(s.importForget))
	mux.HandleFunc("GET /api/me", s.authed(s.me))
	mux.HandleFunc("GET /api/connect/events", s.authed(s.connectEvents))
	mux.HandleFunc("POST /api/connect/state", s.authed(s.connectState))
	mux.HandleFunc("POST /api/connect/command", s.authed(s.connectCommand))
	mux.HandleFunc("GET /api/catalog/albums/{id}", s.authed(s.catalogAlbum))
	mux.HandleFunc("GET /api/albums/match", s.authed(s.albumMatch))
	mux.HandleFunc("GET /api/me/library", s.authed(s.myLibrary))
	mux.HandleFunc("POST /api/me/recents", s.authed(s.touchRecent))
	mux.HandleFunc("DELETE /api/me/recents/{type}/{id}", s.authed(s.forgetRecent))
	mux.HandleFunc("POST /api/me/pins", s.authed(s.addPin))
	mux.HandleFunc("DELETE /api/me/pins/{type}/{id}", s.authed(s.removePin))
	mux.HandleFunc("GET /api/covers/playlists/{id}", s.authed(s.playlistCover))
	mux.HandleFunc("PUT /api/covers/playlists/{id}", s.authed(s.setPlaylistCover))
	mux.HandleFunc("DELETE /api/covers/playlists/{id}", s.authed(s.deletePlaylistCover))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	static := http.FileServerFS(s.web)
	_, statErr := fs.Stat(s.web, "index.html")
	built := statErr == nil
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !built {
			http.Error(w, "The web app is not built. Run: make web", http.StatusServiceUnavailable)
			return
		}
		// Files under /assets have a content hash in their name, so they never change
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if strings.HasSuffix(r.URL.Path, ".webmanifest") { // Go does not know this type and would send text/plain
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		static.ServeHTTP(w, r)
	}))
	return secure(mux)
}

// secure adds headers that keep the app from being framed or from loading anything unexpected.
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

type apiHandler func(w http.ResponseWriter, r *http.Request, cred subsonic.Cred)

// authed verifies the Subsonic credentials of a request (remembered for five minutes).
func (s *Server) authed(h apiHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cred, ok := subsonic.FromQuery(r.URL.Query())
		if !ok {
			fail(w, http.StatusUnauthorized, "missing credentials")
			return
		}
		s.mu.Lock()
		until := s.valid[cred.Key()]
		s.mu.Unlock()
		if time.Now().After(until) {
			if err := s.nd.Ping(r.Context(), cred); err != nil {
				fail(w, http.StatusUnauthorized, "wrong username or password")
				return
			}
			s.mu.Lock()
			s.valid[cred.Key()] = time.Now().Add(5 * time.Minute)
			s.mu.Unlock()
		}
		h(w, r, cred)
	}
}

func respond(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writing response: %v", err)
	}
}

func fail(w http.ResponseWriter, code int, msg string) {
	respond(w, code, map[string]string{"error": msg})
}
