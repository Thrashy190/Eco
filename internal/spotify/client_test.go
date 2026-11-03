package spotify

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type fixedToken struct{}

func (fixedToken) Token(context.Context) (string, error) { return "token", nil }

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	c := New(fixedToken{})
	c.base = server.URL
	return c
}

// The real case: Spotify answered Retry-After: 12157 and every search hung until the browser gave up.
func TestLongRateLimitFailsAtOnceAndStopsAsking(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "12157")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	start := time.Now()
	_, err := c.SearchTracks(context.Background(), "Metallica", 0)
	var limited *RateLimitError
	if !errors.As(err, &limited) {
		t.Fatalf("want RateLimitError, got %v", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("it must not wait: took %v", time.Since(start))
	}
	if _, err := c.SearchAlbums(context.Background(), "other"); !errors.As(err, &limited) {
		t.Fatalf("want RateLimitError, got %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("asking again during the pause makes it longer: %d calls", calls.Load())
	}
}

func TestShortRateLimitIsWaitedFor(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Write([]byte(`{"tracks":{"items":[{"id":"a","name":"One"}]}}`))
	})
	tracks, err := c.SearchTracks(context.Background(), "One", 0)
	if err != nil || len(tracks) != 1 {
		t.Fatalf("tracks %v, err %v", tracks, err)
	}
}

func TestSearchesAreRememberedAndErrorsAreNot(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Write([]byte(`{"tracks":{"items":[{"id":"a","name":"One"}]}}`))
	})
	if _, err := c.SearchTracks(context.Background(), "One", 0); err == nil {
		t.Fatal("the first answer was an error")
	}
	for range 3 {
		if tracks, err := c.SearchTracks(context.Background(), "One", 0); err != nil || len(tracks) != 1 {
			t.Fatalf("tracks %v, err %v", tracks, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("want one failure and one remembered answer, got %d calls", calls.Load())
	}
}

// A user's own lists change and belong to them: they must never come from the shared cache.
func TestUserListsAreNotRemembered(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Write([]byte(`{"items":[]}`))
	})
	for range 2 {
		if err := c.LikedSongs(context.Background(), func(Item, int) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("liked songs were cached: %d calls", calls.Load())
	}
}
