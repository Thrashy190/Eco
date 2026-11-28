// Package config loads eco's settings from the environment, falling back to a .env file.
package config

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds every setting eco needs. Zero values are never used: Load fills in defaults.
type Config struct {
	Version  string // of this build ("v1.3.0", or "dev"), set by the command, not the environment
	Root     string // directory holding .env and the spotify token cache
	DataDir  string // contains music/ and the CSV state
	MusicDir string // DataDir/music: the library Navidrome reads
	MediaDir string // DataDir/media: podcasts, audiobooks (not music; Navidrome never sees it)
	UsersDir string // DataDir/users: each user's recents, pins and playlist covers
	StatsDir string // DataDir/stats: what people play, for the statistics page

	NavidromeURL string // where eco reaches Navidrome
	Listen       string // address eco serves on

	YtDlp          string // yt-dlp binary
	FFmpeg         string // ffmpeg binary
	FFprobe        string // ffprobe binary, which reads files sent from a device (next to ffmpeg unless set)
	MaxUploadMB    int64  // the largest podcast or audiobook file a person may send from a device
	CookiesBrowser string // e.g. "firefox"; yt-dlp reads that browser's YouTube session
	CookiesFile    string // Netscape cookies.txt, for servers with no browser
	JSRuntimes     []string

	Catalog        string // where song and album information comes from: musicbrainz (default) or spotify
	MusicBrainzURL string // your own MusicBrainz mirror, which has no rate limit
	CatalogBackup  string // asked for what the catalogue could not answer: itunes (default) or none
	ITunesCountry  string // which iTunes store to ask, such as us or mx

	SpotifyID, SpotifySecret, SpotifyRedirect string

	// A Navidrome account, used by `eco likes favorites` to mark your liked songs as favourites.
	NavidromeUser, NavidromePassword string
}

// Load reads .env from the current directory (or ECO_ROOT) without overriding real environment variables.
func Load() *Config {
	root := env("ECO_ROOT", mustGetwd())
	loadDotEnv(filepath.Join(root, ".env"))

	data := env("DATA_DIR", "./data")
	if !filepath.IsAbs(data) {
		data = filepath.Join(root, data)
	}
	return &Config{
		Root:     root,
		DataDir:  data,
		MusicDir: filepath.Join(data, "music"),
		MediaDir: filepath.Join(data, "media"),
		UsersDir: filepath.Join(data, "users"),
		StatsDir: filepath.Join(data, "stats"),

		NavidromeURL: strings.TrimRight(env("ECO_NAVIDROME_URL", "http://127.0.0.1:4533"), "/"),
		Listen:       env("ECO_LISTEN", "127.0.0.1:8000"),

		YtDlp:          env("YTDLP_BIN", findBinary("yt-dlp", filepath.Join(root, "bin", "yt-dlp"))),
		FFmpeg:         env("FFMPEG_BIN", "ffmpeg"),
		FFprobe:        env("FFPROBE_BIN", sibling(env("FFMPEG_BIN", "ffmpeg"), "ffprobe")),
		MaxUploadMB:    envInt("MEDIA_UPLOAD_MAX_MB", 4096),
		CookiesBrowser: os.Getenv("YT_COOKIES_BROWSER"),
		CookiesFile:    os.Getenv("YT_COOKIES_FILE"),
		JSRuntimes:     jsRuntimes(),

		Catalog:        strings.ToLower(env("CATALOG", "musicbrainz")),
		MusicBrainzURL: os.Getenv("MUSICBRAINZ_URL"),
		CatalogBackup:  strings.ToLower(env("CATALOG_BACKUP", "itunes")),
		ITunesCountry:  env("ITUNES_COUNTRY", "us"),

		SpotifyID:       os.Getenv("SPOTIFY_CLIENT_ID"),
		SpotifySecret:   os.Getenv("SPOTIFY_CLIENT_SECRET"),
		SpotifyRedirect: env("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback"),

		NavidromeUser:     os.Getenv("ND_USER"),
		NavidromePassword: os.Getenv("ND_PASS"),
	}
}

// TokenFile is where the Spotify user login (PKCE) is cached.
func (c *Config) TokenFile() string { return filepath.Join(c.Root, ".spotify_token.json") }

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envInt reads a whole number, keeping the fallback for anything that is not a positive one.
func envInt(key string, fallback int64) int64 {
	if n, err := strconv.ParseInt(os.Getenv(key), 10, 64); err == nil && n > 0 {
		return n
	}
	return fallback
}

// sibling is the path of another program next to bin: ffprobe beside the ffmpeg chosen. A bare name stays a bare
// name, found on the PATH.
func sibling(bin, name string) string {
	if !strings.ContainsRune(bin, filepath.Separator) {
		return name
	}
	return filepath.Join(filepath.Dir(bin), name)
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		k = strings.TrimSpace(k)
		if ok && k != "" && os.Getenv(k) == "" {
			os.Setenv(k, strings.Trim(strings.TrimSpace(v), `"'`))
		}
	}
}

// findBinary prefers a binary on PATH, then the given local fallback, then the bare name.
func findBinary(name, local string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	if _, err := os.Stat(local); err == nil {
		return local
	}
	return name
}

// jsRuntimes lists the JavaScript runtimes yt-dlp can use to solve YouTube's challenges.
func jsRuntimes() []string {
	var found []string
	for _, name := range []string{"deno", "node", "bun"} {
		if _, err := exec.LookPath(name); err == nil {
			found = append(found, name)
		}
	}
	return found
}
