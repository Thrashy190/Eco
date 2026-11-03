// Package config loads eco's settings from the environment, falling back to a .env file.
package config

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Config holds every setting eco needs. Zero values are never used: Load fills in defaults.
type Config struct {
	Root     string // directory holding .env and the spotify token cache
	DataDir  string // contains music/ and the CSV state
	MusicDir string // DataDir/music: the library Navidrome reads
	MediaDir string // DataDir/media: videos, podcasts, audiobooks (not music; Navidrome never sees it)

	NavidromeURL string // where eco reaches Navidrome
	Listen       string // address eco serves on

	YtDlp          string // yt-dlp binary
	FFmpeg         string // ffmpeg binary
	CookiesBrowser string // e.g. "firefox"; yt-dlp reads that browser's YouTube session
	CookiesFile    string // Netscape cookies.txt, for servers with no browser
	JSRuntimes     []string

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

		NavidromeURL: strings.TrimRight(env("ECO_NAVIDROME_URL", "http://127.0.0.1:4533"), "/"),
		Listen:       env("ECO_LISTEN", "127.0.0.1:8000"),

		YtDlp:          env("YTDLP_BIN", findBinary("yt-dlp", filepath.Join(root, "bin", "yt-dlp"))),
		FFmpeg:         env("FFMPEG_BIN", "ffmpeg"),
		CookiesBrowser: os.Getenv("YT_COOKIES_BROWSER"),
		CookiesFile:    os.Getenv("YT_COOKIES_FILE"),
		JSRuntimes:     jsRuntimes(),

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
