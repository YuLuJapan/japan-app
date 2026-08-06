// One-off asset pipeline for the homepage sushi sequence.
//
// The source frames are 1280px wide, but the hero never renders wider than
// `max-w-app` (480 CSS px) — so full-size frames would ship ~2.7x more pixels
// than any screen can show. This downscales and re-encodes them into
// `public/sushi/`, which is what the app actually loads.
//
//   node scripts/build-sushi-frames.mjs <source-dir> [width] [quality]
//
// Any JPEG/PNG naming works: the directory is listed and sorted by the first
// number in each filename, then written out as a clean frame-001.jpg… run so
// the component can address frames by index. Stale frames from a longer
// previous run are removed, so swapping in a shorter clip can't leave orphans
// behind for the app to load.
//
// Re-run it if the source clip is ever replaced; the output is committed, so
// this is not part of the normal build.
import sharp from 'sharp'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2]
const WIDTH = Number(process.argv[3] || 960)
const QUALITY = Number(process.argv[4] || 72)

if (!SRC) {
  console.error('usage: node scripts/build-sushi-frames.mjs <source-dir> [width] [quality]')
  process.exit(1)
}

const OUT = resolve(HERE, '..', 'public', 'sushi')
mkdirSync(OUT, { recursive: true })

// Sort by the first number in the name, so frame 2 doesn't land after frame 10
// when a source drops the zero padding.
const leadingNumber = (name) => {
  const m = name.match(/\d+/)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}

const sources = readdirSync(SRC)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .sort((a, b) => leadingNumber(a) - leadingNumber(b) || a.localeCompare(b))

if (!sources.length) {
  console.error(`no images found in ${SRC}`)
  process.exit(1)
}

const pad = (n) => String(n).padStart(3, '0')

let total = 0
for (let i = 0; i < sources.length; i++) {
  const info = await sharp(resolve(SRC, sources[i]))
    .resize({ width: WIDTH })
    .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
    .toFile(resolve(OUT, `frame-${pad(i + 1)}.jpg`))
  total += info.size
}

// Drop anything left over from a previous, longer clip.
let removed = 0
for (const f of readdirSync(OUT)) {
  const n = leadingNumber(f)
  if (!Number.isFinite(n) || n > sources.length) {
    rmSync(resolve(OUT, f))
    removed += 1
  }
}

console.log(
  `${WIDTH}px q${QUALITY}: ${sources.length} frames, ${(total / 1048576).toFixed(2)} MB, ` +
    `${Math.round(total / sources.length / 1024)} KB avg → ${OUT}` +
    (removed ? `\nremoved ${removed} stale frame(s)` : '')
)
console.log(`first: ${sources[0]}  last: ${sources[sources.length - 1]}`)
