package subsonic

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
)

// PurgeMissing makes Navidrome forget songs whose files are gone. A scan only marks such a song missing: Navidrome
// keeps it, and keeps its album greyed out, until an administrator removes it, which only its own API can do. Navidrome
// only removes songs it has marked missing, so a song whose file is still there stays (tested on a real Navidrome).
func (c *Client) PurgeMissing(ctx context.Context, session string, ids []string) error {
	if len(ids) == 0 {
		return nil // with no ID, Navidrome would remove every missing song
	}
	q := url.Values{}
	for _, id := range ids {
		q.Add("id", id)
	}
	resp, err := c.native(ctx, http.MethodDelete, "/api/missing?"+q.Encode(), session, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return ErrSessionOver
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("could not remove the missing songs (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// Exists reports whether Navidrome still has this album or artist (kind "album" or "artist"). It answers for the
// missing ones too, until they are purged.
func (c *Client) Exists(ctx context.Context, cred Cred, kind, id string) (bool, error) {
	endpoint := map[string]string{"album": "getAlbum", "artist": "getArtist"}[kind]
	if endpoint == "" {
		return false, fmt.Errorf("unknown kind %q", kind)
	}
	_, err := c.call(ctx, cred, endpoint, url.Values{"id": {id}})
	if err == nil {
		return true, nil
	}
	var refused *APIError
	if errors.As(err, &refused) && refused.Code == 70 {
		return false, nil
	}
	return false, err
}
