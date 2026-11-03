// Package tag writes audio tags and cover art by remuxing with ffmpeg (no re-encoding).
package tag

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
)

// Write replaces every tag of the audio file at path with meta and, if given, a JPEG cover.
// codec is the container: "m4a" or "wav".
func Write(ctx context.Context, ffmpeg, path, codec string, m catalog.Meta, cover []byte) error {
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
	if codec == "m4a" {
		// The index goes first, or a player has to jump to the end of the file before it can start
		args = append(args, "-movflags", "+faststart")
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

// Separator goes between artists in a tag. Navidrome splits a tag on it into separate artists, but not on a comma, which
// can be part of a name ("Tyler, The Creator"). Written "A, B", a song made one artist out of both.
const Separator = "; "

// joined writes artists into one tag, or uses the plain string when the source does not keep them apart.
func joined(names []string, plain string) string {
	if len(names) == 0 {
		return plain
	}
	return strings.Join(names, Separator)
}

func fields(m catalog.Meta) map[string]string {
	f := map[string]string{"title": m.Title, "artist": joined(m.Artists, m.Artist), "album_artist": joined(m.AlbumArtists, m.AlbumArtist), "album": m.Album}
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

// SetArtists changes a file's artist and album artist tags ("" leaves one as it is), keeping everything else: other tags,
// the cover, the audio to the last byte. The original is copied to backup first, and only replaced after the audio of the
// new file is proven identical.
func SetArtists(ctx context.Context, ffmpeg, path, artist, albumArtist, backup string) error {
	if artist == "" && albumArtist == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	ext := filepath.Ext(path)
	tmp, err := os.CreateTemp(filepath.Dir(path), ".eco-retag-*"+ext)
	if err != nil {
		return err
	}
	tmp.Close()
	out := tmp.Name()
	defer os.Remove(out)

	args := []string{"-y", "-loglevel", "error", "-i", path, "-map", "0", "-c", "copy", "-map_metadata", "0"}
	if artist != "" {
		args = append(args, "-metadata", "artist="+artist)
	}
	if albumArtist != "" {
		args = append(args, "-metadata", "album_artist="+albumArtist)
	}
	if strings.EqualFold(ext, ".m4a") {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, out)
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg could not write the tags: %s", strings.TrimSpace(stderr.String()))
	}
	before, err := audioHash(ctx, ffmpeg, path)
	if err != nil {
		return err
	}
	after, err := audioHash(ctx, ffmpeg, out)
	if err != nil {
		return err
	}
	if before != after {
		return errors.New("the audio would have changed, so the file was left alone")
	}
	if err := copyFile(path, backup); err != nil {
		return fmt.Errorf("could not keep a copy: %w", err)
	}
	if err := os.Chmod(out, info.Mode().Perm()); err != nil {
		return err
	}
	return os.Rename(out, path)
}

// audioHash fingerprints the audio packets of a file, ignoring its tags and how it is laid out.
func audioHash(ctx context.Context, ffmpeg, path string) (string, error) {
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, ffmpeg, "-loglevel", "error", "-i", path, "-map", "0:a:0", "-c", "copy", "-f", "streamhash", "-hash", "sha256", "-")
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("ffmpeg could not read the audio: %s", strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func copyFile(from, to string) error {
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}
