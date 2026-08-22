// Scroll-linked image sequence for the homepage hero: a piece of nigiri that
// comes apart as you scroll, with the trip title sitting on top of it.
//
// Frames live in `public/sushi/` (see scripts/build-sushi-frames.mjs) and are
// drawn to a canvas — 322 <img> tags would be far heavier than one canvas we
// repaint. GSAP + ScrollTrigger are loaded dynamically so they land in their
// own chunk instead of the main bundle; the hero renders a still frame while
// that chunk arrives, so nothing pops in.
//
// Reduced motion gets no pin and no scrub: just the first frame, cut once to
// the last frame when the hero reaches the middle of the screen.
//
// "Get started" is the escape hatch: scrubbing 150% of a viewport by hand is a
// chore on a phone, so the mark under the nigiri tweens the window past the
// pinned hero for you. It moves the scroll position rather than jumping it, so
// the sequence still plays — it just plays itself, in the background, on the
// way down, and any real scroll input hands control straight back.
//
// The mark is deliberately almost nothing: a letterspaced label over a rule
// with a segment tracing down it. No container, no fill, no shadow — the
// artwork stays the hero rather than competing with a solid button. Seven
// other treatments (a coral pill, a frosted chip, a full-width bar, a
// fold-in-place hero, a tap-through stories bar…) were built and compared on
// device before this one won; they are in the history around 3701e19 if a
// comparison is ever wanted again.
import { useEffect, useRef, useState } from 'react'
import { HeroTitle } from './HeroTitle'
import { ASSET_VERSION, FRAME_COUNT, FRAME_HEIGHT, FRAME_WIDTH } from '../generated/sushi-frames'

const DIR = '/sushi/'
const FIRST = 1
// Count, size and cache-busting version all come from the asset build, so they
// cannot drift from what is actually in public/sushi.
const LAST = FRAME_COUNT

// Intrinsic size of the generated frames — kept at the source's native width.
// The hero crops to roughly the middle 40% of each frame, so downscaling the
// files first would just mean upscaling that crop back on screen.
const IW = FRAME_WIDTH
const IH = FRAME_HEIGHT

// The part of the frame that must stay on screen, in source pixels: the
// nigiri plus a little air. Framing is computed from this rather than from the
// whole image, so the food stays large on a phone instead of floating in the
// middle of the studio backdrop.
const SAFE = { cx: 640, cy: 355, w: 533, h: 613 }

const MAX_DPR = 2

// Height of the sticky app header (Layout.tsx: py-4 around a 40px control).
// The hero fills everything below it, and pins exactly where it already sits
// so nothing jumps on the first scroll.
const HEADER = 72

