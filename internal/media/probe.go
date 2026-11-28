package media

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// What ffprobe says about a file sent from a device: whether it is audio a browser can play, how long it is, its
// tags, its chapters (an .m4b book has them) and whether it carries a picture. Nothing is trusted from the file's name.

// Probed is a file that ffprobe read.
type Probed struct {
	Ext      string // the extension it is kept with, by what it really is
	Duration float64
	Title    string
	Artist   string
	Album    string
	Comment  string
	Chapters []Chapter
	Picture  bool // a cover inside the file
}

type probeJSON struct {
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		CodecType   string `json:"codec_type"`
		CodecName   string `json:"codec_name"`
		Disposition struct {
			AttachedPic int `json:"attached_pic"`
		} `json:"disposition"`
	} `json:"streams"`
	Chapters []struct {
		StartTime string            `json:"start_time"`
		Tags      map[string]string `json:"tags"`
	} `json:"chapters"`
}

// ErrNotAudio is returned for a file that is not audio a browser plays.
var ErrNotAudio = errors.New("that file is not audio Eco can play (MP3, M4A, M4B, AAC, Ogg, Opus, FLAC or WAV)")

func tagOf(tags map[string]string, names ...string) string {
	for _, want := range names {
		for k, v := range tags {
			if strings.EqualFold(k, want) && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
	}
	return ""
}

// parseProbe reads ffprobe's answer. name is the file's name on the device, only to keep an .m4b an .m4b.
func parseProbe(data []byte, name string) (Probed, error) {
	var p probeJSON
	if err := json.Unmarshal(data, &p); err != nil {
		return Probed{}, ErrNotAudio
	}
	var codec string
	var picture, video bool
	for _, s := range p.Streams {
		switch {
		case s.CodecType == "audio" && codec == "":
			codec = s.CodecName
		case s.CodecType == "video" && s.Disposition.AttachedPic == 1:
			picture = true
		case s.CodecType == "video":
			video = true
		}
	}
	if codec == "" {
		return Probed{}, ErrNotAudio
	}
	formats := strings.Split(p.Format.FormatName, ",")
	has := func(f string) bool {
		for _, one := range formats {
			if one == f {
				return true
			}
		}
		return false
	}
	var ext string
	switch {
	case has("mp3"):
		ext = ".mp3"
	case has("mp4") || has("m4a") || has("mov"):
		ext = ".m4a"
		if strings.EqualFold(filepath.Ext(name), ".m4b") {
			ext = ".m4b"
		}
	case has("aac"):
		ext = ".aac"
	case has("ogg") && codec == "opus":
		ext = ".opus"
	case has("ogg"):
		ext = ".ogg"
	case has("flac"):
		ext = ".flac"
	case has("wav"):
		ext = ".wav"
	default:
		return Probed{}, ErrNotAudio
	}
	if video {
		return Probed{}, errors.New("that file has video in it: only audio is kept, so send the audio alone")
	}
	duration, _ := strconv.ParseFloat(p.Format.Duration, 64)
	out := Probed{Ext: ext, Duration: duration, Picture: picture,
		Title: tagOf(p.Format.Tags, "title"), Artist: tagOf(p.Format.Tags, "artist", "album_artist", "composer"),
		Album: tagOf(p.Format.Tags, "album"), Comment: tagOf(p.Format.Tags, "description", "comment", "synopsis")}
	for i, c := range p.Chapters {
		start, err := strconv.ParseFloat(c.StartTime, 64)
		if err != nil {
			continue
		}
		title := tagOf(c.Tags, "title")
		if title == "" {
			title = "Chapter " + strconv.Itoa(i+1)
		}
		out.Chapters = append(out.Chapters, Chapter{Start: start, Title: title})
	}
	return out, nil
}

// Probe asks ffprobe what a file is.
func Probe(ctx context.Context, ffprobe, path, name string) (Probed, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", path).Output()
	if err != nil {
		return Probed{}, ErrNotAudio
	}
	return parseProbe(out, name)
}

// ExtractPicture writes the cover inside a file as a JPEG at most 1000 px wide.
func ExtractPicture(ctx context.Context, ffmpeg, path, jpeg string) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	return exec.CommandContext(ctx, ffmpeg, "-y", "-loglevel", "error", "-i", path, "-an", "-map", "0:v:0", "-frames:v", "1",
		"-vf", "scale='min(1000,iw)':-2", jpeg).Run()
}
