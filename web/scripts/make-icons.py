"""Generates the PWA / Apple touch icons into web/public/icons (needs Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

TOP = (164, 151, 255)
BOTTOM = (90, 168, 255)

# Same "A" mark as the in-app logo, on a 32-unit grid.
OUTER = [(9, 22.5), (15.2, 9), (16.8, 9), (23, 22.5), (19.9, 22.5), (18.6, 19.5), (13.4, 19.5), (12.1, 22.5)]
COUNTER = [(14.4, 16.9), (17.6, 16.9), (16, 13)]


def gradient(size: int) -> Image.Image:
    a = Image.new("RGB", (size, size), TOP)
    b = Image.new("RGB", (size, size), BOTTOM)
    # Diagonal gradient: rotate an oversized vertical ramp, then crop the centre.
    big = int(size * 1.5)
    mask = Image.linear_gradient("L").resize((big, big)).rotate(45, resample=Image.BICUBIC)
    o = (big - size) // 2
    mask = mask.crop((o, o, o + size, o + size))
    return Image.composite(b, a, mask)


def icon(size: int, *, rounded: bool, scale: float) -> Image.Image:
    big = size * 4
    canvas = gradient(big).convert("RGBA")
    if rounded:
        m = Image.new("L", (big, big), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.28), fill=255)
        canvas.putalpha(m)

    k = big / 32 * scale
    off = big * (1 - scale) / 2
    f = lambda p: (off + p[0] * k, off + p[1] * k + big * 0.01)
    glyph = Image.new("L", (big, big), 0)
    gd = ImageDraw.Draw(glyph)
    gd.polygon([f(p) for p in OUTER], fill=255)
    gd.polygon([f(p) for p in COUNTER], fill=0)
    canvas.paste(Image.new("RGBA", (big, big), (255, 255, 255, 255)), (0, 0), glyph)
    return canvas.resize((size, size), Image.LANCZOS)


icon(192, rounded=True, scale=1).save(OUT / "icon-192.png")
icon(512, rounded=True, scale=1).save(OUT / "icon-512.png")
icon(512, rounded=False, scale=0.72).save(OUT / "maskable-512.png")
# iOS applies its own corner mask: give it a full-bleed square.
icon(180, rounded=False, scale=1).convert("RGB").save(OUT / "apple-touch-icon.png")
icon(32, rounded=True, scale=1).save(OUT / "favicon-32.png")
print("icons written to", OUT)
