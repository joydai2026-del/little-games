# Derive the web Momo assets from the LOCKED PNGs only (never new art):
# matte the flat cream paper to transparent (flood fill from the border), trim,
# downscale, quantize. Run from the repo root:
#   python3 scripts/make-momo-assets.py avery-brand
# Writes momo.png (256 px, from momo-brush-official.png), momo-icon.png (64 px)
# and momo-icon-128.png (128 px, for the offline spikes), both from
# momo-brush-tpt-icon.png. Needs Pillow.
import sys, os
from collections import deque
from PIL import Image
SRC = "docs/avery/brand/avatars/momo"
def matte(path, tol_in=18, tol_out=46):
    im = Image.open(path).convert("RGB"); w, h = im.size; px = im.load()
    # background colour = median of border pixels
    border = [px[x, 0] for x in range(w)] + [px[x, h-1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w-1, y] for y in range(h)]
    bg = tuple(sorted(c[i] for c in border)[len(border)//2] for i in range(3))
    def d(c): return max(abs(c[0]-bg[0]), abs(c[1]-bg[1]), abs(c[2]-bg[2]))
    seen = bytearray(w*h); alpha = Image.new("L", (w, h), 255); ap = alpha.load()
    q = deque()
    for x in range(w): q.extend([(x, 0), (x, h-1)])
    for y in range(h): q.extend([(0, y), (w-1, y)])
    while q:
        x, y = q.popleft(); i = y*w+x
        if seen[i]: continue
        seen[i] = 1
        dd = d(px[x, y])
        if dd > tol_out: continue
        # soft edge: fully clear inside tol_in, ramp to opaque at tol_out
        ap[x, y] = 0 if dd <= tol_in else int(255*(dd-tol_in)/(tol_out-tol_in))
        if dd <= tol_in:
            for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                if 0 <= nx < w and 0 <= ny < h and not seen[ny*w+nx]: q.append((nx, ny))
    rgba = im.convert("RGBA"); rgba.putalpha(alpha)
    bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    return rgba.crop(bbox), bg
def square(img, size, pad=0.04):
    w, h = img.size; side = int(max(w, h)*(1+2*pad))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side-w)//2, (side-h)//2), img)
    small = canvas.resize((size, size), Image.LANCZOS)
    return small.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
out = sys.argv[1]
hero, bg1 = matte(f"{SRC}/momo-brush-official.png")
icon, bg2 = matte(f"{SRC}/momo-brush-tpt-icon.png")
print("bg", bg1, bg2, "trim", hero.size, icon.size)
square(hero, 256).save(f"{out}/momo.png", optimize=True)
square(icon, 64, pad=0.02).save(f"{out}/momo-icon.png", optimize=True)
square(icon, 128, pad=0.02).save(f"{out}/momo-icon-128.png", optimize=True)
for n in ("momo.png", "momo-icon.png", "momo-icon-128.png"): print(n, os.path.getsize(f"{out}/{n}"))
