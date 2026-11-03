// Package match decides whether a YouTube video is the song Spotify describes.
// Duration alone is not enough ("Mi Niña" and "My Girl" by the same artist last the same),
// so titles are compared too, and unwanted versions (live, remix, sped up…) are penalised.
package match

import (
	"regexp"
	"sort"
	"strings"
)

var (
	fold = strings.NewReplacer(
		"á", "a", "à", "a", "ä", "a", "â", "a", "ã", "a", "å", "a", "é", "e", "è", "e", "ë", "e", "ê", "e",
		"í", "i", "ì", "i", "ï", "i", "î", "i", "ó", "o", "ò", "o", "ö", "o", "ô", "o", "õ", "o", "ø", "o",
		"ú", "u", "ù", "u", "ü", "u", "û", "u", "ñ", "n", "ç", "c", "ß", "ss",
	)
	reBrackets = regexp.MustCompile(`[\(\[].*?[\)\]]`)
	reDashTail = regexp.MustCompile(`\s+-\s+.*$`)
	reFeat     = regexp.MustCompile(`\b(feat|ft|with)\b.*$`)
	reNonAlnum = regexp.MustCompile(`[^\p{L}\p{N}]+`) // any alphabet: Cyrillic or Japanese titles must stay distinct

	// Versions we do not want unless the Spotify title itself says so.
	reUnwanted = regexp.MustCompile(`(?i)\b(live|en vivo|cover|karaoke|remix|sped ?up|speed ?up|slowed|reverb|8d|nightcore|instrumental|acapella|a cappella|acoustic|ac[uú]stic[oa]|edit|reaction|tutorial|1 hora|1 hour|techengue)\b`)
)

func ascii(s string) string { return fold.Replace(strings.ToLower(s)) }

// Norm reduces a title or artist to comparable words: "Tití Me Preguntó (Remastered) - 2011 feat. X" → "titi me pregunto".
func Norm(s string) string {
	s = ascii(s)
	s = reBrackets.ReplaceAllString(s, " ")
	s = reDashTail.ReplaceAllString(s, " ")
	s = reFeat.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(reNonAlnum.ReplaceAllString(s, " ")), " ")
}

// FirstArtist is the normalised first artist of "A, B & C".
func FirstArtist(s string) string {
	s, _, _ = strings.Cut(s, ",")
	s, _, _ = strings.Cut(s, "&")
	return Norm(s)
}

// SameArtist reports whether two artist strings share their first artist (either may contain the other).
func SameArtist(a, b string) bool {
	x, y := FirstArtist(a), FirstArtist(b)
	return x != "" && y != "" && (strings.Contains(x, y) || strings.Contains(y, x))
}

func words(s string) []string { return strings.Fields(reNonAlnum.ReplaceAllString(ascii(s), " ")) }

// SameTitle reports whether the video title contains the song title: at least 75% of its words,
// or the title squeezed together ("Table Dance" ↔ "TABLEDANCE", "0:00" ↔ "00:00").
func SameTitle(songTitle, videoTitle string) bool {
	song := strings.Fields(Norm(songTitle))
	if len(song) == 0 {
		song = words(songTitle)
	}
	if len(song) == 0 {
		return true
	}
	video := map[string]bool{}
	for _, w := range words(videoTitle) {
		video[w] = true
	}
	uniq, hit := map[string]bool{}, 0
	for _, w := range song {
		if !uniq[w] {
			uniq[w] = true
			if video[w] {
				hit++
			}
		}
	}
	return float64(hit)/float64(len(uniq)) >= 0.75 || strings.Contains(strings.Join(words(videoTitle), ""), strings.Join(song, ""))
}

// Song is what we want to find.
type Song struct {
	Title, Artist string
	DurationSec   float64
}

// Video is a candidate found on YouTube or YouTube Music.
type Video struct {
	ID, Title, Channel string
	DurationSec        float64
	Music              bool // came from a YouTube Music search (official album audio)
}

// Result scores one candidate. Lower Score is better.
type Result struct {
	Video    Video
	Score    float64
	DiffSec  float64
	Odd      []string // unwanted-version words, or "different title"
	Official bool
}

// OK reports whether the candidate is trustworthy enough to download without a human check:
// at most 10 s off and nothing odd about the title.
func (r Result) OK() bool { return r.DiffSec <= 10 && len(r.Odd) == 0 }

// Clear reports whether the candidate is so obviously right that no further search is needed.
func (r Result) Clear() bool { return r.DiffSec <= 3 && len(r.Odd) == 0 && r.Official }

func unwantedWords(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range reUnwanted.FindAllString(s, -1) {
		out[strings.ToLower(w)] = true
	}
	return out
}

// Score rates a candidate against the song.
func Score(song Song, v Video) Result {
	diff := v.DurationSec - song.DurationSec
	if diff < 0 {
		diff = -diff
	}
	wanted := unwantedWords(song.Title)
	var odd []string
	for w := range unwantedWords(v.Title) {
		if !wanted[w] {
			odd = append(odd, w)
		}
	}
	sort.Strings(odd)
	if !SameTitle(song.Title, v.Title) {
		odd = append(odd, "different title")
	}
	first, _, _ := strings.Cut(song.Artist, ",")
	first = strings.ToLower(strings.TrimSpace(first))
	official := v.Music || strings.HasSuffix(v.Channel, "- Topic") || (first != "" && strings.Contains(strings.ToLower(v.Channel), first))
	score := diff + 60*float64(len(odd))
	if official {
		score -= 8
	}
	return Result{Video: v, Score: score, DiffSec: diff, Odd: odd, Official: official}
}

// Best returns the lowest-scoring candidate, or false when there are none.
func Best(song Song, videos []Video) (Result, bool) {
	var best Result
	found := false
	for _, v := range videos {
		if r := Score(song, v); !found || r.Score < best.Score {
			best, found = r, true
		}
	}
	return best, found
}

// SearchQuery builds the search text for a song: first artist plus the title without "- Remastered 2011" tails.
func SearchQuery(song Song) string {
	first, _, _ := strings.Cut(song.Artist, ",")
	return strings.TrimSpace(first) + " " + reDashTail.ReplaceAllString(song.Title, "")
}
