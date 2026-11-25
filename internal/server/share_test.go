package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sharePage = `<meta property="og:image" content="/og-image.png"><link rel="icon" href="/icon-192.png">`

func TestShareImageIsAbsolute(t *testing.T) {
	cases := []struct {
		name, host, proto, want string
	}{
		{"as Vite writes it", "eco.example.com", "https", `content="https://eco.example.com/og-image.png"`},
		{"behind the tunnel", "eco.example.com", "https", `content="https://eco.example.com/og-image.png"`},
		{"on the LAN", "192.168.1.10:8000", "", `content="http://192.168.1.10:8000/og-image.png"`},
		{"an odd forwarded scheme is ignored", "eco.example.com", "javascript", `content="http://eco.example.com/og-image.png"`},
		{"a host that could break out of the attribute", `evil.com"><script>`, "https", `content="/og-image.png"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.Host = c.host
			if c.proto != "" {
				r.Header.Set("X-Forwarded-Proto", c.proto)
			}
			page := sharePage
			if c.name == "as Vite writes it" {
				page = strings.Replace(page, `"/og-image.png"`, `"./og-image.png"`, 1)
			}
			got := string(withShareImage([]byte(page), r))
			if !strings.Contains(got, c.want) {
				t.Fatalf("got %s, want it to hold %s", got, c.want)
			}
			if !strings.Contains(got, `href="/icon-192.png"`) {
				t.Fatalf("changed more than the share picture: %s", got)
			}
		})
	}
}

func TestServerFillsInShareImage(t *testing.T) {
	h := newTestServer(t)
	for _, path := range []string{"/", "/index.html"} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.Host = "eco.example.com"
		r.Header.Set("X-Forwarded-Proto", "https")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if path == "/index.html" { // the file server sends it to "/"
			if w.Code != http.StatusMovedPermanently {
				t.Fatalf("%s: HTTP %d", path, w.Code)
			}
			continue
		}
		body, _ := io.ReadAll(w.Body)
		if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("%s: HTTP %d, %s", path, w.Code, w.Header().Get("Content-Type"))
		}
		if !strings.Contains(string(body), "https://eco.example.com/og-image.png") {
			t.Fatalf("%s: the page has no absolute share picture: %s", path, body)
		}
	}
}
