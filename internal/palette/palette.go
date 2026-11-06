// Package palette works out the accent colour a cover gives, with the same maths as the web app (web/src/lib/color.ts
// and dominantColor in lib/image.ts), for screens that cannot read a picture's pixels themselves: a Roku app can only
// show an image, so Eco looks at the cover for it.
package palette

import (
	"fmt"
	"image"
	"math"
	"sort"
)

// RGB is a colour with channels from 0 to 255.
type RGB [3]float64

// Hex writes the colour as #rrggbb.
func (c RGB) Hex() string {
	return fmt.Sprintf("#%02x%02x%02x", clamp(c[0]), clamp(c[1]), clamp(c[2]))
}

func clamp(v float64) int {
	return int(math.Max(0, math.Min(255, math.Round(v))))
}

func channel(c float64) float64 {
	c /= 255
	if c <= 0.03928 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

// Luminance is the relative luminance (WCAG).
func Luminance(c RGB) float64 {
	return 0.2126*channel(c[0]) + 0.7152*channel(c[1]) + 0.0722*channel(c[2])
}

// Contrast is the WCAG contrast ratio between two colours.
func Contrast(a, b RGB) float64 {
	l := []float64{Luminance(a), Luminance(b)}
	sort.Sort(sort.Reverse(sort.Float64Slice(l)))
	return (l[0] + 0.05) / (l[1] + 0.05)
}

func toHSL(c RGB) (h, s, l float64) {
	x, y, z := c[0]/255, c[1]/255, c[2]/255
	hi, lo := math.Max(x, math.Max(y, z)), math.Min(x, math.Min(y, z))
	delta := hi - lo
	l = (hi + lo) / 2
	if delta == 0 {
		return 0, 0, l
	}
	s = delta / (1 - math.Abs(2*l-1))
	switch hi {
	case x:
		h = math.Mod((y-z)/delta+6, 6)
	case y:
		h = (z-x)/delta + 2
	default:
		h = (x-y)/delta + 4
	}
	return h * 60, s, l
}

func fromHSL(h, s, l float64) RGB {
	c := (1 - math.Abs(2*l-1)) * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := l - c/2
	var r, g, b float64
	switch {
	case h < 60:
		r, g, b = c, x, 0
	case h < 120:
		r, g, b = x, c, 0
	case h < 180:
		r, g, b = 0, c, x
	case h < 240:
		r, g, b = 0, x, c
	case h < 300:
		r, g, b = x, 0, c
	default:
		r, g, b = c, 0, x
	}
	return RGB{math.Round((r + m) * 255), math.Round((g + m) * 255), math.Round((b + m) * 255)}
}

// Readable is the contrast text in the accent colour must reach against the page (WCAG AA).
const Readable = 4.5

// Accent is the accent a cover's colour gives on a page of this colour: the same hue, vivid enough to read as a
// colour and light or dark enough to read on the page. A nearly grey cover stays nearly grey.
func Accent(cover, background RGB) RGB {
	h, s, l := toHSL(cover)
	saturation := s
	if s >= 0.12 {
		saturation = math.Max(s, 0.6)
	}
	onLight := Luminance(background) > 0.5
	lightness := math.Min(math.Max(l, 0.62), 0.8)
	if onLight {
		lightness = math.Min(math.Max(l, 0.25), 0.42)
	}
	accent := fromHSL(h, saturation, lightness)
	for Contrast(accent, background) < Readable && lightness > 0.02 && lightness < 0.98 {
		if onLight {
			lightness -= 0.02
		} else {
			lightness += 0.02
		}
		accent = fromHSL(h, saturation, lightness)
	}
	return accent
}

// Ink is the colour for text on top of the accent (--accent-ink in the web app).
func Ink(accent RGB) RGB {
	if Luminance(accent) > 0.4 {
		return RGB{11, 11, 15}
	}
	return RGB{255, 255, 255}
}

// Dominant is a picture's colour as the web app reads it: shrunk to 8×8, then averaged with saturated pixels counting
// more than grey ones.
func Dominant(img image.Image) RGB {
	const side = 8
	b := img.Bounds()
	if b.Empty() {
		return RGB{}
	}
	var r, g, bl, weight float64
	for cy := 0; cy < side; cy++ {
		for cx := 0; cx < side; cx++ {
			x0, x1 := b.Min.X+cx*b.Dx()/side, b.Min.X+(cx+1)*b.Dx()/side
			y0, y1 := b.Min.Y+cy*b.Dy()/side, b.Min.Y+(cy+1)*b.Dy()/side
			if x1 <= x0 {
				x1 = x0 + 1
			}
			if y1 <= y0 {
				y1 = y0 + 1
			}
			var pr, pg, pb, n float64
			for y := y0; y < y1 && y < b.Max.Y; y++ {
				for x := x0; x < x1 && x < b.Max.X; x++ {
					cr, cg, cb, _ := img.At(x, y).RGBA()
					pr += float64(cr >> 8)
					pg += float64(cg >> 8)
					pb += float64(cb >> 8)
					n++
				}
			}
			if n == 0 {
				continue
			}
			pr, pg, pb = pr/n, pg/n, pb/n
			w := 1 + (math.Max(pr, math.Max(pg, pb))-math.Min(pr, math.Min(pg, pb)))/32
			r += pr * w
			g += pg * w
			bl += pb * w
			weight += w
		}
	}
	if weight == 0 {
		return RGB{}
	}
	return RGB{math.Round(r / weight), math.Round(g / weight), math.Round(bl / weight)}
}
