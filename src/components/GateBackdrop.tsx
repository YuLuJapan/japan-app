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
// Everything here is decoration, so every way it can fail is a no-op:
// autoplay refused (a phone on Low Power Mode), a codec the browser won't
// take, no connection at all — the poster frame stays up and the screen is
// unchanged apart from being still. `prefers-reduced-motion` gets that poster
// deliberately rather than incidentally: full-bleed motion under a sign-in
// form is exactly what the setting is asking us not to do, and it also saves
// ~1.7 MB on a metered connection.
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

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Autoplay is a request, not a command — Safari refuses it outside a gesture
 * whenever Low Power Mode is on, and returns a rejected promise (older engines
 * return nothing at all). Either way there is nothing to do about it but leave
 * the poster up, so the rejection is swallowed rather than reported.
 */
function play(video: HTMLVideoElement | null) {
  if (!video) return
  try {
    const started = video.play() as Promise<void> | undefined
    if (started && typeof started.catch === 'function') started.catch(() => {})
  } catch {
    // ignore — the poster frame is the fallback
  }
}

export function GateBackdrop({ clips = GATE_CLIPS }: { clips?: string[] }) {
  // Read once, at mount: the answer decides whether there is any video at all,
  // and a screen that swapped a still for a moving background mid-sign-in
  // would be a worse answer to the setting than either state on its own.
  const [still, setStill] = useState(prefersReducedMotion)
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
    if (playing) {
      playing.currentTime = 0
      play(playing)
    }
    // The clip leaving the screen keeps playing under the crossfade and is
    // only stopped once it is invisible; pausing it on the frame the swap
    // starts is a visible freeze at the top of the dissolve.
    const timer = window.setTimeout(() => {
      if (!idle) return
      idle.pause()
      idle.currentTime = 0
    }, CROSSFADE_MS)
    return () => window.clearTimeout(timer)
  }, [cursor, still])

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
          }}
          src={sources[slot]}
          poster={GATE_POSTER}
          // Muted and inline are what make autoplay legal at all on iOS; the
          // clips carry no audio track in the first place.
          muted
          playsInline
          autoPlay={slot === 0}
          preload={slot === active || armed ? 'auto' : 'none'}
          // `loop` is deliberately off — ending is the signal to hand over.
          onCanPlay={() => setArmed(true)}
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
