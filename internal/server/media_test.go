package server

import "testing"

// eco must only ever fetch from YouTube: anything else would let a signed-in user make the server
// request arbitrary addresses (your router, other machines on your network…).
func TestYoutubeURLAcceptsOnlyYouTube(t *testing.T) {
	good := []string{
		"https://www.youtube.com/watch?v=jNQXAC9IVRw",
		"https://youtu.be/jNQXAC9IVRw",
		"https://music.youtube.com/watch?v=abc",
		"http://m.youtube.com/watch?v=abc",
	}
	for _, u := range good {
		if _, err := youtubeURL(u); err != nil {
			t.Errorf("%s rejected: %v", u, err)
		}
	}
	bad := []string{
		"", "not a url", "file:///etc/passwd", "ftp://youtube.com/x",
		"http://127.0.0.1:4533/rest/ping", "http://192.168.1.1/", "http://localhost:8000/",
		"https://youtube.com.evil.example/watch?v=1", "https://evil.example/?u=youtube.com",
		"https://www.youtube.com/playlist?list=PL123",
	}
	for _, u := range bad {
		if _, err := youtubeURL(u); err == nil {
			t.Errorf("%q was accepted", u)
		}
	}
}
