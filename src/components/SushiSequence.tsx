// Scroll-linked image sequence for the homepage hero: a piece of nigiri that
// comes apart as you scroll, with the trip title sitting on top of it.
//
// Frames live in `public/sushi/` (built by scripts/build-sushi-frames.mjs, then
// cut out of their studio backdrop by scripts/remove-sushi-background.py) and
// are drawn to a canvas — 322 <img> tags would be far heavier than one canvas
// we repaint. They carry alpha, so the food sits directly on the page's own
// canvas colour with nothing behind it.
//
// GSAP + ScrollTrigger are loaded dynamically so they land in their own chunk
// instead of the main bundle; the hero renders a still frame while that chunk
// arrives, so nothing pops in.
//
// Reduced motion gets no pin and no scrub: just the first frame, cut once to
// the last frame when the hero reaches the middle of the screen.
import { useEffect, useRef, useState } from 'react'
import {
  ASSET_VERSION,
  FRAME_COUNT,
  FRAME_EXT,
  FRAME_HEIGHT,
  FRAME_WIDTH,
} from '../generated/sushi-frames'

const DIR = '/sushi/'
const FIRST = 1
// Count, size and cache-busting version all come from the asset build, so they
// cannot drift from what is actually in public/sushi.
const LAST = FRAME_COUNT

// Intrinsic size of the generated frames — kept at the source's native width.
// The hero crops to roughly the middle 40% of each frame, so downscaling the
// files first would just mean upscaling that crop back on screen. The rest of
// the frame is transparent, which costs almost nothing to store.
const IW = FRAME_WIDTH
const IH = FRAME_HEIGHT

// The part of the frame that must stay on screen, in source pixels: the
// nigiri plus a little air. Framing is computed from this rather than from the
// whole image, so the food stays large on a phone instead of sitting small in
// the middle of a mostly empty frame.
const SAFE = { cx: 640, cy: 355, w: 533, h: 613 }

const MAX_DPR = 2

// Height of the sticky app header (Layout.tsx: py-4 around a 40px control).
// The hero fills everything below it, and pins exactly where it already sits
// so nothing jumps on the first scroll.
const HEADER = 72

// The version query is what keeps a regenerated sequence from being served as
// a mix of old cached frames and new network ones by the CacheFirst rule in
// vite.config.ts. Without it the animation replays its second half mid-scroll.
const frameUrl = (n: number) =>
  `${DIR}frame-${String(n).padStart(3, '0')}.${FRAME_EXT}?v=${ASSET_VERSION}`

/**
 * Every Nth frame. The source is ~60fps; a phone sampling every 2nd frame
 * still gets ~6px of scroll per frame, which is finer than the eye resolves,
 * for half the bytes.
 */
function frameUrls(step: number) {
  const urls: string[] = []
  for (let i = FIRST; i <= LAST; i += step) urls.push(frameUrl(i))
  // Whatever the step, the sequence has to end on the fully exploded frame.
  if (urls[urls.length - 1] !== frameUrl(LAST)) urls.push(frameUrl(LAST))
  return urls
}

function pickStep() {
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return 4
  return window.innerWidth < 768 ? 2 : 1
}

type View = { dx: number; dy: number; dw: number; dh: number; cssW: number; cssH: number }

/**
 * Fit a frame to the stage: never smaller than "contain", but zoomed in far
 * enough that SAFE fills the box. Returns the destination rect.
 */
function computeView(cssW: number, cssH: number): View {
  const contain = Math.min(cssW / IW, cssH / IH)
  const fillSafe = Math.min(cssW / SAFE.w, cssH / SAFE.h)
  const scale = Math.max(contain, fillSafe)

  const dw = IW * scale
  const dh = IH * scale
  let dx = cssW / 2 - SAFE.cx * scale
  let dy = cssH / 2 - SAFE.cy * scale

  dx = dw >= cssW ? Math.max(cssW - dw, Math.min(0, dx)) : (cssW - dw) / 2
  dy = dh >= cssH ? Math.max(cssH - dh, Math.min(0, dy)) : (cssH - dh) / 2

  return { dx, dy, dw, dh, cssW, cssH }
}

/**
 * Load every frame (and decode it) before the scrub is wired up, so scrolling
 * can never land on a frame that hasn't arrived. A frame that 404s resolves as
 * null rather than stalling the whole hero.
 */
function preload(urls: string[], onProgress: (ratio: number) => void, alive: () => boolean) {
  return new Promise<(HTMLImageElement | null)[]>((resolve) => {
    const out: (HTMLImageElement | null)[] = new Array(urls.length).fill(null)
    let done = 0
    let next = 0
    const CONCURRENCY = 8

    const finish = (i: number, img: HTMLImageElement | null) => {
      if (!alive()) return
      out[i] = img
      done += 1
      onProgress(done / urls.length)
      if (done === urls.length) resolve(out)
      else pump()
    }

    const load = (i: number) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        if (img.decode)
          img.decode().then(
            () => finish(i, img),
            () => finish(i, img)
          )
        else finish(i, img)
      }
      img.onerror = () => finish(i, null)
      img.src = urls[i]
    }

    const pump = () => {
      while (next < urls.length && next - done < CONCURRENCY) load(next++)
    }
    pump()
  })
}

