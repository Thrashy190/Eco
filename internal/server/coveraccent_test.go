package server

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
)

func TestCoverAccentIsTheWebAppsColour(t *testing.T) {
	var covers atomic.Int32
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/getCoverArt") {
			covers.Add(1)
			if r.URL.Query().Get("id") == "missing" {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"subsonic-response":{"status":"failed","error":{"code":70}}}`))
				return
			}
			img := image.NewRGBA(image.Rect(0, 0, 16, 16))
			for i := range img.Pix {
				if i%4 == 0 {
					img.Pix[i] = 200
				} else if i%4 == 3 {
					img.Pix[i] = 255
				} else {
					img.Pix[i] = 30
				}
			}
			img.Set(0, 0, color.RGBA{200, 30, 30, 255})
			var buf bytes.Buffer
			png.Encode(&buf, img)
			w.Header().Set("Content-Type", "image/png")
			w.Write(buf.Bytes())
			return
		}
		w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
	}))
	defer nd.Close()
	dir := t.TempDir()
	cfg := &config.Config{NavidromeURL: nd.URL, MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music")}
	s, err := New(context.Background(), cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()

	var out accentOut
	rec := as(t, h, "diego", "GET", "/api/covers/accent?id=al-1", "")
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	// A red cover gives the same accent as accentFromCover([200, 30, 30], dark) in the web app
	if out.Color != "#c81e1e" || out.Accent != "#e65656" || out.Ink != "#ffffff" {
		t.Fatalf("got %+v", out)
	}
	as(t, h, "diego", "GET", "/api/covers/accent?id=al-1", "")
	if covers.Load() != 1 {
		t.Fatalf("the cover was fetched %d times; the answer should be remembered", covers.Load())
	}
	// No picture: empty fields, so the TV keeps the accent the person chose
	rec = as(t, h, "diego", "GET", "/api/covers/accent?id=missing", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"accent":""`) {
		t.Fatalf("missing cover: %d %s", rec.Code, rec.Body)
	}
	if rec := httptest.NewRecorder(); true {
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/covers/accent?id=al-1", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("without signing in: %d", rec.Code)
		}
	}
}

func TestShapedCoverHasTransparentCorners(t *testing.T) {
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/getCoverArt") {
			img := image.NewRGBA(image.Rect(0, 0, 64, 64))
			for i := range img.Pix {
				img.Pix[i] = 255
			}
			png.Encode(w, img)
			return
		}
		w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
	}))
	defer nd.Close()
	dir := t.TempDir()
	cfg := &config.Config{NavidromeURL: nd.URL, MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music")}
	s, err := New(context.Background(), cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	rec := as(t, h, "diego", "GET", "/api/covers/shaped?id=al-1&size=64&shape=circle", "")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("%d %s", rec.Code, rec.Header())
	}
	img, err := png.Decode(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatalf("the corner of a round cover is not transparent: %d", a)
	}
	if _, _, _, a := img.At(32, 32).RGBA(); a == 0 {
		t.Fatal("the middle was cut")
	}
	for _, bad := range []string{"shape=star&size=64&id=x", "shape=soft&size=5000&id=x", "shape=soft&size=64", "shape=soft&size=64&playlist=../../etc"} {
		if rec := as(t, h, "diego", "GET", "/api/covers/shaped?"+bad, ""); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d", bad, rec.Code)
		}
	}
	// Another account's playlist picture is not there for this one
	if rec := as(t, h, "ana", "GET", "/api/covers/shaped?playlist=p1&size=64&shape=soft", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("someone else's playlist cover: %d", rec.Code)
	}
}
