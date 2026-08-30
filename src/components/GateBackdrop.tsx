// The sign-in screen's background: short travel clips, played one after
// another and looping back to the first.
//
// Two <video> elements, not one. A single element re-pointed at the next file
// on `ended` goes blank while it fetches and decodes — a black flash right in
// the middle of the first thing anyone sees of the app. Here one slot plays
// while the other already holds the next clip (loaded, paused at zero), and
// the handover is an opacity crossfade between them: by the time a clip ends,
// its successor has been buffering for most of the ten seconds it was on
// screen. `cursor` counts clips played, so the slot is `cursor % 2` and the
// idle slot is always the one loading `cursor + 1` — with two clips that
// alternates, and with three or more it still only ever holds two files.
//
// Everything here is decoration, so every way it can fail is a no-op: a codec
// the browser won't take, no connection at all — the poster frame stays up and
// the screen is unchanged apart from being still.
//
// Autoplay itself is fought for rather than hoped for, because a still gate is
// the whole point of this screen missing. Three things are what make it start
// without a tap: the clips are silent and carry `muted` as an *attribute*
// (see the ref below — React alone sets only the property, and iOS reads the
// attribute), `playsInline` keeps iOS from taking the video fullscreen, and a
// refusal is retried on the reader's first touch anywhere on the screen, which
// is a gesture and therefore always permitted.
//
// `prefers-reduced-motion` is deliberately *not* consulted. It normally would
// be — full-bleed motion under a sign-in form is what the setting is asking us
// not to do — but the video is this screen, and it was asked for on devices
// that have Reduce Motion switched on. The clips are silent, slow and behind a
// scrim, which is the gentlest version of a decision that is still a
// trade-off: someone with the setting on gets moving footage anyway.
//
// The files are in `public/gate/` — 720×1280, silent, H.264, ~800 KB each.
// They are not precached (Workbox's glob is js/css/html/png, not mp4): the
// gate is one screen, and putting two megabytes of video into the install
// would charge every phone for it whether or not it ever signs in again. The
// runtime CacheFirst rule in `vite.config.ts` keeps them after the first
// visit, which is the visit that matters.
import { useEffect, useRef, useState } from 'react'

/** Played in this order, then back to the first. */
export const GATE_CLIPS = ['/gate/clip-1.mp4', '/gate/clip-2.mp4']
export const GATE_POSTER = '/gate/poster.jpg'

// `z-0`, never `-z-10`: the gate paints its own dark background, and a
// negative z-index child does not create a stacking context of its own — it is
// painted behind the nearest ancestor that does, which put the whole backdrop
// under that background and showed a black screen. The content above it is
// `relative z-10` for the same reason.

/** Long enough to read as a dissolve, short enough not to mute both clips. */
const CROSSFADE_MS = 900

// How hard a refusal is chased before the screen settles for waiting on a
// touch. iOS turns autoplay down for reasons that pass — a PWA still behind
// its launch splash, a tab that is not front-most yet, a media engine with
// nothing buffered — so the ask is repeated for a few seconds rather than
// abandoned on the first no. Roughly six seconds at 400ms.
const RETRY_MS = 400
const RETRY_LIMIT = 15

/**
 * Autoplay is a request, not a command: Safari refuses it outside a gesture
 * whenever Low Power Mode is on, and answers with a rejected promise (older
 * engines throw, or return nothing at all). A refusal is reported rather than
 * swallowed, because there *is* something to do about it — wait for a touch
 * and ask again.
 *
 * `muted` is re-asserted on every attempt. It is the condition the permission
 * hangs on, and it costs nothing to be sure of it.
 */
function play(video: HTMLVideoElement | null, onRefused: () => void) {
  if (!video) return
  video.muted = true
  try {
    const started = video.play() as Promise<void> | undefined
    if (started && typeof started.catch === 'function') started.catch(onRefused)
  } catch {
    onRefused()
  }
}

