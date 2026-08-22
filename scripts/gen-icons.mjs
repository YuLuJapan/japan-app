// Generate the app icons: the Onward ring mark — a white ring on the coral
// brand color, the same mark <RingMark> draws in the app headers.
// Pure vector (no fonts), rasterized to PNG with sharp. Run: node scripts/gen-icons.mjs
import sharp from 'sharp'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

const BRAND = '#F1543F' // tailwind `brand`

// RingMark's proportions (ring 0.38 of the square, 2.5px stroke at 34px), scaled
// up ~20% so the ring still reads as a ring in a 16px browser tab. The ring's own
// stroke:diameter stays as the component draws it.
const RING_D = 0.46 * 512
const STROKE = 0.09 * 512
const CORNER = 0.35 * 512 // RingMark: borderRadius = size * 0.35

function svg(size, { rounded }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? CORNER : 0}" fill="${BRAND}"/>
  <circle cx="256" cy="256" r="${(RING_D - STROKE) / 2}" fill="none" stroke="#ffffff" stroke-width="${STROKE}"/>
</svg>`
}

const outDir = path.join(process.cwd(), 'public')
mkdirSync(outDir, { recursive: true })

const jobs = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  // maskable: full bleed — the launcher applies its own shape, and the ring sits
  // well inside the 80% safe circle.
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  // iOS rounds (and un-alphas) this one itself: ship it square and opaque, or
  // the transparent corners come back composited on black.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, opaque: true },
  { file: 'favicon-32.png', size: 32, rounded: true },
]

for (const j of jobs) {
  let img = sharp(Buffer.from(svg(j.size, { rounded: j.rounded })))
  if (j.opaque) img = img.flatten({ background: BRAND })
  await img.png().toFile(path.join(outDir, j.file))
  console.log('wrote public/' + j.file)
}
console.log('done')
