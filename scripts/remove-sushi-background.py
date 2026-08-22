"""Stage two of the homepage sushi pipeline: cut the studio backdrop out.

    python3 scripts/remove-sushi-background.py [source-dir] [--quality N] [--limit N]

Reads the JPEGs `scripts/build-sushi-frames.mjs` just wrote (default
`public/sushi`), runs rembg over each one, and writes `frame-NNN.webp` with an
alpha channel back into `public/sushi` — then rewrites
`src/generated/sushi-frames.ts` so the component picks up the new count, size,
extension and cache-busting hash. Everything else in `public/sushi` is deleted,
so it never holds two generations at once — which also means the default source
directory only has anything to read straight after a stage-one run. To redo the
cut-out on frames that already shipped, restore the JPEGs somewhere first and
pass that directory.

Requirements (not in package.json — this is a one-off asset step, like the
mjs stage):

    python3 -m venv .venv && .venv/bin/pip install "rembg[cli]" onnxruntime

Three things beyond a plain `rembg i`, all of them about not degrading the
footage the way a naive cut-out does:

1. **No re-encode of the colour.** Pixels are decoded once and written once, as
   lossless WebP at the source's native 1280x720. Nothing is resized, nothing is
   round-tripped through JPEG a second time, and no second generation of
   compression is laid over the first — what the camera's frame survived of
   stage one arrives in the browser intact. `--quality N` switches to lossy
   WebP, which is roughly a third of the size; the sequence ships lossless
   because the frames are already upscaled ~2.5x on screen, where a lossy
   encoder's chroma subsampling would be doing the visible work.

2. **Backdrop decontamination.** A soft edge pixel is a mix of food and grey
   studio wall: `O = a*F + (1-a)*B`. Keeping `O` and just attaching alpha
   leaves the grey in it, which reads as a white halo against the app's warm
   canvas. The backdrop `B` is estimated per frame from the pixels rembg
   marked as background (coarse block means, holes filled from the nearest
   known block, then blurred — the wall is a smooth gradient, so this is
   accurate to a couple of levels), and the mix is solved for `F`.

3. **Temporal smoothing.** Masks are computed per frame with no knowledge of
   the neighbours, so an edge pixel can flip between frames and the silhouette
   crawls during the scrub. Each frame's alpha is the per-pixel median of
   itself and its two neighbours, which removes the single-frame flips without
   softening a genuinely moving edge.
"""

import argparse
import hashlib
import io
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_DIR = ROOT / 'public' / 'sushi'
GENERATED = ROOT / 'src' / 'generated' / 'sushi-frames.ts'

# isnet-general-use over u2net: on this footage u2net leaves a soft glow a few
# pixels wide around the whole silhouette, and loses the rice block in the
# frames where the nigiri has come apart.
MODEL = 'isnet-general-use'
EXT = 'webp'

# Alpha below this is backdrop, not a soft edge; it is cut to zero rather than
# left as a faint wash of grey over the page.
FLOOR = 6 / 255
# Dividing by alpha to unmix means a nearly-transparent pixel is multiplied by a
# huge number, turning JPEG noise into confetti along the edge. Clamping the
# divisor under-corrects the faintest pixels — which are barely visible anyway —
# instead of inventing colour for them.
UNMIX_FLOOR = 0.15
# Size of the blocks the backdrop estimate is built from. Small enough to
# follow the wall's gradient, large enough that each block still contains
# backdrop pixels near the food.
BLOCK = 16


def leading_number(name: str) -> int:
    m = re.search(r'\d+', name)
    return int(m.group(0)) if m else sys.maxsize