export function SushiSequence({
  title,
  meta,
  eyebrow = 'Our trip',
  // How much scroll the sequence consumes once pinned. Shorten this to bring
  // the countdown up sooner; '+=0%' effectively disables the pin.
  scrollLength = '+=150%',
}: {
  title: string
  meta?: string
  eyebrow?: string
  scrollLength?: string
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  // The hero fills the screen, so the countdown below it is out of sight until
  // the pin releases — the hint says there's more down there.
  const [cueVisible, setCueVisible] = useState(true)

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    // jsdom has no 2D context — the hero degrades to its title, which is what
    // the page tests assert on. The context must keep its alpha channel: the
    // frames are cut-outs, and the page's canvas colour shows through them.
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let alive = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let images: (HTMLImageElement | null)[] = []
    let view: View | null = null
    let index = 0
    let dirty = true

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const cssW = stage.clientWidth
      const cssH = stage.clientHeight
      if (!cssW || !cssH) return
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      view = computeView(cssW, cssH)
      dirty = true
    }

    const paint = () => {
      if (!view) return
      let img = images[index]
      // Step back rather than flash a blank card if a frame failed to load.
      for (let j = index; j >= 0 && !img; j--) img = images[j]
      if (!img) return

      const { dx, dy, dw, dh, cssW, cssH } = view
      // Clear rather than fill: the stage's own background is the backdrop now,
      // and letterboxing needs no hiding when the frame's edges are empty.
      ctx.clearRect(0, 0, cssW, cssH)
      ctx.drawImage(img, dx, dy, dw, dh)
    }

    let cleanupAnimation: (() => void) | undefined

    const urls = reduced ? [frameUrl(FIRST), frameUrl(LAST)] : frameUrls(pickStep())

    // Paint frame 1 the moment it decodes, so the card is never empty while the
    // rest of the sequence streams in.
    const firstFrame = new Image()
    firstFrame.onload = () => {
      if (!alive || images.length) return
      images = [firstFrame]
      layout()
      paint()
    }
    firstFrame.src = urls[0]

    preload(urls, setProgress, () => alive).then((loaded) => {
      if (!alive) return
      images = loaded
      layout()
      paint()
      setReady(true)

      if (reduced) {
        // No pin, no scrub — one cut from the first frame to the last.
        const io = new IntersectionObserver(
          ([entry]) => {
            index = entry.isIntersecting ? images.length - 1 : 0
            paint()
          },
          { rootMargin: '-50% 0px -50% 0px' }
        )
        io.observe(stage)
        cleanupAnimation = () => io.disconnect()
        return
      }

      Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
        .then(([{ gsap }, { ScrollTrigger }]) => {
          if (!alive) return
          gsap.registerPlugin(ScrollTrigger)
          ScrollTrigger.config({ ignoreMobileResize: true })

          const state = { frame: 0 }
          const tween = gsap.to(state, {
            frame: images.length - 1,
            ease: 'none',
            snap: { frame: 1 },
            scrollTrigger: {
              trigger: stage,
              // Pin below the sticky app header rather than under it.
              start: `top ${HEADER}px`,
              end: scrollLength,
              pin: stage,
              pinSpacing: true,
              anticipatePin: 1,
              scrub: 0.6,
              invalidateOnRefresh: true,
            },
            onUpdate: () => {
              const i = Math.round(state.frame)
              if (i !== index) {
                index = i
                dirty = true
                // Hide the "keep scrolling" hint once the sequence is moving.
                // React bails out when the boolean is unchanged, so this is a
                // no-op on all but the two frames where it flips.
                setCueVisible(i < images.length * 0.1)
              }
            },
          })

          // Repaint at most once per frame, and only when the index moved.
          const tick = () => {
            if (!dirty) return
            dirty = false
            paint()
          }
          gsap.ticker.add(tick)

          let resizeTimer: ReturnType<typeof setTimeout>
          const onResize = () => {
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => {
              layout()
              paint()
              ScrollTrigger.refresh()
            }, 150)
          }
          window.addEventListener('resize', onResize)

          cleanupAnimation = () => {
            clearTimeout(resizeTimer)
            window.removeEventListener('resize', onResize)
            gsap.ticker.remove(tick)
            tween.scrollTrigger?.kill()
            tween.kill()
          }
        })
        .catch(() => {
          /* offline or chunk blocked: the still frame above is enough */
        })
    })

    return () => {
      alive = false
      cleanupAnimation?.()
    }
  }, [scrollLength])

  return (
    // Full-bleed: -mx-5 cancels the padding on <main>, -mt-1 its top padding,
    // so the hero runs edge to edge and fills the screen under the header.
    // The margins live on this wrapper rather than on the stage itself —
    // ScrollTrigger copies a pinned element's margins onto its pin-spacer, and
    // negative ones would then be applied twice and drag the hero off-screen.
    <div className="-mx-5 -mt-1">
      <div
        ref={stageRef}
        // Height must stay in step with HEADER above.
        className="relative isolate h-[calc(100svh-72px)] overflow-hidden bg-canvas"
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

        {/* Keeps the title readable where a frame's food reaches up behind it. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-canvas/85 to-transparent" />

        <div className="relative flex h-full flex-col p-5">
          <p className="section-title text-brand">{eyebrow}</p>
          <h1 className="mt-1 max-w-[9ch] font-display text-4xl font-extrabold leading-[1.03] tracking-tight drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">
            {title}
          </h1>
          {meta && <p className="mt-1.5 text-sm font-medium text-muted">{meta}</p>}
        </div>

        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 text-muted transition-opacity duration-500 ${
            cueVisible && ready ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Scroll</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>

        {/* Quiet progress hairline while the frames arrive. */}
        {!ready && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/5">
            <div
              className="h-full bg-brand/70 transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
