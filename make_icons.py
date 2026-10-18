#!/usr/bin/env python3
"""Generate PWA / apple-touch icons for the dining site.

A plate flanked by a fork and knife, in Stanford cardinal. Drawn geometrically at 4x
and downsampled, because PIL has no antialiasing on primitives.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "icons")
CARDINAL = (140, 21, 21, 255)
WHITE = (255, 255, 255, 255)


def icon(size, pad_bg=True):
    S = size * 4
    img = Image.new("RGBA", (S, S), CARDINAL if pad_bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = S / 2, S / 2

    # plate
    r = S * 0.235
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=int(S * 0.038))
    r2 = S * 0.125
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=WHITE, width=int(S * 0.022))

    # fork: handle + three tines, left of the plate
    fx = S * 0.175
    w = S * 0.026
    d.rounded_rectangle([fx - w / 2, cy - S * 0.085, fx + w / 2, cy + S * 0.30],
                        radius=w / 2, fill=WHITE)
    for dx in (-S * 0.042, 0, S * 0.042):
        d.rounded_rectangle([fx + dx - w * 0.38, cy - S * 0.30,
                             fx + dx + w * 0.38, cy - S * 0.085],
                            radius=w * 0.38, fill=WHITE)

    # knife: handle + tapered blade, right of the plate
    kx = S * 0.825
    d.rounded_rectangle([kx - w / 2, cy - S * 0.02, kx + w / 2, cy + S * 0.30],
                        radius=w / 2, fill=WHITE)
    d.polygon([(kx - w * 0.95, cy - S * 0.02), (kx + w * 0.95, cy - S * 0.02),
               (kx + w * 0.55, cy - S * 0.30), (kx - w * 0.20, cy - S * 0.26)], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
made = []
for s in (180, 192, 512):
    p = os.path.join(OUT, f"icon-{s}.png")
    icon(s).save(p, optimize=True)
    made.append((f"icon-{s}.png", os.path.getsize(p)))

# maskable: same art inset so Android's circle crop cannot clip the utensils
m = Image.new("RGBA", (512, 512), CARDINAL)
inner = icon(360, pad_bg=False)
m.paste(inner, (76, 76), inner)
m.save(os.path.join(OUT, "maskable-512.png"), optimize=True)
made.append(("maskable-512.png", os.path.getsize(os.path.join(OUT, "maskable-512.png"))))

for n, b in made:
    print(f"  {n:20} {b/1024:6.1f} KB")