def estimate_backdrop(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """The studio wall behind the subject, as a full-resolution RGB image."""
    h, w, _ = rgb.shape
    bh, bw = -(-h // BLOCK), -(-w // BLOCK)
    pad = ((0, bh * BLOCK - h), (0, bw * BLOCK - w))

    known = np.pad(alpha < FLOOR, pad, constant_values=False)
    counts = known.reshape(bh, BLOCK, bw, BLOCK).sum(axis=(1, 3))

    blocks = np.zeros((bh, bw, 3), dtype=np.float32)
    for c in range(3):
        channel = np.pad(rgb[..., c], pad) * known
        sums = channel.reshape(bh, BLOCK, bw, BLOCK).sum(axis=(1, 3))
        blocks[..., c] = np.divide(sums, counts, out=np.zeros_like(sums), where=counts > 0)

    # Blocks sitting entirely on food have no estimate; borrow the nearest one
    # that does, so the fill stays a plausible continuation of the wall.
    holes = counts == 0
    if holes.any():
        if holes.all():
            return np.zeros_like(rgb)
        _, idx = ndimage.distance_transform_edt(holes, return_indices=True)
        blocks = blocks[idx[0], idx[1]]

    blocks = ndimage.gaussian_filter(blocks, sigma=(1.5, 1.5, 0), mode='nearest')

    full = np.array(
        Image.fromarray(np.clip(blocks, 0, 255).astype(np.uint8)).resize(
            (bw * BLOCK, bh * BLOCK), Image.BICUBIC
        ),
        dtype=np.float32,
    )
    return full[:h, :w]


def decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Unmix the backdrop out of the soft edge: F = (O - (1-a)B) / a."""
    backdrop = estimate_backdrop(rgb, alpha)
    a = np.maximum(alpha, UNMIX_FLOOR)[..., None]
    fg = (rgb - (1.0 - a) * backdrop) / a
    # Only the edge needs this; leaving the interior untouched guarantees the
    # food's own pixels come through the pipeline bit-for-bit.
    edge = (alpha > FLOOR) & (alpha < 1.0)
    return np.where(edge[..., None], np.clip(fg, 0, 255), rgb)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('source', nargs='?', default=str(OUT_DIR))
    ap.add_argument(
        '--quality',
        type=int,
        default=0,
        help='encode lossy WebP at this quality instead of lossless',
    )
    ap.add_argument('--limit', type=int, default=0, help='process only the first N frames')
    ap.add_argument('--out', default=str(OUT_DIR), help='where to write (for trial runs)')
    args = ap.parse_args()

    out_dir = Path(args.out).resolve()

    src_dir = Path(args.source).resolve()
    sources = sorted(
        (f for f in src_dir.iterdir() if f.suffix.lower() in {'.jpg', '.jpeg', '.png'}),
        key=lambda f: (leading_number(f.name), f.name),
    )
    if args.limit:
        sources = sources[: args.limit]
    if not sources:
        print(f'no frames found in {src_dir}', file=sys.stderr)
        return 1

    from rembg import new_session, remove

    session = new_session(MODEL)
    out_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256()
    written: list[Path] = []
    total = 0
    height = width = 0

    # A three-frame ring buffer: frame i can only be written once i+1's mask
    # exists, so the loop runs one frame behind and flushes at the end.
    frames: list[np.ndarray] = []
    masks: list[np.ndarray] = []

    def emit(i: int) -> None:
        nonlocal total, width, height
        window = masks[max(0, i - 1) : i + 2]
        alpha = np.median(np.stack(window), axis=0) if len(window) > 1 else masks[i]
        rgb = decontaminate(frames[i], alpha)

        out = np.empty((*alpha.shape, 4), dtype=np.uint8)
        out[..., :3] = np.rint(rgb).astype(np.uint8)
        out[..., 3] = np.rint(np.where(alpha < FLOOR, 0.0, alpha) * 255).astype(np.uint8)

        image = Image.fromarray(out, 'RGBA')
        buf = io.BytesIO()
        if args.quality:
            image.save(buf, 'WEBP', quality=args.quality, alpha_quality=100, method=6)
        else:
            # `quality` is read as an effort dial in lossless mode, not as a
            # fidelity one — the output is bit-exact either way.
            image.save(buf, 'WEBP', lossless=True, quality=80, method=6)
        data = buf.getvalue()

        path = out_dir / f'frame-{i + 1:03d}.{EXT}'
        path.write_bytes(data)
        written.append(path)
        digest.update(data)
        total += len(data)
        height, width = alpha.shape

    for n, src in enumerate(sources):
        with Image.open(src) as image:
            rgb = image.convert('RGB')
            frames.append(np.asarray(rgb, dtype=np.float32))
            masks.append(np.asarray(remove(rgb, session=session, only_mask=True), dtype=np.float32) / 255)
        if n:
            emit(n - 1)
        # Only the previous, current and next frame are ever needed.
        if n >= 2:
            frames[n - 2] = None  # type: ignore[call-overload]
            masks[n - 2] = None  # type: ignore[call-overload]
        if (n + 1) % 25 == 0:
            print(f'  {n + 1}/{len(sources)}', flush=True)
    emit(len(sources) - 1)

    # A trial run is a subset by definition, so it must not take the rest of
    # the sequence with it.
    keep = {p.name for p in written}
    removed = 0
    if not args.limit:
        for f in out_dir.iterdir():
            if f.name not in keep:
                f.unlink()
                removed += 1

    version = digest.hexdigest()[:8]
    encoding = f'q{args.quality}' if args.quality else 'lossless'
    print(
        f'{width}x{height} {encoding}: {len(sources)} frames, '
        f'{total / 1048576:.2f} MB, {round(total / len(sources) / 1024)} KB avg'
    )
    if removed:
        print(f'removed {removed} stale frame(s)')
    print(f'asset version: {version}')
    if args.limit:
        print(f'trial run of {len(sources)} frames — {GENERATED.name} left alone')
        return 0

    GENERATED.parent.mkdir(parents=True, exist_ok=True)
    GENERATED.write_text(
        f"""// Generated by scripts/remove-sushi-background.py — do not edit by hand.
//
// ASSET_VERSION is a content hash of every frame. It is appended to each frame
// URL so a regenerated sequence gets fresh URLs; without it the service
// worker's CacheFirst rule happily mixes an old cached generation with a new
// one, and the animation jumps mid-scroll.
export const FRAME_COUNT = {len(sources)}
export const FRAME_WIDTH = {width}
export const FRAME_HEIGHT = {height}
export const FRAME_EXT = '{EXT}'
export const ASSET_VERSION = '{version}'
"""
    )

    print(f'wrote {GENERATED}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