export function GateBackdrop({ clips = GATE_CLIPS }: { clips?: string[] }) {
  // The one state that gives up on video entirely: every clip failed to load.
  const [still, setStill] = useState(false)
  const [cursor, setCursor] = useState(0)
  const slots = useRef<(HTMLVideoElement | null)[]>([null, null])
  // Stepping past a clip that will not load is only a recovery while there is
  // something left to step to. Once every clip has failed — an offline first
  // visit, a browser without H.264 — advancing again would just fail again on
  // the next frame, so the sequence stops and the poster is the screen.
  const failed = useRef(0)
  // The second clip is not needed for ten seconds, and fetching it against the
  // first one is how the *first* one stalls on a hotel wifi. It is left at
  // `preload="none"` until the clip on screen can actually play, and only then
  // given the rest of that ten seconds to arrive.
  const [armed, setArmed] = useState(false)
  // Autoplay was refused and we are waiting for a gesture to ask again.
  const [refused, setRefused] = useState(false)

  const active = cursor % 2
  const current = cursor % clips.length
  const next = (cursor + 1) % clips.length
  // Slot 0 always holds the clip for an even cursor, slot 1 for an odd one, so
  // advancing the cursor promotes the slot that has already loaded.
  const sources = active === 0 ? [clips[current], clips[next]] : [clips[next], clips[current]]

  // Arming flips `preload` on the second element, which is a hint the browser
  // is free to have already acted on; `load()` is the nudge that makes it act
  // now. Arming happens on the first clip's `canplay`, before anything can
  // have ended, so the element to nudge is always slot 1.
  useEffect(() => {
    if (!armed || still) return
    slots.current[1]?.load()
  }, [armed, still])

  useEffect(() => {
    if (still) return
    const playing = slots.current[cursor % 2]
    const idle = slots.current[(cursor + 1) % 2]

    // Rewind only a clip that has actually advanced. A fresh element is at
    // zero already, and seeking one that has no data yet is not free on
    // WebKit: the seek puts the element to work and the autoplay it was about
    // to perform is dropped on the floor. That assignment was why the first
    // clip needed a tap on an iPhone.
    if (playing && playing.currentTime > 0) {
      try {
        playing.currentTime = 0
      } catch {
        // Not seekable yet — which means it is still at the beginning anyway.
      }
    }

    // Ask, then keep asking. Each `no` from iOS is usually about *now* rather
    // than about the page — the splash is still up, the tab is not front-most,
    // nothing is buffered — and the ask that follows a second later is taken.
    let attempts = 0
    const ask = () => {
      if (!playing || !playing.paused) return
      attempts += 1
      play(playing, () => {
        if (attempts >= RETRY_LIMIT) setRefused(true)
      })
    }
    ask()
    const poll = window.setInterval(() => {
      if (!playing || !playing.paused || attempts >= RETRY_LIMIT) window.clearInterval(poll)
      else ask()
    }, RETRY_MS)

    // The strongest signal there is: the page just became the thing on screen.
    // A phone unlocking, an app switch back, and — the one that matters here —
    // a home-screen PWA finally showing the page it launched behind a splash.
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    window.addEventListener('focus', onVisible)

    // The clip leaving the screen keeps playing under the crossfade and is
    // only stopped once it is invisible; pausing it on the frame the swap
    // starts is a visible freeze at the top of the dissolve.
    const timer = window.setTimeout(() => {
      if (!idle) return
      idle.pause()
      idle.currentTime = 0
    }, CROSSFADE_MS)

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [cursor, still])

  // A refusal is not the end of it. Any touch, tap or key is a user gesture,
  // and a gesture is the one thing that unblocks playback — so the first one
  // anywhere on the page starts the video, whatever it was aimed at. The
  // listeners are `once` and only exist while a refusal is outstanding, so
  // nothing here is watching the reader for the rest of the session.
  useEffect(() => {
    if (!refused || still) return
    const retry = () => {
      setRefused(false)
      play(slots.current[cursor % 2], () => setRefused(true))
    }
    const events = ['pointerdown', 'touchstart', 'keydown'] as const
    events.forEach((event) => document.addEventListener(event, retry, { once: true }))
    return () => events.forEach((event) => document.removeEventListener(event, retry))
  }, [refused, still, cursor])

  if (still) {
    return (
      <div className="absolute inset-0 z-0 overflow-hidden bg-ink">
        <img src={GATE_POSTER} alt="" className="h-full w-full object-cover" />
        <Scrim />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-ink">
      {[0, 1].map((slot) => (
        <video
          key={slot}
          ref={(el) => {
            slots.current[slot] = el
            // React sets `muted` as a *property* only, and iOS decides whether
            // an autoplaying video needs a gesture by reading the attribute —
            // which React never writes. This is the one-line difference
            // between a gate that plays on an iPhone and one that shows a
            // still. (Same for `playsinline`, which React does write, but
            // asserting both here keeps them together.)
            if (el) {
              el.muted = true
              el.setAttribute('muted', '')
              el.setAttribute('playsinline', '')
              // Old WebKit spelling, still what some iOS versions look for.
              el.setAttribute('webkit-playsinline', '')
              // Nothing here is worth an AirPlay route, and being picked up as
              // one is another way playback ends up somewhere it cannot start.
              el.setAttribute('disableremoteplayback', '')
            }
          }}
          src={sources[slot]}
          poster={GATE_POSTER}
          // Muted and inline are what make autoplay legal at all on iOS; the
          // clips carry no audio track in the first place.
          muted
          playsInline
          autoPlay={slot === active}
          preload={slot === active || armed ? 'auto' : 'none'}
          // `loop` is deliberately off — ending is the signal to hand over.
          // `canplay` can arrive after the effect above has already tried and
          // been turned down for having nothing buffered yet; asking again the
          // moment there is something to play costs a no-op when it is already
          // running.
          onCanPlay={(e) => {
            setArmed(true)
            if (slot === active) play(e.currentTarget, () => setRefused(true))
          }}
          onEnded={() => setCursor((c) => c + 1)}
          // A file that will not load must not take the sequence down with it:
          // step past it, and fall back to the still once none is left.
          onError={() => {
            failed.current += 1
            if (failed.current >= clips.length) setStill(true)
            else setCursor((c) => c + 1)
          }}
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
          style={{ opacity: slot === active ? 1 : 0, transitionDuration: `${CROSSFADE_MS}ms` }}
        />
      ))}
      <Scrim />
    </div>
  )
}

/**
 * Two overlapping washes, because the clips are not one brightness: a bleached
 * Santorini rooftop and a night-lit Eiffel Tower pass under the same white
 * title. The gradient is weighted to the bottom fifth, where the buttons are —
 * a white pill on a white-walled village needs an edge to sit against — and
 * the flat layer over it is what keeps 44px extrabold legible when the frame
 * behind it is a noon sky. Written as one linear-gradient rather than
 * Tailwind's three-stop `bg-gradient-to-b`, which cannot place the stops.
 */
function Scrim() {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom,' +
            'rgba(0,0,0,0.55) 0%,rgba(0,0,0,0.24) 30%,rgba(0,0,0,0.34) 55%,' +
            'rgba(0,0,0,0.72) 80%,rgba(0,0,0,0.92) 100%)',
        }}
      />
      <div className="absolute inset-0 bg-black/15" />
    </>
  )
}
