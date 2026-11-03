package spotify

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/match"
)

// Source uses Spotify as eco's catalogue (CATALOG=spotify). It needs a developer app owned by someone with Premium, and
// Spotify can stop answering for hours. MusicBrainz is the default.
type Source struct {
	Client *Client
	// Missing says what is not set up, if anything.
	Missing string
}

// Name implements catalog.Source.
func (s *Source) Name() string { return "Spotify" }

// Ready implements catalog.Source.
func (s *Source) Ready() error {
	if s.Missing != "" {
		return errors.New(s.Missing)
	}
	return nil
}

var validID = regexp.MustCompile(`^[A-Za-z0-9]{22}$`)

// ValidID implements catalog.Source.
func (s *Source) ValidID(id string) bool { return validID.MatchString(id) }

// Busy implements catalog.Busy.
func (e *RateLimitError) Busy() {}

func trackOf(t Track) catalog.Track { return catalog.Track{ID: t.ID, Meta: t.Meta()} }

func albumOf(a Album) catalog.Album {
	out := catalog.Album{ID: a.ID, Name: a.Name, Type: a.AlbumType, Date: a.ReleaseDate, TotalTracks: a.TotalTracks, CoverURL: a.CoverURL()}
	for _, who := range a.Artists {
		out.Artists = append(out.Artists, who.Name)
	}
	for _, t := range a.Tracks {
		// Spotify's album listing has simplified tracks with no album of their own
		track := trackOf(t)
		track.Album, track.CoverURL = a.Name, a.CoverURL()
		out.Tracks = append(out.Tracks, track)
	}
	return out
}

func albumsOf(in []Album) []catalog.Album {
	out := make([]catalog.Album, len(in))
	for i, a := range in {
		out[i] = albumOf(a)
	}
	return out
}

// Search implements catalog.Source.
func (s *Source) Search(ctx context.Context, query string) (catalog.Results, error) {
	tracks, err := s.Client.SearchTracks(ctx, query, 0)
	if err != nil {
		return catalog.Results{}, err
	}
	out := catalog.Results{}
	for _, t := range tracks {
		out.Tracks = append(out.Tracks, trackOf(t))
	}
	if albums, err := s.Client.SearchAlbums(ctx, query); err == nil {
		out.Albums = albumsOf(albums)
	}
	artists, err := s.Client.SearchArtists(ctx, query)
	if err != nil {
		return out, nil
	}
	q := match.Norm(query)
	if len(q) < 3 {
		return out, nil
	}
	for _, a := range artists {
		if n := match.Norm(a.Name); n == q || strings.HasPrefix(n, q+" ") { // searching an artist: also list their other songs
			out.Artist = a.Name
			more, _ := s.tracksBy(ctx, a.Name)
			out.Tracks = append(out.Tracks, more...)
			break
		}
	}
	return out, nil
}

// tracksBy lists tracks credited to the artist called name (up to three pages).
func (s *Source) tracksBy(ctx context.Context, name string) ([]catalog.Track, error) {
	var out []catalog.Track
	want := match.Norm(name)
	for offset := 0; offset < 3*PageSize; offset += PageSize {
		page, err := s.Client.SearchTracks(ctx, `artist:"`+name+`"`, offset)
		if err != nil {
			return out, err
		}
		if len(page) == 0 {
			break
		}
		for _, t := range page {
			for _, a := range t.Artists {
				if match.Norm(a.Name) == want {
					out = append(out, trackOf(t))
					break
				}
			}
		}
	}
	return out, nil
}

// Track implements catalog.Source.
func (s *Source) Track(ctx context.Context, id string) (catalog.Track, error) {
	t, err := s.Client.Track(ctx, id)
	if err != nil {
		return catalog.Track{}, err
	}
	return trackOf(t), nil
}

// Album implements catalog.Source.
func (s *Source) Album(ctx context.Context, id string) (catalog.Album, error) {
	a, err := s.Client.Album(ctx, id)
	if err != nil {
		return catalog.Album{}, err
	}
	return albumOf(a), nil
}

// FindAlbum implements catalog.Source. The search can only give ten results, so asking with album: and artist: matters.
func (s *Source) FindAlbum(ctx context.Context, name, artist string) (catalog.Album, bool, error) {
	found, err := s.Client.SearchAlbums(ctx, `album:"`+name+`" artist:"`+artist+`"`)
	if err != nil {
		return catalog.Album{}, false, err
	}
	var best Album
	ok := false
	for _, a := range found {
		// Reissues share a name: the one with the most tracks is the most complete page
		if match.Norm(a.Name) == match.Norm(name) && match.SameArtist(a.Artist(), artist) && (!ok || a.TotalTracks > best.TotalTracks) {
			best, ok = a, true
		}
	}
	if !ok {
		return catalog.Album{}, false, nil
	}
	whole, err := s.Album(ctx, best.ID)
	return whole, err == nil, err
}

// FindTrack implements catalog.Source.
func (s *Source) FindTrack(ctx context.Context, want catalog.Wanted) (catalog.Track, bool, error) {
	found, err := s.Client.SearchTracks(ctx, `track:"`+want.Title+`" artist:"`+want.Artist+`"`, 0)
	if err != nil {
		return catalog.Track{}, false, err
	}
	for _, t := range found {
		m := t.Meta()
		if match.Norm(m.Title) != match.Norm(want.Title) || !match.SameArtist(m.Artist, want.Artist) {
			continue
		}
		if diff := m.DurationMs - want.DurationMs; want.DurationMs > 0 && (diff > 10000 || diff < -10000) {
			continue
		}
		return trackOf(t), true, nil
	}
	return catalog.Track{}, false, nil
}

// ByArtist implements catalog.Source.
func (s *Source) ByArtist(ctx context.Context, name string) ([]catalog.Track, []catalog.Album, error) {
	tracks, err := s.tracksBy(ctx, name)
	if err != nil {
		return tracks, nil, err
	}
	albums, err := s.Client.SearchAlbums(ctx, `artist:"`+name+`"`)
	if err != nil {
		return tracks, nil, err
	}
	return tracks, albumsOf(albums), nil
}
