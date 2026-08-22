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
// Scrubbing 150% of a viewport by hand to reach the countdown is a chore on a
// phone, so the hero always offers a way out. Which way is the `mode` prop
// (src/lib/hero-mode.ts), three variants live at once so they can be compared
// on a real device:
//
//   skip    — a "Get started" pill that tweens the window down past the hero.
//             The sequence still plays; it just plays itself, on the way down.
//   express — the same pill and the same trip, in 600ms on an exponential
//             curve: away on the first frame, settling soft at the end.
//   watch   — two stages. The hero holds still while the sequence rips
//             through in place, so the nigiri is actually seen coming apart,
//             and only then does the page drop to the content.
//   glass   — skip's motion behind a quieter affordance: a frosted chip on a
//             hairline border, so the artwork stays the hero rather than
//             competing with a solid coral button.
//   hairline— quieter still: a letterspaced label over a rule with a segment
//             tracing down it. No container, no fill, no shadow.
//   bar     — a full-width CTA above the tab bar, with a hairline that fills
//             as you scroll by hand, so it doubles as a progress meter. It is
//             the one affordance that stays put for the whole sequence.
//   fold    — nothing scrolls: the hero shrinks in place to a slim banner
//             while the sushi fast-forwards inside it, and the content below
//             rises into the space it vacates. Tap the banner to unfold again.
//   stories — the sequence becomes something you drive: a segmented progress
//             bar, tap the right/left half of the hero to step a chapter
//             forward or back, and "Skip" leaves at any moment.
import { useEffect, useRef, useState } from 'react'
import { ASSET_VERSION, FRAME_COUNT, FRAME_HEIGHT, FRAME_WIDTH } from '../generated/sushi-frames'
import type { HeroMode } from '../lib/hero-mode'

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

// What the hero shrinks to in `fold` mode: tall enough to keep the nigiri
// recognisable as a strip behind the title, short enough that the countdown
// clears the fold on every phone.
const COLLAPSED_H = 168

// `stories` mode: whole nigiri → nori loosening → fully apart.
const CHAPTERS = 3

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

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// Covers ground on the very first frame and decelerates the rest of the way —
// what makes `express` read as instant despite still being a real trip.
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t))

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Hand control back to the reader the moment they scroll for themselves.
 * Returns the unbind. Callers bind on the next frame, not now: activating a
 * button with the keyboard is still dispatching its own keydown, which would
 * otherwise cancel the animation the moment it starts.
 */
function bindCancel(stop: () => void) {
  window.addEventListener('wheel', stop, { passive: true })
  window.addEventListener('touchstart', stop, { passive: true })
  window.addEventListener('keydown', stop)
  return () => {
    window.removeEventListener('wheel', stop)
    window.removeEventListener('touchstart', stop)
    window.removeEventListener('keydown', stop)
  }
}

// How far each variant's trip runs and on what curve. `watch` travels only
// after it has played, so its numbers live in its own handler.
const TRAVEL = {
  express: { duration: () => 600, ease: easeOutExpo },
  glide: {
    // Long enough that the nigiri visibly comes apart on the way down, short
    // enough that it never feels like a cutscene you have to sit through.
    duration: (distance: number) => Math.min(1600, Math.max(900, distance * 0.6)),
    ease: easeInOut,
  },
}

/**
 * The handle the buttons need on the sequence itself: the effect below owns
 * the canvas, the frames and the pin, and publishes this so the click handlers
 * can drive them without any of it leaking into render.
 */
type Control = {
  frameCount: () => number
  /** Paint one frame directly, ignoring wherever the scroll happens to be. */
  setFrame: (i: number) => void
  currentFrame: () => number
  /** Re-measure the canvas and repaint — the fold resizes the stage per frame. */
  relayout: () => void
  /** Scroll offsets the pin runs between, or null when nothing is pinned. */
  pinRange: () => { start: number; end: number } | null
  disablePin: () => void
  enablePin: () => void
}

function Chevron({
  className,
  size = 16,
  weight = 2.5,
  up = false,
}: {
  className?: string
  size?: number
  weight?: number
  up?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  )
}

