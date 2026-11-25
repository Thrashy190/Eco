package server

import (
	"net/http"
	"regexp"
)

// The page names its picture for shared links (og:image in web/index.html) by path, but WhatsApp and most chat apps
// only show it when the address is absolute. The page is the same for every address Eco is reached at (a tunnel, a LAN
// address, localhost), so the server fills in the address it was asked for.
var (
	shareImagePath = regexp.MustCompile(`content="\.?/og-image\.png"`) // Vite writes it "./og-image.png"
	plainHost      = regexp.MustCompile(`^[A-Za-z0-9.-]+(:[0-9]{1,5})?$`)
)

// withShareImage returns the page with its share picture at an absolute address on the host the request reached.
// A host that is not a plain name or address leaves the page as it is: it is only ever echoed into an HTML attribute.
func withShareImage(page []byte, r *http.Request) []byte {
	if !plainHost.MatchString(r.Host) {
		return page
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	// Behind a tunnel or a proxy the request arrives as plain HTTP; the proxy says what the person used.
	if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" || proto == "http" {
		scheme = proto
	}
	done := false
	return shareImagePath.ReplaceAllFunc(page, func(path []byte) []byte {
		if done {
			return path
		}
		done = true
		return []byte(`content="` + scheme + "://" + r.Host + `/og-image.png"`)
	})
}
