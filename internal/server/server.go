// Package server is eco's web server. It sits in front of Navidrome and serves the web app:
//
//	/rest/*   passed through to Navidrome (Subsonic API: audio with Range, covers, playlists…),
//	          so any Subsonic client keeps working when pointed at eco
//	/api/*    what Navidrome cannot do: search beyond your library, discover, download
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
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/media"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// Server holds everything the handlers share.
type Server struct {
	cfg  *config.Config
	eng  *engine.Engine
	nd   *subsonic.Client
	jobs *jobs.Manager
	web  fs.FS

	media media.Store

	proxy *httputil.ReverseProxy

	mu    sync.Mutex
	valid map[string]time.Time // credentials verified recently
	lib   *snapshot            // cached copy of the library
}

// New builds a server. web is the root of the static web app. ctx stops the download worker.
func New(ctx context.Context, cfg *config.Config, eng *engine.Engine, web fs.FS) (*Server, error) {
	target, err := url.Parse(cfg.NavidromeURL)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, eng: eng, nd: subsonic.New(cfg.NavidromeURL), web: web, valid: map[string]time.Time{}, media: media.Store{Root: cfg.MediaDir}}
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
	mux.HandleFunc("DELETE /api/media/{id}", s.authed(s.mediaDelete))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	static := http.FileServerFS(s.web)
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
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
