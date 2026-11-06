#!/usr/bin/env python3
"""Draw the pictures the Roku app uses into roku/images. Run it again after changing a drawing here.

Needs Inkscape (SVG to PNG) and Pillow. The icons are the web app's (web/src/components/Icon.tsx), drawn white so the
app can tint them with blendColor; the app icon and splash are web/public/icon.svg on Eco's background.
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images")
LOGO = os.path.join(ROOT, "..", "web", "public", "icon.svg")
BG = (11, 11, 15)

# The same drawings as web/src/components/Icon.tsx: (svg body, filled)
HEART = "M12 20.5s-7.5-4.6-9.4-9.7C1.4 7.5 3.4 4.8 6.4 4.8c1.9 0 3.5 1 5.6 3.1 2.1-2.1 3.7-3.1 5.6-3.1 3 0 5 2.7 3.8 6-1.9 5.1-9.4 9.7-9.4 9.7z"
ICONS = {
    "play": ('<path d="M7 4.6v14.8L19.6 12z"/>', True),
    "pause": ('<path d="M6.5 4h3.8v16H6.5zM13.7 4h3.8v16h-3.8z"/>', True),
    "next": ('<path d="M5 5.2v13.6L15 12zM17 5h2.2v14H17z"/>', True),
    "prev": ('<path d="M19 5.2v13.6L9 12zM7 5H4.8v14H7z"/>', True),
    "shuffle": ('<path d="M3 5h3.3c5.2 0 5.2 14 10.4 14H21m0 0-2.8-2.8M21 19l-2.8 2.8M3 19h3.3c1.5 0 2.7-.8 3.6-2M21 5h-3.3c-1.5 0-2.7.8-3.6 2m6.9-2-2.8-2.8M21 5l-2.8 2.8"/>', False),
    "repeat": ('<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>', False),
    "repeat-one": ('<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10.5l1.5-1v5"/>', False),
    "sparkle": ('<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6-5.7-1.8L10.2 9zM19 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>', False),
    "heart": (f'<path d="{HEART}"/>', False),
    "heart-fill": (f'<path d="{HEART}"/>', True),
    "devices": ('<rect x="3" y="5" width="12" height="9" rx="1.5"/><path d="M6 18h6M9 14v4"/><rect x="17" y="8" width="4.5" height="11" rx="1"/>', False),
    "queue": ('<path d="M4 6h12M4 12h12M4 18h7M17 14.5v6l4.5-3z"/>', False),
    "note": ('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', False),
}


def svg_icon(body, filled):
    paint = 'fill="#fff" stroke="none"' if filled else 'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><g {paint}>{body}</g></svg>'


def render(svg_text, path, width, height):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg_text)
        name = f.name
    try:
        subprocess.run(["inkscape", name, "--export-type=png", f"--export-filename={path}", f"--export-width={width}", f"--export-height={height}"],
                       check=True, capture_output=True)
    finally:
        os.unlink(name)


def rounded(size, radius, color=(255, 255, 255, 255), outline=0):
    """A rounded rectangle drawn 4x larger and scaled down, for smooth edges."""
    w, h = size
    k = 4
    img = Image.new("RGBA", (w * k, h * k), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if outline:
        draw.rounded_rectangle((0, 0, w * k - 1, h * k - 1), radius * k, fill=color)
        inner = outline * k
        draw.rounded_rectangle((inner, inner, w * k - 1 - inner, h * k - 1 - inner), max(radius - outline, 0) * k, fill=(0, 0, 0, 0))
    else:
        draw.rounded_rectangle((0, 0, w * k - 1, h * k - 1), radius * k, fill=color)
    return img.resize((w, h), Image.LANCZOS)


def nine_patch(name, radius, outline=0):
    """A white rounded shape that stretches in the middle: Roku reads the black marks on the 1 px border."""
    side = radius * 2 + 2
    shape = rounded((side, side), radius, outline=outline)
    img = Image.new("RGBA", (side + 2, side + 2), (0, 0, 0, 0))
    img.paste(shape, (1, 1))
    px = img.load()
    for x in range(1 + radius, 1 + radius + 2):
        px[x, 0] = (0, 0, 0, 255)  # stretches horizontally here
        px[x, side + 1] = (0, 0, 0, 255)  # content area
    for y in range(1 + radius, 1 + radius + 2):
        px[0, y] = (0, 0, 0, 255)
        px[side + 1, y] = (0, 0, 0, 255)
    img.save(os.path.join(OUT, f"{name}.9.png"))


def logo_on_background(path, width, height, logo_size):
    with open(LOGO) as f:
        logo = f.read()
    tmp = os.path.join(OUT, "_logo.png")
    render(logo, tmp, logo_size, logo_size)
    img = Image.new("RGBA", (width, height), BG + (255,))
    mark = Image.open(tmp)
    img.alpha_composite(mark, ((width - logo_size) // 2, (height - logo_size) // 2))
    img.convert("RGB").save(path)
    os.unlink(tmp)


def main():
    os.makedirs(os.path.join(OUT, "icons"), exist_ok=True)
    for name, (body, filled) in ICONS.items():
        render(svg_icon(body, filled), os.path.join(OUT, "icons", f"{name}.png"), 64, 64)
    logo_on_background(os.path.join(OUT, "icon_focus_hd.png"), 290, 218, 170)
    logo_on_background(os.path.join(OUT, "icon_side_hd.png"), 108, 69, 60)
    logo_on_background(os.path.join(OUT, "splash_fhd.png"), 1920, 1080, 300)
    with open(LOGO) as f:
        render(f.read(), os.path.join(OUT, "logo.png"), 96, 96)
    nine_patch("round", 24)
    nine_patch("round-small", 12)
    nine_patch("pill", 30)
    nine_patch("bar", 5)  # thin progress bars
    # Lists draw their focus with this, tinted with the accent (focusBitmapBlendColor)
    shape = rounded((40, 40), 16, color=(255, 255, 255, 255))
    img = Image.new("RGBA", (42, 42), (0, 0, 0, 0))
    img.paste(shape, (1, 1))
    px = img.load()
    for i in range(19, 23):
        px[i, 0] = px[0, i] = px[i, 41] = px[41, i] = (0, 0, 0, 255)
    img.save(os.path.join(OUT, "focus.9.png"))
    # A cover that is missing or still loading
    empty = Image.new("RGBA", (512, 512), (29, 29, 38, 255))
    tmp = os.path.join(OUT, "_note.png")
    body, filled = ICONS["note"]
    render(svg_icon(body, filled).replace("#fff", "#3a3a48"), tmp, 200, 200)
    empty.alpha_composite(Image.open(tmp), (156, 156))
    empty.convert("RGB").save(os.path.join(OUT, "cover-empty.png"))
    os.unlink(tmp)
    # Cover shapes, the same as the web app's corners setting (soft or sharp) and round artists. Masks are what
    # MaskGroup cuts covers with; rings are the focus outline of the same shape, drawn white and tinted with the accent
    # (a plain picture scaled to the card: 9-patch outlines drew wrong on a real Roku)
    for name, radius in (("soft", 40), ("sharp", 10), ("circle", 256)):
        rounded((512, 512), radius).save(os.path.join(OUT, f"mask-{name}.png"))
        rounded((512, 512), radius, outline=22).save(os.path.join(OUT, f"ring-{name}.png"))
    # The glow of the music's colour behind everything (Ambient in the web app): white, tinted on the TV
    from PIL import ImageFilter
    glow = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(glow).ellipse((96, 96, 416, 416), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    white = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
    white.putalpha(glow)
    white.save(os.path.join(OUT, "glow.png"))
    # The shadow under a big cover
    shadow = Image.new("L", (640, 640), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((70, 80, 570, 580), 40, fill=200)
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    black = Image.new("RGBA", (640, 640), (0, 0, 0, 0))
    black.putalpha(shadow)
    black.save(os.path.join(OUT, "shadow.png"))
    # The logo's mark alone, white, so it can take the accent like the web app's logo
    with open(LOGO) as f:
        mark = f.read()
    mark = mark.replace('<rect width="512" height="512" rx="112" fill="url(#bg)"/>', "").replace('fill="url(#m)"', 'fill="#fff"')
    render(mark, os.path.join(OUT, "logo-mark.png"), 96, 96)
    # Favorites in the accent: a white heart the app puts on the accent colour
    heart = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    tmp = os.path.join(OUT, "_heart2.png")
    render(svg_icon(ICONS["heart-fill"][0], True), tmp, 220, 220)
    heart.alpha_composite(Image.open(tmp), (146, 150))
    heart.save(os.path.join(OUT, "favorites-heart.png"))
    os.unlink(tmp)
    # The veil over the coloured backdrop: darker at the bottom, where most text sits
    veil = Image.new("RGBA", (1, 256))
    for y in range(256):
        veil.putpixel((0, y), BG + (int(110 + 120 * (y / 255) ** 1.4),))
    veil.save(os.path.join(OUT, "veil.png"))
    # Favorites: Eco's own violet with a heart, like the web app's default
    fav = Image.new("RGBA", (512, 512))
    top, bottom = (124, 92, 255), (177, 140, 255)
    for y in range(512):
        for x in range(512):
            t = (x + y) / 1022
            fav.putpixel((x, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    tmp = os.path.join(OUT, "_heart.png")
    body, _ = ICONS["heart-fill"]
    render(svg_icon(body, True), tmp, 220, 220)
    fav.alpha_composite(Image.open(tmp), (146, 150))
    fav.convert("RGB").save(os.path.join(OUT, "favorites.png"))
    os.unlink(tmp)
    print("images written to", OUT)


if __name__ == "__main__":
    sys.exit(main())