export function SushiSequence({
  title,
  meta,
  eyebrow = 'Our trip',
  mode = 'skip',
  // How much scroll the sequence consumes once pinned. Shorten this to bring
  // the countdown up sooner; '+=0%' effectively disables the pin.
  scrollLength = '+=150%',
}: {
  title: string
  meta?: string
  eyebrow?: string
  mode?: HeroMode
  scrollLength?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Stops the running scroll tween mid-flight (and unbinds its listeners);
  // null whenever no tween is running.
  const scrollTweenRef = useRef<(() => void) | null>(null)
  // Same, for the fold's height animation and for `watch`'s in-place playback.
  const foldTweenRef = useRef<(() => void) | null>(null)
  const playTweenRef = useRef<(() => void) | null>(null)
  const controlRef = useRef<Control | null>(null)
  // `stories` steps between whole chapters, so it tracks the one it last
  // asked for rather than the frame the (lagging) scrub happens to be on.
  const chapterRef = useRef(0)
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([])
  // `bar`'s progress hairline, filled from the scrub like the segments are.
  const progressRef = useRef<HTMLDivElement>(null)

  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  // The hero fills the screen, so the countdown below it is out of sight until
  // the pin releases — the affordance says there's more down there.
  const [cueVisible, setCueVisible] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [folding, setFolding] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    // jsdom has no 2D context — the hero degrades to its title, which is what
    // the page tests assert on.
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let alive = true
    const reduced = prefersReducedMotion()

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

    // Fill `stories`' segments and `bar`'s hairline. This runs on every frame
    // change, so it writes to the DOM directly instead of re-rendering the
    // hero 160 times on the way down.
    const paintProgress = (ratio: number) => {
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${ratio})`
      for (let k = 0; k < CHAPTERS; k++) {
        const el = segmentRefs.current[k]
        if (!el) continue
        el.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio * CHAPTERS - k))})`
      }
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
    // Reassigned once GSAP is up; until then (and under reduced motion) the
    // hero simply has no pin to hand out.
    let createPin = () => {}
    let destroyPin = () => {}
    let pinRange: Control['pinRange'] = () => null

    const setFrame = (i: number) => {
      if (!images.length) return
      const next = Math.max(0, Math.min(images.length - 1, Math.round(i)))
      if (next === index && !dirty) return
      index = next
      paint()
      paintProgress(images.length > 1 ? index / (images.length - 1) : 0)
    }

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

      controlRef.current = {
        frameCount: () => images.length,
        setFrame,
        currentFrame: () => index,
        relayout: () => {
          layout()
          paint()
        },
        pinRange: () => pinRange(),
        disablePin: () => destroyPin(),
        enablePin: () => createPin(),
      }

      if (reduced) {
        // No pin, no scrub — one cut from the first frame to the last.
        const io = new IntersectionObserver(
          ([entry]) => {
            setFrame(entry.isIntersecting ? images.length - 1 : 0)
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

          let tween: gsap.core.Tween | null = null

          const makePin = () => {
            const state = { frame: index }
            return gsap.to(state, {
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
                  const ratio = i / (images.length - 1)
                  paintProgress(ratio)
                  // Follow a hand scroll, but never while a chapter tween is
                  // flying: the scrub trails it by 0.6s, so mid-flight frames
                  // would keep resetting the chapter the reader just asked
                  // for. Rounding (not flooring) is what makes a landed
                  // chapter read as that chapter despite the lag.
                  if (!scrollTweenRef.current)
                    chapterRef.current = Math.min(CHAPTERS, Math.round(ratio * CHAPTERS))
                  // Hide the "there's more below" affordance once the sequence
                  // is moving. React bails out when the boolean is unchanged,
                  // so this is a no-op on all but the two frames where it flips.
                  setCueVisible(i < images.length * 0.1)
                }
              },
            })
          }

          createPin = () => {
            if (tween) return
            tween = makePin()
          }
          destroyPin = () => {
            // revert: true puts the pin-spacer away and hands the stage back
            // to normal flow, which is what lets the fold animate its height.
            tween?.scrollTrigger?.kill(true)
            tween?.kill()
            tween = null
          }
          pinRange = () => {
            const st = tween?.scrollTrigger
            return st ? { start: st.start, end: st.end } : null
          }
          createPin()

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
            destroyPin()
          }
        })
        .catch(() => {
          /* offline or chunk blocked: the still frame above is enough */
        })
    })

    return () => {
      alive = false
      controlRef.current = null
      cleanupAnimation?.()
    }
  }, [scrollLength])

  useEffect(
    () => () => {
      scrollTweenRef.current?.()
      foldTweenRef.current?.()
      playTweenRef.current?.()
    },
    []
  )

  /**
   * Animate the window's scroll position. The sequence is scroll-linked, so
   * moving that position is what plays it — a jump would cut past it. Any real
   * scroll input hands control straight back to the reader.
   */
  const tweenScrollTo = (to: number, duration: number, ease = easeInOut) => {
    scrollTweenRef.current?.()
    const from = window.scrollY
    const distance = to - from
    if (Math.abs(distance) < 1) return

    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      window.scrollTo(0, to)
      return
    }

    let raf = 0
    let started = 0
    let unbind = () => {}
    const stop = () => {
      cancelAnimationFrame(raf)
      unbind()
      scrollTweenRef.current = null
    }
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      window.scrollTo(0, from + distance * ease(t))
      if (t < 1) raf = requestAnimationFrame(step)
      else stop()
    }

    raf = requestAnimationFrame((now) => {
      started = now
      unbind = bindCancel(stop)
      step(now)
    })
    scrollTweenRef.current = stop
  }

  /**
   * Scroll to just past the hero, so the content below lands under the sticky
   * header.
   */
  const skipToContent = () => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    // Once ScrollTrigger pins the stage it wraps it in a pin-spacer, which
    // this wrapper still contains — so its bottom is the end of the hero
    // whether the sequence is pinned, reduced-motion, or never loaded at all.
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const to = Math.min(wrapper.getBoundingClientRect().bottom + window.scrollY - HEADER, max)
    const distance = to - window.scrollY
    if (distance <= 0) return

    const travel = mode === 'express' ? TRAVEL.express : TRAVEL.glide
    tweenScrollTo(to, travel.duration(distance), travel.ease)
  }

  /**
   * `watch`: play the sequence where it stands, then travel. Nothing scrolls
   * during the playback, so the scrub never fires and the frames can be driven
   * straight; the pin is handed back before the drop, because a scrub still
   * parked at the top of its range would otherwise rewind everything that was
   * just played the instant the page moves.
   */
  const watchThenLeave = () => {
    const control = controlRef.current
    if (!control || playing) {
      skipToContent()
      return
    }
    playTweenRef.current?.()

    const last = control.frameCount() - 1
    const from = control.currentFrame()
    const leave = () => {
      control.disablePin()
      const wrapper = wrapperRef.current
      if (!wrapper) return
      // Measured after the pin lets go: without its spacer the hero is one
      // screen tall again, so this is a short drop rather than the full scrub,
      // and 400ms is plenty to cross it.
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      tweenScrollTo(
        Math.min(wrapper.getBoundingClientRect().bottom + window.scrollY - HEADER, max),
        400
      )
    }

    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      control.setFrame(last)
      leave()
      return
    }

    setPlaying(true)
    let raf = 0
    let started = 0
    let unbind = () => {}
    const stop = () => {
      cancelAnimationFrame(raf)
      unbind()
      setPlaying(false)
      playTweenRef.current = null
    }
    const step = (now: number) => {
      if (!started) started = now
      const t = Math.min(1, (now - started) / 700)
      control.setFrame(from + (last - from) * easeInOut(t))
      if (t < 1) {
        raf = requestAnimationFrame(step)
        return
      }
      stop()
      leave()
    }

    raf = requestAnimationFrame((now) => {
      started = now
      // A swipe mid-playback means the reader would rather do it themselves.
      unbind = bindCancel(stop)
      step(now)
    })
    playTweenRef.current = stop
  }

  /**
   * `fold`: shrink the hero in place instead of travelling anywhere. The pin
   * is dropped first (a pinned element cannot change height under you), then
   * the stage's own height is animated while the sequence fast-forwards inside
   * the shrinking frame — so the content below rises into view without the
   * scroll position ever moving.
   */
  const foldHero = (collapse: boolean) => {
    const stage = stageRef.current
    if (!stage || folding) return
    foldTweenRef.current?.()
    scrollTweenRef.current?.()

    const control = controlRef.current
    // The fold reads as the hero shrinking, which only works from the top.
    const range = control?.pinRange()
    window.scrollTo(0, range ? range.start : 0)
    control?.disablePin()

    const from = stage.getBoundingClientRect().height
    const to = collapse ? COLLAPSED_H : window.innerHeight - HEADER
    const frames = control ? control.frameCount() - 1 : 0
    const frameFrom = control ? control.currentFrame() : 0
    const frameTo = collapse ? frames : 0

    const settle = () => {
      setFolding(false)
      setCollapsed(collapse)
      setCueVisible(!collapse)
      if (collapse) {
        stage.style.height = `${COLLAPSED_H}px`
      } else {
        // Back to the class-driven height, so it tracks the viewport again.
        stage.style.height = ''
        control?.relayout()
        control?.enablePin()
      }
      foldTweenRef.current = null
    }

    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      control?.setFrame(frameTo)
      settle()
      return
    }

    setFolding(true)
    let raf = 0
    let started = 0
    const step = (now: number) => {
      if (!started) started = now
      const t = Math.min(1, (now - started) / 900)
      const e = easeInOut(t)
      stage.style.height = `${Math.round(from + (to - from) * e)}px`
      control?.relayout()
      control?.setFrame(frameFrom + (frameTo - frameFrom) * e)
      if (t < 1) raf = requestAnimationFrame(step)
      else settle()
    }
    raf = requestAnimationFrame(step)
    foldTweenRef.current = () => {
      cancelAnimationFrame(raf)
      setFolding(false)
      foldTweenRef.current = null
    }
  }

  /**
   * `stories`: step the sequence a chapter at a time. Chapters are positions
   * in the pinned scroll range rather than raw frame numbers, so tapping and
   * scrolling stay the same gesture — one just moves in bigger steps.
   */
  const goToChapter = (chapter: number) => {
    const control = controlRef.current
    if (chapter > CHAPTERS) {
      skipToContent()
      return
    }
    const next = Math.max(0, chapter)
    chapterRef.current = next

    const range = control?.pinRange()
    if (!range) {
      // No pin (reduced motion, or GSAP never arrived): move the frames alone.
      control?.setFrame(((control.frameCount() - 1) * next) / CHAPTERS)
      return
    }
    tweenScrollTo(range.start + ((range.end - range.start) * next) / CHAPTERS, 380)
  }

  const onStageTap = (event: React.MouseEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect()
    const forward = event.clientX - left > width / 2
    setCueVisible(false)
    goToChapter(chapterRef.current + (forward ? 1 : -1))
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
        // Height must stay in step with HEADER above. The fold overrides it
        // with an inline height and hands it back on the way out.
        className="relative isolate h-[calc(100svh-72px)] overflow-hidden bg-[#e9ebec]"
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

        {/* Keeps the title readable over the lighter part of the backdrop. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/75 to-transparent" />

        {/* stories: tap the right half to step forward, the left half to go
            back. A transparent overlay, so swiping still scrolls normally —
            only a tap without movement counts. */}
        {mode === 'stories' && (
          <div aria-hidden onClick={onStageTap} className="absolute inset-0 z-10" />
        )}

        <div
          className={`pointer-events-none relative z-20 flex h-full flex-col ${
            collapsed ? 'justify-center px-5' : 'p-5'
          } ${mode === 'stories' ? 'pt-8' : ''}`}
        >
          {!collapsed && <p className="section-title text-brand">{eyebrow}</p>}
          <h1
            className={
              collapsed
                ? 'max-w-[70%] font-display text-lg font-extrabold leading-tight tracking-tight drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]'
                : 'mt-1 max-w-[9ch] font-display text-4xl font-extrabold leading-[1.03] tracking-tight drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]'
            }
          >
            {title}
          </h1>
          {meta && !collapsed && <p className="mt-1.5 text-sm font-medium text-muted">{meta}</p>}
        </div>

        {/* stories: one segment per chapter, filled by the scrub itself. */}
        {mode === 'stories' && (
          <div aria-hidden className="absolute inset-x-4 top-3 z-20 flex gap-1.5">
            {Array.from({ length: CHAPTERS }, (_, k) => (
              <div key={k} className="h-1 flex-1 overflow-hidden rounded-full bg-ink/15">
                <div
                  ref={(el) => (segmentRefs.current[k] = el)}
                  style={{ transform: 'scaleX(0)' }}
                  className="h-full origin-left rounded-full bg-ink/70"
                />
              </div>
            ))}
          </div>
        )}

        {mode === 'stories' && (
          <button
            type="button"
            onClick={skipToContent}
            className="absolute right-4 top-7 z-30 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-ink shadow-card backdrop-blur"
          >
            Skip
          </button>
        )}

        {/* Every variant but `fold` and `bar` hangs its affordance here.
            bottom-24 clears the fixed bottom nav (69px, Layout.tsx) — a hint
            could sit behind it because it ignored pointer events, a button
            cannot. */}
        {mode !== 'fold' && mode !== 'bar' && (
          <div
            className={`absolute inset-x-0 ${
              mode === 'glass' || mode === 'hairline' ? 'bottom-28' : 'bottom-24'
            } z-20 flex flex-col items-center gap-2 transition-opacity duration-500 ${
              cueVisible && !playing ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            {mode === 'stories' && (
              <p className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-muted backdrop-blur">
                Tap to advance
              </p>
            )}

            {mode === 'glass' && (
              <>
                {/* Thin, small and low-contrast on purpose: the cue should be
                    noticed, not read. */}
                <Chevron
                  className="text-ink/30 motion-safe:animate-nudge"
                  size={14}
                  weight={1.75}
                />
                <button
                  type="button"
                  onClick={skipToContent}
                  tabIndex={cueVisible ? undefined : -1}
                  aria-hidden={cueVisible ? undefined : true}
                  // A hairline and a whisper of a shadow instead of a border
                  // and a drop shadow — enough to lift the glass off the
                  // backdrop without drawing a box around it.
                  // The ::before is the tap target: the chip is 33px tall,
                  // which looks right and misses the 44px minimum, so the
                  // touchable box is grown around it rather than the chip.
                  className="relative rounded-full bg-white/55 px-5 py-2.5 text-[13px] font-semibold leading-none text-ink/85 shadow-[0_1px_1px_rgba(23,21,15,0.04),0_14px_30px_-22px_rgba(23,21,15,0.55)] ring-1 ring-inset ring-white/70 backdrop-blur-xl transition-transform before:absolute before:-inset-2 before:content-[''] active:scale-[0.98]"
                >
                  Get started
                </button>
              </>
            )}

            {mode === 'hairline' && (
              <button
                type="button"
                onClick={skipToContent}
                tabIndex={cueVisible ? undefined : -1}
                aria-hidden={cueVisible ? undefined : true}
                // Nothing but type and a rule. The padding is what keeps the
                // tap target honest at 44px while the mark itself stays small.
                className="flex flex-col items-center gap-2.5 px-6 py-2 transition-opacity active:opacity-60"
              >
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink/65">
                  Get started
                </span>
                <span
                  aria-hidden
                  className="relative h-9 w-px overflow-hidden rounded-full bg-ink/15"
                >
                  <span className="absolute inset-x-0 h-3 rounded-full bg-ink/55 motion-safe:animate-trace" />
                </span>
              </button>
            )}

            {(mode === 'skip' || mode === 'express' || mode === 'watch') && (
              <button
                type="button"
                onClick={mode === 'watch' ? watchThenLeave : skipToContent}
                tabIndex={cueVisible ? undefined : -1}
                aria-hidden={cueVisible ? undefined : true}
                className="btn-primary"
              >
                Get started
                <Chevron />
              </button>
            )}
          </div>
        )}

        {/* `bar`: a full-width CTA where a native app would put one, over a
            hairline that fills with the sequence. That meter is the reason
            this one does not fade out with the rest — it is worth watching
            for the whole scroll, not just the first tenth of it. */}
        {mode === 'bar' && (
          <div className="absolute inset-x-0 bottom-[69px] z-20 px-4 pb-4">
            <div aria-hidden className="mx-1 mb-2.5 h-0.5 overflow-hidden rounded-full bg-ink/10">
              <div
                ref={progressRef}
                style={{ transform: 'scaleX(0)' }}
                className="h-full origin-left rounded-full bg-ink/35"
              />
            </div>
            <button
              type="button"
              onClick={skipToContent}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-sm font-semibold text-white shadow-card transition-all active:scale-[0.99]"
            >
              Get started
              <Chevron />
            </button>
          </div>
        )}

        {mode === 'fold' && !collapsed && (
          <div
            className={`absolute inset-x-0 bottom-24 z-20 flex justify-center transition-opacity duration-300 ${
              folding ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
          >
            <button type="button" onClick={() => foldHero(true)} className="btn-primary">
              Get started
              <Chevron />
            </button>
          </div>
        )}

        {/* Folded away: the whole banner is the way back into the animation. */}
        {mode === 'fold' && collapsed && (
          <button
            type="button"
            onClick={() => foldHero(false)}
            aria-label="Show the trip hero again"
            className="absolute inset-0 z-10 flex items-center justify-end px-5 text-ink"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 shadow-card backdrop-blur">
              <Chevron size={18} up />
            </span>
          </button>
        )}

        {/* Quiet progress hairline while the frames arrive. */}
        {!ready && (
          <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-black/5">
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
