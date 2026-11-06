// Package coverart cuts covers into the shapes the web app draws with CSS (soft or sharp corners, round artists), as
// PNG with transparent corners, for the Roku app: a Roku can mask a picture only outside lists, and inside them the
// mask lands in the wrong place.
package coverart

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
)

// Shapes and their corner radius as a share of the side: the web app's soft and sharp corners, and a circle.
var radii = map[string]float64{"soft": 40.0 / 512, "sharp": 10.0 / 512, "circle": 0.5}

// ValidShape reports whether shape is one Cut knows.
func ValidShape(shape string) bool {
	_, ok := radii[shape]
	return ok
}

// Cut scales a cover to size×size (cropping the middle of a picture that is not square, like object-fit: cover) and
// makes what falls outside the shape transparent, with smooth edges.
func Cut(src image.Image, size int, shape string) *image.NRGBA {
	square := fill(src, size)
	r := radii[shape] * float64(size)
	if r <= 0 {
		return square
	}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			cover := coverage(float64(x), float64(y), float64(size), r)
			if cover >= 1 {
				continue
			}
			i := square.PixOffset(x, y)
			square.Pix[i+3] = uint8(math.Round(float64(square.Pix[i+3]) * cover))
		}
	}
	return square
}

// coverage is how much of pixel (x, y) lies inside a rounded square of this side and corner radius, sampled 4×4.
func coverage(x, y, side, r float64) float64 {
	// Only the corners need a look
	if (x >= r && x <= side-r-1) || (y >= r && y <= side-r-1) {
		return 1
	}
	inside := 0
	for sy := 0; sy < 4; sy++ {
		for sx := 0; sx < 4; sx++ {
			px, py := x+(float64(sx)+0.5)/4, y+(float64(sy)+0.5)/4
			cx, cy := math.Min(math.Max(px, r), side-r), math.Min(math.Max(py, r), side-r)
			if (px-cx)*(px-cx)+(py-cy)*(py-cy) <= r*r {
				inside++
			}
		}
	}
	return float64(inside) / 16
}

// fill scales the picture to cover a size×size square, averaging the source pixels each one covers.
func fill(src image.Image, size int) *image.NRGBA {
	b := src.Bounds()
	side := math.Min(float64(b.Dx()), float64(b.Dy()))
	x0 := float64(b.Min.X) + (float64(b.Dx())-side)/2
	y0 := float64(b.Min.Y) + (float64(b.Dy())-side)/2
	step := side / float64(size)
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			sx0, sy0 := int(x0+float64(x)*step), int(y0+float64(y)*step)
			sx1, sy1 := int(x0+float64(x+1)*step), int(y0+float64(y+1)*step)
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			if sy1 <= sy0 {
				sy1 = sy0 + 1
			}
			var r, g, bl, a, n uint64
			for sy := sy0; sy < sy1 && sy < b.Max.Y; sy++ {
				for sx := sx0; sx < sx1 && sx < b.Max.X; sx++ {
					c := color.NRGBAModel.Convert(src.At(sx, sy)).(color.NRGBA)
					r += uint64(c.R)
					g += uint64(c.G)
					bl += uint64(c.B)
					a += uint64(c.A)
					n++
				}
			}
			if n == 0 {
				continue
			}
			out.SetNRGBA(x, y, color.NRGBA{uint8(r / n), uint8(g / n), uint8(bl / n), uint8(a / n)})
		}
	}
	return out
}

// PNG encodes the picture quickly: a TV asks for many covers at once.
func PNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
