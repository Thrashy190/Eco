// Package ytdlp wraps the yt-dlp binary: search YouTube / YouTube Music and download audio.
// eco shells out instead of embedding anything so yt-dlp can be updated on its own,
// which matters because YouTube changes often.
package ytdlp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/match"
)

// Runner runs yt-dlp with the project's cookie and JavaScript-runtime settings.
type Runner struct {
	Bin            string
	CookiesBrowser string   // read the YouTube session of this browser
	CookiesFile    string   // or of this Netscape cookies.txt
	JSRuntimes     []string // deno / node / bun: needed to solve YouTube's challenges
}

// Error is a yt-dlp failure with its last ERROR line.
type Error struct{ Msg string }

func (e *Error) Error() string { return e.Msg }

// IsBlocked reports whether YouTube is demanding a sign-in ("confirm you're not a bot").
// Retrying immediately never helps: wait, or provide cookies.
func IsBlocked(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "not a bot") || strings.Contains(err.Error(), "LOGIN_REQUIRED"))
}

// IsRateLimited reports a temporary 403 / 429 that usually passes after waiting.
func IsRateLimited(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "HTTP Error 403") || strings.Contains(err.Error(), "HTTP Error 429"))
}

func (r *Runner) args(cookies string, extra ...string) []string {
	a := []string{"--no-warnings", "--no-playlist", "--ignore-config"}
	for _, js := range r.JSRuntimes {
		a = append(a, "--js-runtimes", js)
	}
	switch {
	case cookies != "":
		a = append(a, "--cookies", cookies)
	case r.CookiesBrowser != "":
		a = append(a, "--cookies-from-browser", r.CookiesBrowser)
	}
	return append(a, extra...)
}

// cookieCopy gives yt-dlp a private, writable copy of the cookies file. yt-dlp rewrites the file it is
// given when it exits (to store renewed cookies) and fails if it cannot, which is exactly what happens
// when the original is mounted read-only. A copy per call also keeps parallel runs from clobbering each other.
func (r *Runner) cookieCopy() (path string, done func()) {
	if r.CookiesFile == "" {
		return "", func() {}
	}
	data, err := os.ReadFile(r.CookiesFile)
	if err != nil {
		return r.CookiesFile, func() {} // let yt-dlp report the problem itself
	}
	f, err := os.CreateTemp("", "eco-cookies-*.txt")
	if err != nil {
		return r.CookiesFile, func() {}
	}
	defer f.Close()
	f.Write(data)
	return f.Name(), func() { os.Remove(f.Name()) }
}

// run executes yt-dlp and returns stdout. On failure the error carries yt-dlp's last ERROR line.
func (r *Runner) run(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, r.Bin, args...)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, lastError(errOut.String(), err)
	}
	return out.Bytes(), nil
}

func lastError(stderr string, fallback error) error {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if _, msg, ok := strings.Cut(lines[i], "ERROR:"); ok {
			return &Error{strings.TrimSpace(msg)}
		}
	}
	// No "ERROR:" line (a crash, for instance): show the last thing yt-dlp said instead of a bare exit code
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			return fmt.Errorf("yt-dlp: %s (%w)", l, fallback)
		}
	}
	return fmt.Errorf("yt-dlp: %w", fallback)
}

type entry struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Duration float64 `json:"duration"`
	Channel  string  `json:"channel"`
	Uploader string  `json:"uploader"`
	Track    string  `json:"track"`
	Artist   string  `json:"artist"`
	Thumb    string  `json:"thumbnail"`
	Live     bool    `json:"is_live"`
}

func (e entry) video(music bool) match.Video {
	ch := e.Channel
	if ch == "" {
		ch = e.Uploader
	}
	return match.Video{ID: e.ID, Title: e.Title, Channel: ch, DurationSec: e.Duration, Music: music}
}

func decodeLines(data []byte) []entry {
	var out []entry
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64*1024), 8<<20)
	for sc.Scan() {
		var e entry
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.ID != "" {
			out = append(out, e)
		}
	}
	return out
}

// Search runs a plain YouTube search. One cheap call that already returns duration and channel.
func (r *Runner) Search(ctx context.Context, query string, n int) ([]match.Video, error) {
	cookies, done := r.cookieCopy()
	defer done()
	out, err := r.run(ctx, r.args(cookies, "--flat-playlist", "--dump-json", fmt.Sprintf("ytsearch%d:%s", n, query))...)
	if err != nil {
		return nil, err
	}
	var vs []match.Video
	for _, e := range decodeLines(out) {
		if e.Duration > 0 {
			vs = append(vs, e.video(false))
		}
	}
	return vs, nil
}

// MusicSearch searches YouTube Music (official album audio). It is slower than Search because
// each hit has to be opened to learn its duration, so callers use it only when Search was not conclusive.
func (r *Runner) MusicSearch(ctx context.Context, query string, n int) ([]match.Video, error) {
	cookies, done := r.cookieCopy()
	defer done()
	// playlist-end matters: without it the search pages through ~20 result pages per song
	out, err := r.run(ctx, r.args(cookies, "--flat-playlist", "--dump-json", "--playlist-end", "5",
		"https://music.youtube.com/search?q="+url.QueryEscape(query)+"#songs")...)
	if err != nil {
		return nil, err
	}
	var vs []match.Video
	for _, e := range decodeLines(out) {
		if len(vs) >= n {
			break
		}
		info, err := r.Info(ctx, "https://www.youtube.com/watch?v="+e.ID)
		if err != nil {
			continue
		}
		if info.DurationSec > 0 {
			info.Music = true
			vs = append(vs, info)
		}
	}
	return vs, nil
}

