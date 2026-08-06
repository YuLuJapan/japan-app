// One-off asset pipeline for the homepage sushi sequence.
//
// The 161 source frames are 1280px wide, but the hero never renders wider than
// `max-w-app` (480 CSS px) — so full-size frames would ship ~2.7x more pixels
// than any screen can show. This downscales and re-encodes them into
// `public/sushi/`, which is what the app actually loads.
//
//   node scripts/build-sushi-frames.mjs <source-dir> [width] [quality]
//
// Re-run it if the source clip is ever replaced; the output is committed, so
// this is not part of the normal build.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2]
const WIDTH = Number(process.argv[3] || 960)
const QUALITY = Number(process.argv[4] || 72)
const FIRST = 1
const LAST = 161

if (!SRC) {
  console.error('usage: node scripts/build-sushi-frames.mjs <source-dir> [width] [quality]')
  process.exit(1)
}

const OUT = resolve(HERE, '..', 'public', 'sushi')
mkdirSync(OUT, { recursive: true })

const pad = (n) => String(n).padStart(3, '0')

let total = 0
for (let i = FIRST; i <= LAST; i++) {
  const info = await sharp(resolve(SRC, `ezgif-frame-${pad(i)}.jpg`))
    .resize({ width: WIDTH })
    .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
    .toFile(resolve(OUT, `frame-${pad(i)}.jpg`))
  total += info.size
}

const count = LAST - FIRST + 1
console.log(
  `${WIDTH}px q${QUALITY}: ${count} frames, ${(total / 1048576).toFixed(2)} MB, ` +
    `${Math.round(total / count / 1024)} KB avg → ${OUT}`
)
