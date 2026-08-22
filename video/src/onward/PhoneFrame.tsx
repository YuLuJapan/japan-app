// A phone screen, whole, with a real screenshot scrolling inside it.
//
// The captures are 1170×2532 — two and a half times taller than a 1080 square
// frame. An entire handset scaled to fit would put the app's body text at
// about five pixels in a feed, which is no use to anyone; bleeding the handset
// off the bottom keeps it legible but reads as a broken crop rather than a
// choice. So the device is a *window*: a complete, self-contained screen with
// bezel on all four sides, and `focus` decides which part of the tall
// screenshot sits in it.
import { AbsoluteFill, CanvasImage, Easing, interpolate, staticFile } from 'remotion'
import { COLORS } from './theme'

const SHOT_W = 1170
const SHOT_H = 2532

/** The visible screen, inside the bezel. */
export const SCREEN_W = 640
export const SCREEN_H = 680
const BEZEL = 11
export const DEVICE_TOP = 300

/** How far the screenshot can travel before its bottom edge shows. */
const SCALE = SCREEN_W / SHOT_W
const FULL_H = SHOT_H * SCALE
const MAX_TRAVEL = FULL_H - SCREEN_H

/** A slow drift over the shot's life, so it reads as scrolling, not as a still. */
const DRIFT = 58

export const PhoneFrame: React.FC<{
  screen: string
  /** 0 = the top of the screenshot in view, 1 = the bottom. */
  focus: number
  /** Frames since this screen appeared, for the entrance. */
  localFrame: number
}> = ({ screen, focus, localFrame }) => {
  const start = -MAX_TRAVEL * Math.max(0, Math.min(1, focus))
  // Clamped so the drift can never expose the end of the screenshot.
  const end = Math.max(-MAX_TRAVEL, start - DRIFT)

  return (
    <AbsoluteFill name="Phone" style={{ alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: DEVICE_TOP,
          width: SCREEN_W + BEZEL * 2,
          height: SCREEN_H + BEZEL * 2,
          borderRadius: 52,
          background: '#141312',
          boxShadow: '0 46px 90px -34px rgba(22,26,34,0.5)',
          padding: BEZEL,
          opacity: interpolate(localFrame, [0, 14], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(localFrame, [0, 24], ['0px 38px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(localFrame, [0, 24], [0.965, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: 'perceptual-scale',
          }),
        }}
      >
        <div
          style={{
            width: SCREEN_W,
            height: SCREEN_H,
            borderRadius: 41,
            overflow: 'hidden',
            background: COLORS.canvas,
            position: 'relative',
          }}
        >
          <CanvasImage
            src={staticFile(`screens/${screen}.png`)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: SCREEN_W,
              height: FULL_H,
              translate: interpolate(
                localFrame,
                [0, 150],
                [`0px ${start}px`, `0px ${end}px`],
                {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                  easing: Easing.bezier(0.33, 0, 0.67, 1),
                }
              ),
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  )
}