// Info describes a single video.
func (r *Runner) Info(ctx context.Context, link string) (match.Video, error) {
	v, _, err := r.InfoFull(ctx, link)
	return v, err
}

// Uploaded is the "Provided to YouTube by…" track/artist pair some videos carry.
type Uploaded struct{ Track, Artist string }

// InfoFull is Info plus the clean track/artist fields YouTube Music uploads have.
func (r *Runner) InfoFull(ctx context.Context, link string) (match.Video, Uploaded, error) {
	cookies, done := r.cookieCopy()
	defer done()
	out, err := r.run(ctx, r.args(cookies, "--dump-json", "--skip-download", link)...)
	if err != nil {
		return match.Video{}, Uploaded{}, err
	}
	es := decodeLines(out)
	if len(es) == 0 {
		return match.Video{}, Uploaded{}, errors.New("yt-dlp returned no video information")
	}
	return es[0].video(false), Uploaded{es[0].Track, es[0].Artist}, nil
}

// runProgress runs yt-dlp and reports the download percentage it prints. Only stdout is read as progress;
// stderr is kept for the error message.
func (r *Runner) runProgress(ctx context.Context, args []string, onProgress func(percent float64)) error {
	cmd := exec.CommandContext(ctx, r.Bin, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var errOut bytes.Buffer
	cmd.Stderr = &errOut
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cannot run %s: %w", r.Bin, err)
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for sc.Scan() {
		if rest, ok := strings.CutPrefix(sc.Text(), "ECO "); ok && onProgress != nil {
			if p, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(rest), "%"), 64); err == nil {
				onProgress(p)
			}
		}
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return lastError(errOut.String(), err)
	}
	return nil
}

var progressArgs = []string{"--quiet", "--progress", "--newline", "--progress-template", "download:ECO %(progress._percent_str)s"}

// Download fetches the audio of link into dir and converts it to codec ("m4a" or "wav").
// onProgress, when set, receives 0–100 while the audio downloads. It returns the path of the file.
func (r *Runner) Download(ctx context.Context, link, dir, codec string, onProgress func(percent float64)) (string, error) {
	cookies, done := r.cookieCopy()
	defer done()
	args := r.args(cookies, append(append([]string{"-f", "bestaudio[ext=m4a]/bestaudio/best", "-x", "--audio-format", codec}, progressArgs...),
		"-o", filepath.Join(dir, "audio.%(ext)s"), link)...)
	if err := r.runProgress(ctx, args, onProgress); err != nil {
		return "", err
	}
	return filepath.Join(dir, "audio."+codec), nil
}

// Preview describes a video before it is imported.
type Preview struct {
	ID, Title, Channel, Thumbnail string
	DurationSec                   float64
	Live                          bool
}

// Preview reads a single video's details without downloading it. A playlist link is refused: import one video at a time.
func (r *Runner) Preview(ctx context.Context, link string) (Preview, error) {
	cookies, done := r.cookieCopy()
	defer done()
	out, err := r.run(ctx, r.args(cookies, "--dump-json", "--skip-download", link)...)
	if err != nil {
		return Preview{}, err
	}
	es := decodeLines(out)
	if len(es) == 0 {
		return Preview{}, errors.New("yt-dlp returned no video information (is this a single video link?)")
	}
	e := es[0]
	v := e.video(false)
	return Preview{ID: e.ID, Title: e.Title, Channel: v.Channel, Thumbnail: e.Thumb, DurationSec: e.Duration, Live: e.Live}, nil
}

// MediaFiles are the files DownloadMedia produced inside its folder.
type MediaFiles struct{ Media, Thumb string }

// DownloadMedia downloads link into dir as media.<ext> plus media.jpg (the thumbnail).
// format is "video" (picture and sound, at most maxHeight pixels tall) or "audio" (sound only, M4A).
func (r *Runner) DownloadMedia(ctx context.Context, link, dir, format string, maxHeight int, onProgress func(percent float64)) (MediaFiles, error) {
	cookies, done := r.cookieCopy()
	defer done()
	var pick []string
	if format == "audio" {
		pick = []string{"-f", "bestaudio[ext=m4a]/bestaudio/best", "-x", "--audio-format", "m4a"}
	} else {
		// H.264 first: AV1 and VP9 do not play on many iPhones. Then anything that fits, then anything at all.
		h := strconv.Itoa(maxHeight)
		pick = []string{"-f", "bv*[height<=" + h + "][vcodec^=avc1]+ba[ext=m4a]/b[height<=" + h + "][vcodec^=avc1]/bv*[height<=" + h + "][ext=mp4]+ba[ext=m4a]/b[height<=" + h + "]/b",
			"--merge-output-format", "mp4"}
	}
	args := r.args(cookies, append(append(pick, progressArgs...), "--write-thumbnail", "--convert-thumbnails", "jpg",
		"-o", filepath.Join(dir, "media.%(ext)s"), link)...)
	if err := r.runProgress(ctx, args, onProgress); err != nil {
		return MediaFiles{}, err
	}
	var files MediaFiles
	for _, ext := range []string{"mp4", "m4a", "mkv", "webm", "mp3", "opus"} {
		if _, err := os.Stat(filepath.Join(dir, "media."+ext)); err == nil {
			files.Media = "media." + ext
			break
		}
	}
	if files.Media == "" {
		return files, errors.New("yt-dlp finished but produced no media file")
	}
	if _, err := os.Stat(filepath.Join(dir, "media.jpg")); err == nil {
		files.Thumb = "media.jpg"
	}
	return files, nil
}
