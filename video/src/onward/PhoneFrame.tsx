// A whole iPhone, with a whole screen in it.
//
// Earlier cuts cropped: first the handset bled off the bottom, then it became
// a squat window that read as a tablet. Both traded the shape of the product
// for bigger UI. A phone app filmed in a frame that isn't phone-shaped stops
// looking like a phone app, so this keeps the real 1170×2532 ratio and shows
// the capture entire — status bar to bottom nav — and accepts that the body
// copy inside is small. The captions carry the words; the screen carries the
// shape.
import { AbsoluteFill, CanvasImage, Easing, interpolate, staticFile } from 'remotion'
import { COLORS } from './theme'

const SHOT_W = 1170
const SHOT_H = 2532

/** The visible screen. Exactly the capture's aspect, so nothing is cropped. */
export const SCREEN_W = 370
export const SCREEN_H = Math.round(SCREEN_W * (SHOT_H / SHOT_W))
const BEZEL = 10
export const DEVICE_TOP = 218

export const PhoneFrame: React.FC<{
  screen: string
  /** Frames since this screen appeared, for the entrance. */
  localFrame: number
}> = ({ screen, localFrame }) => {
  return (
    <AbsoluteFill name="Phone" style={{ alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: DEVICE_TOP,
          width: SCREEN_W + BEZEL * 2,
          height: SCREEN_H + BEZEL * 2,
          borderRadius: 50,
          background: '#141312',
          boxShadow: '0 44px 88px -34px rgba(22,26,34,0.46)',
          padding: BEZEL,
          opacity: interpolate(localFrame, [0, 14], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(localFrame, [0, 26], ['0px 34px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          // Nothing scrolls any more — the whole screen is already in view —
          // so the life in a shot is a slow push on the device itself.
          scale: interpolate(localFrame, [0, 150], [0.975, 1.015], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.22, 0.61, 0.36, 1),
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
            style={{ width: SCREEN_W, height: SCREEN_H }}
          />
          {/* The island. Small, but it is most of what says "iPhone". */}
          <div
            style={{
              position: 'absolute',
              top: 9,
              left: '50%',
              translate: '-50% 0',
              width: 86,
              height: 25,
              borderRadius: 13,
              background: '#141312',
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  )
}
