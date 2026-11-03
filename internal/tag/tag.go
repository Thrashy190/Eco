// Package tag writes audio tags and cover art by remuxing with ffmpeg (no re-encoding).
package tag

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/spotify"
)

// Write replaces every tag of the audio file at path with meta and, if given, a JPEG cover.
// codec is the container: "m4a" or "wav".
func Write(ctx context.Context, ffmpeg, path, codec string, m spotify.Meta, cover []byte) error {
	dir := filepath.Dir(path)
	out := filepath.Join(dir, "tagged."+codec)
	defer os.Remove(out)

	args := []string{"-y", "-loglevel", "error", "-i", path}
	if len(cover) > 0 {
		coverPath := filepath.Join(dir, "cover.jpg")
		if err := os.WriteFile(coverPath, cover, 0o600); err != nil {
			return err
		}
		defer os.Remove(coverPath)
		args = append(args, "-i", coverPath)
	}
	args = append(args, "-map", "0:a")
	if len(cover) > 0 {
		args = append(args, "-map", "1:v", "-c:v", "copy", "-disposition:v:0", "attached_pic")
	}
	args = append(args, "-c:a", "copy", "-map_metadata", "-1")
	for k, v := range fields(m) {
		args = append(args, "-metadata", k+"="+v)
	}
	if codec == "wav" {
		args = append(args, "-write_id3v2", "1", "-id3v2_version", "3")
	}
	args = append(args, out)

	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("ffmpeg could not write the tags: %s", strings.TrimSpace(stderr.String()))
	}
	return os.Rename(out, path)
}

func fields(m spotify.Meta) map[string]string {
	f := map[string]string{"title": m.Title, "artist": m.Artist, "album_artist": m.AlbumArtist, "album": m.Album}
	if m.Date != "" {
		f["date"] = m.Date
	}
	if m.Track > 0 {
		f["track"] = strconv.Itoa(m.Track)
		if m.Tracks > 0 {
			f["track"] += "/" + strconv.Itoa(m.Tracks)
		}
	}
	if m.Disc > 0 {
		f["disc"] = strconv.Itoa(m.Disc)
	}
	if m.ISRC != "" {
		f["isrc"] = m.ISRC
	}
	return f
}
