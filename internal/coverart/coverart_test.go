package coverart

import (
	"image"
	"image/color"
	"testing"
)

func solid(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = 200, 30, 30, 255
	}
	return img
}

func alpha(img *image.NRGBA, x, y int) uint8 { return img.NRGBAAt(x, y).A }

func TestCornersAreCutAndTheMiddleKept(t *testing.T) {
	img := Cut(solid(300, 300), 100, "soft")
	if img.Bounds().Dx() != 100 || img.Bounds().Dy() != 100 {
		t.Fatalf("size %v", img.Bounds())
	}
	if a := alpha(img, 0, 0); a != 0 {
		t.Fatalf("corner alpha %d", a)
	}
	if a := alpha(img, 50, 50); a != 255 {
		t.Fatalf("middle alpha %d", a)
	}
	if a := alpha(img, 50, 0); a != 255 {
		t.Fatalf("an edge between corners was cut: %d", a)
	}
	if c := img.NRGBAAt(50, 50); c != (color.NRGBA{200, 30, 30, 255}) {
		t.Fatalf("colour changed: %v", c)
	}
}

// Smooth edges: some pixel on the curve is neither fully in nor fully out
func TestEdgesAreSmooth(t *testing.T) {
	img := Cut(solid(100, 100), 100, "circle")
	partial := false
	for x := 0; x < 50; x++ {
		if a := alpha(img, x, x); a > 0 && a < 255 { // along the diagonal, the curve crosses some pixel
			partial = true
		}
	}
	if !partial {
		t.Fatal("no anti-aliased pixel on the circle's edge")
	}
	if a := alpha(img, 10, 10); a != 0 {
		t.Fatalf("a circle keeps its corner square: alpha %d", a)
	}
}

// A picture that is not square is cropped in the middle, like object-fit: cover
func TestWidePicturesAreCropped(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 300, 100))
	for x := 0; x < 300; x++ {
		for y := 0; y < 100; y++ {
			c := color.RGBA{0, 0, 255, 255}
			if x >= 100 && x < 200 {
				c = color.RGBA{0, 255, 0, 255}
			}
			img.Set(x, y, c)
		}
	}
	out := Cut(img, 50, "sharp")
	if c := out.NRGBAAt(25, 25); c.G != 255 || c.B != 0 {
		t.Fatalf("expected the green middle, got %v", c)
	}
}

func TestShapes(t *testing.T) {
	for _, s := range []string{"soft", "sharp", "circle"} {
		if !ValidShape(s) {
			t.Fatalf("%s should be valid", s)
		}
	}
	if ValidShape("../x") || ValidShape("") {
		t.Fatal("unknown shapes must be refused")
	}
}