// The version query is what keeps a regenerated sequence from being served as
// a mix of old cached frames and new network ones by the CacheFirst rule in
// vite.config.ts. Without it the animation replays its second half mid-scroll.
const frameUrl = (n: number) => `${DIR}frame-${String(n).padStart(3, '0')}.jpg?v=${ASSET_VERSION}`

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
  destination,
  meta,
  eyebrow = 'Our trip',
  // How much scroll the sequence consumes once pinned. Shorten this to bring
  // the countdown up sooner; '+=0%' effectively disables the pin.
  scrollLength = '+=150%',
}: {
  title: string
  destination?: string
  meta?: string
  eyebrow?: string
  scrollLength?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Stops the "get started" scroll tween mid-flight (and unbinds its
  // listeners); null whenever no tween is running.
  const skipTweenRef = useRef<(() => void) | null>(null)
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
    // the page tests assert on.
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let alive = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let images: (HTMLImageElement | null)[] = []
    let view: View | null = null
    let bg = '#e9ebec'
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
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, cssW, cssH)
      ctx.drawImage(img, dx, dy, dw, dh)

      // Where letterboxing is unavoidable, stretch the frame's own edge pixels
      // into the gap so there's no seam against the studio backdrop.
      if (dy > 0) ctx.drawImage(img, 0, 0, IW, 2, dx, 0, dw, dy + 1)
      const gapB = cssH - (dy + dh)
      if (gapB > 0) ctx.drawImage(img, 0, IH - 2, IW, 2, dx, dy + dh - 1, dw, gapB + 1)
      if (dx > 0) ctx.drawImage(img, 0, 0, 2, IH, 0, dy, dx + 1, dh)
      const gapR = cssW - (dx + dw)
      if (gapR > 0) ctx.drawImage(img, IW - 2, 0, 2, IH, dx + dw - 1, dy, gapR + 1, dh)
    }

    // Match the card to the frames' backdrop so the canvas edges disappear.
    const sampleBackground = (img: HTMLImageElement | null) => {
      if (!img) return
      try {
        const c = document.createElement('canvas')
        c.width = 1
        c.height = 1
        const c2 = c.getContext('2d')
        if (!c2) return
        c2.drawImage(img, 2, 2, 1, 1, 0, 0, 1, 1)
        const [r, g, b] = c2.getImageData(0, 0, 1, 1).data
        bg = `rgb(${r},${g},${b})`
        stage.style.backgroundColor = bg
      } catch {
        /* keep the fallback colour */
      }
    }

    let cleanupAnimation: (() => void) | undefined

    const urls = reduced ? [frameUrl(FIRST), frameUrl(LAST)] : frameUrls(pickStep())

    // Paint frame 1 the moment it decodes, so the card is never empty while the
    // rest of the sequence streams in.
    const firstFrame = new Image()
    firstFrame.onload = () => {
      if (!alive || images.length) return
      images = [firstFrame]
      sampleBackground(firstFrame)
      layout()
      paint()
    }
    firstFrame.src = urls[0]

    preload(urls, setProgress, () => alive).then((loaded) => {
      if (!alive) return
      images = loaded
      sampleBackground(images[0])
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

  useEffect(() => () => skipTweenRef.current?.(), [])

  /**
   * Scroll the window to just past the hero, so the content below lands under
   * the sticky header. The pin is driven by scroll position, so animating that
   * position plays the sequence out on the way rather than cutting past it.
   */
  const skipToContent = () => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    skipTweenRef.current?.()

    // Once ScrollTrigger pins the stage it wraps it in a pin-spacer, which
    // this wrapper still contains — so its bottom is the end of the hero
    // whether the sequence is pinned, reduced-motion, or never loaded at all.
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const to = Math.min(wrapper.getBoundingClientRect().bottom + window.scrollY - HEADER, max)
    const from = window.scrollY
    const distance = to - from
    if (distance <= 0) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof requestAnimationFrame !== 'function') {
      window.scrollTo(0, to)
      return
    }

    // Deliberately unhurried: the point of moving the scroll instead of
    // jumping it is that the nigiri comes apart on the way, and at speed that
    // reads as a smear. About 3s for a full hero — slow enough to watch, and
    // interruptible on the first swipe, which is what keeps it from feeling
    // like a cutscene you have to sit through.
    const duration = Math.min(3200, Math.max(1800, distance * 1.5))
    // Sine rather than cubic. Over three seconds a cubic ease-in is dead for
    // the first half-second (36px of 2038) — the tap reads as a dropped input
    // — and then hurries the middle, which is exactly where the nigiri is
    // coming apart. Sine leaves immediately and holds a near-even pace.
    const ease = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2

    let raf = 0
    let started = 0
    const stop = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
      skipTweenRef.current = null
    }
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      window.scrollTo(0, from + distance * ease(t))
      if (t < 1) raf = requestAnimationFrame(step)
      else stop()
    }

    // Bound on the next frame, not now: activating the button with the
    // keyboard is still dispatching its own keydown, which would otherwise
    // cancel the tween the moment it starts.
    raf = requestAnimationFrame((now) => {
      started = now
      // Any real scroll input hands control straight back to the reader.
      window.addEventListener('wheel', stop, { passive: true })
      window.addEventListener('touchstart', stop, { passive: true })
      window.addEventListener('keydown', stop)
      step(now)
    })
    skipTweenRef.current = stop
  }

  return (
    // Full-bleed: -mx-5 cancels the padding on <main>, -mt-1 its top padding,
    // so the hero runs edge to edge and fills the screen under the header.
    // The margins live on this wrapper rather than on the stage itself —
    // ScrollTrigger copies a pinned element's margins onto its pin-spacer, and
    // negative ones would then be applied twice and drag the hero off-screen.
    <div ref={wrapperRef} className="-mx-5 -mt-1">
      <div
        ref={stageRef}
        // Height must stay in step with HEADER above.
        className="relative isolate h-[calc(100svh-72px)] overflow-hidden bg-[#e9ebec]"
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

        {/* Keeps the title readable over the lighter part of the backdrop. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/75 to-transparent" />

        <div className="relative flex h-full flex-col p-5">
          <p className="section-title">{eyebrow}</p>
          <HeroTitle
            title={title}
            destination={destination}
            className="mt-1 drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]"
          />
          {meta && <p className="mt-1.5 text-sm font-medium text-muted">{meta}</p>}
        </div>

        {/* Sits under the nigiri: tap it to be taken past the sequence, or
            keep scrolling by hand. Fades out over the first 10% of the
            sequence, the same way the old scroll hint did.
            bottom-28 clears the fixed bottom nav (69px, Layout.tsx) with air
            to spare — the old hint could sit behind the tab bar because it
            ignored pointer events; something tappable cannot. */}
        <div
          className={`absolute inset-x-0 bottom-28 flex justify-center transition-opacity duration-500 ${
            cueVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <button
            type="button"
            onClick={skipToContent}
            tabIndex={cueVisible ? undefined : -1}
            aria-hidden={cueVisible ? undefined : true}
            // The padding is what keeps the tap target at 44px while the mark
            // itself stays small.
            className="flex flex-col items-center gap-2.5 px-6 py-2 transition-opacity active:opacity-60"
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink/65">
              Get started
            </span>
            {/* A segment falling down a rule: the quietest way to say
                "downwards" without an arrow. The rule fades out at the bottom
                so it dissolves into the artwork instead of stopping dead. */}
            <span
              aria-hidden
              className="relative h-9 w-px overflow-hidden rounded-full bg-gradient-to-b from-ink/20 to-ink/5"
            >
              <span className="absolute inset-x-0 h-3 rounded-full bg-ink/55 motion-safe:animate-trace" />
            </span>
          </button>
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
