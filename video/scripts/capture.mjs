// Screens for the video, captured from the real app.
//
// Not mockups: this drives the production build against scripts/demo-server.ts
// (memory datastore, real placeholder content, one stubbed demo account) at a
// phone viewport, and writes PNGs the Remotion composition composes into a
// device frame. If the app changes, re-running this changes the video — which
// is the point of capturing rather than drawing.
import { chromium, devices } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.DEMO_URL ?? 'http://localhost:4321'
const OUT = fileURLToPath(new URL('../public/screens/', import.meta.url))
const TRIP = 'trip-japan'

/** A tall phone at 3x, so the stills stay sharp scaled into a 1080² frame. */
const PHONE = { ...devices['iPhone 13 Pro'], deviceScaleFactor: 3, isMobile: true }

/**
 * Each shot: a route, a thing to wait for, and optionally what to scroll into
 * view first. A screenshot is one viewport, so without `scrollTo` a long
 * screen only ever shows its header — which is how the journey shot ended up
 * being the hero animation rather than the journey.
 *
 * `scrollTo` is a selector rather than a pixel offset on purpose: the page
 * height moves with the content and with whether the hero is pinned, so a
 * number that framed the right thing today frames something else tomorrow.
 */
const SHOTS = [
  { name: 'trips', url: '/trips', wait: 'text=Where to' },
  // Past the pinned sushi hero, onto the stops themselves.
  { name: 'journey', url: `/trips/${TRIP}`, wait: 'text=The journey', scrollTo: 'text=The journey' },
  { name: 'zone', url: `/trips/${TRIP}/zones/zone-tokyo`, wait: 'text=Tokyo' },
  { name: 'schedule', url: `/trips/${TRIP}/journey/edit`, wait: 'body' },
  { name: 'shopping', url: `/trips/${TRIP}/shopping`, wait: 'body' },
  { name: 'reminders', url: `/trips/${TRIP}/reminders`, wait: 'body' },
  { name: 'documents', url: `/trips/${TRIP}/files`, wait: 'text=Trip documents' },
  // The document open, not just listed — "your papers travel with you" only
  // lands if you see one of them on screen.
  { name: 'document-open', url: `/trips/${TRIP}/files/file-flight`, wait: 'body' },
  { name: 'members', url: `/trips/${TRIP}/members`, wait: 'text=Who' },
  { name: 'essentials', url: `/trips/${TRIP}/essentials`, wait: 'body' },
]

const settle = (page, ms = 900) => page.waitForTimeout(ms)

/**
 * The app's typefaces, inlined.
 *
 * index.html loads them from Google Fonts, which this container cannot reach —
 * so every capture was quietly falling back to a system sans, and the video
 * would have shown a product that isn't quite the product. The same woff2
 * files the composition uses are injected as data URLs instead.
 */
async function inlineBrandFonts(context) {
  const dir = fileURLToPath(new URL('../public/fonts/', import.meta.url))
  const faces = await Promise.all(
    [
      ['Outfit', 'Outfit.woff2'],
      ['Plus Jakarta Sans', 'PlusJakartaSans.woff2'],
    ].map(async ([family, file]) => {
      const b64 = (await readFile(path.join(dir, file))).toString('base64')
      return `@font-face{font-family:'${family}';font-display:block;font-weight:100 900;` +
        `src:url(data:font/woff2;base64,${b64}) format('woff2')}`
    })
  )
  await context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)
    })
  }, faces.join(''))
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  })
  const context = await browser.newContext({
    ...PHONE,
    // The app reads its bearer token from localStorage; the demo server's
    // verifier resolves this one string to the demo account.
    storageState: {
      cookies: [],
      origins: [
        { origin: BASE, localStorage: [{ name: 'trip_access_code', value: 'demo.jwt' }] },
      ],
    },
  })
  await inlineBrandFonts(context)
  // Animations that never settle make a still look half-drawn.
  await context.addInitScript(() => {
    // eslint-disable-next-line no-undef
    window.matchMedia = ((orig) => (q) =>
      q.includes('prefers-reduced-motion')
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
        : orig(q))(window.matchMedia.bind(window))
  })

  const page = await context.newPage()
  const captured = []

  for (const shot of SHOTS) {
    await page.goto(`${BASE}${shot.url}`, { waitUntil: 'networkidle' })
    try {
      await page.waitForSelector(shot.wait, { timeout: 8000 })
    } catch {
      console.warn(`! ${shot.name}: "${shot.wait}" never appeared — capturing anyway`)
    }
    if (shot.scrollTo) {
      // `start` so the heading sits just under the sticky header, with the
      // content it introduces filling the rest of the shot.
      await page.locator(shot.scrollTo).first().scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy({ top: -96, behavior: 'instant' }))
      await settle(page, 600)
    }
    await settle(page)
    // An error card or a skeleton makes a still that looks like the product is
    // broken. Better to fail the capture than to ship that frame.
    const body = (await page.textContent('body')) ?? ''
    for (const bad of ['Could not load', 'Something went wrong']) {
      if (body.includes(bad)) throw new Error(`${shot.name}: page shows "${bad}"`)
    }
    const file = path.join(OUT, `${shot.name}.png`)
    await page.screenshot({ path: file })
    captured.push(shot.name)
    console.log(`✓ ${shot.name}`)
  }

  await browser.close()
  console.log(`\n${captured.length} screens → ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
