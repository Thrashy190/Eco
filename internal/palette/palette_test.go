package palette

import (
	"image"
	"image/color"
	"math"
	"testing"
)

var (
	dark  = RGB{11, 11, 15}
	black = RGB{0, 0, 0}
	light = RGB{246, 246, 249}
)

// The same cases as web/src/lib/color.test.ts: the TV and the web app must agree on the colour.
func TestAccentStaysReadableOnEveryPage(t *testing.T) {
	for _, page := range []RGB{dark, black, light} {
		for r := 0.0; r <= 255; r += 51 {
			for g := 0.0; g <= 255; g += 51 {
				for b := 0.0; b <= 255; b += 51 {
					if c := Contrast(Accent(RGB{r, g, b}, page), page); c < Readable {
						t.Fatalf("cover %v on %v: contrast %.2f", RGB{r, g, b}, page, c)
					}
				}
			}
		}
	}
}

// A dark navy cover used to leave text in the accent colour nearly invisible on the dark theme
func TestAccentLiftsADarkCoverAndKeepsItsHue(t *testing.T) {
	c := Accent(RGB{10, 20, 70}, dark)
	if c[2] <= c[0] || c[2] <= c[1] {
		t.Fatalf("navy became %v", c)
	}
}

func TestAccentKeepsABlackAndWhiteAlbumGrey(t *testing.T) {
	c := Accent(RGB{120, 120, 120}, dark)
	if math.Max(c[0], math.Max(c[1], c[2]))-math.Min(c[0], math.Min(c[1], c[2])) >= 4 {
		t.Fatalf("grey became %v", c)
	}
}

// What the web app computes for a red cover on the dark page (accentFromCover in lib/color.ts gives #e65656)
func TestAccentMatchesTheWebApp(t *testing.T) {
	if got := Accent(RGB{200, 30, 30}, dark).Hex(); got != "#e65656" {
		t.Fatalf("got %s", got)
	}
}

func TestDominantFavoursColourOverGrey(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			c := color.RGBA{128, 128, 128, 255} // mostly grey
			if x < 16 {
				c = color.RGBA{220, 20, 20, 255} // a quarter red
			}
			img.Set(x, y, c)
		}
	}
	got := Dominant(img)
	if got[0] <= got[1]+40 {
		t.Fatalf("the red quarter should pull the colour to red, got %v", got)
	}
}

func TestInkReadsOnTheAccent(t *testing.T) {
	for _, accent := range []RGB{{124, 240, 192}, {40, 40, 160}, {227, 84, 84}} {
		if Contrast(Ink(accent), accent) < 3 {
			t.Fatalf("ink %v on %v", Ink(accent), accent)
		}
	}
}
