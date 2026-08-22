// A phone with a real screenshot in it.
//
// The captures are 1170×2532 — far taller than a square frame — so the frame
// bleeds off the bottom and `focus` picks which part of the screen sits in
// view. Showing a whole phone shrunk to fit would make the UI unreadable,
// which defeats the point of capturing the real thing.
import { AbsoluteFill, CanvasImage, Easing, interpolate, staticFile } from 'remotion'
import { COLORS } from './theme'

const SHOT_W = 1170
const SHOT_H = 2532

export const PHONE_W = 646
export const PHONE_TOP = 372

export const PhoneFrame: React.FC<{
  screen: string
  /** 0 = top of the screenshot in view, 1 = bottom. */
  focus: number
  /** Frames since this screen appeared, for the entrance. */
  localFrame: number
}> = ({ screen, focus, localFrame }) => {
  const scale = PHONE_W / SHOT_W
  const screenH = SHOT_H * scale
  // How far the screenshot slides up inside the frame to show `focus`.
  const visibleH = 1080 - PHONE_TOP + 120
  const offset = -(screenH - visibleH) * Math.max(0, Math.min(1, focus))

  return (
    <AbsoluteFill name="Phone" style={{ alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: PHONE_TOP,
          width: PHONE_W + 26,
          height: screenH + 26,
          borderRadius: 76,
          background: '#101010',
          boxShadow: '0 40px 90px -30px rgba(22,26,34,0.45)',
          padding: 13,
          overflow: 'hidden',
          opacity: interpolate(localFrame, [0, 14], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(localFrame, [0, 22], ['0px 46px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            width: PHONE_W,
            height: screenH,
            borderRadius: 64,
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
              width: PHONE_W,
              height: screenH,
              // A slow drift up over the shot's life: the screen reads as
              // something being scrolled rather than a still someone pasted.
              translate: interpolate(localFrame, [0, 140], [`0px ${offset}px`, `0px ${offset - 54}px`], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.33, 0, 0.67, 1),
              }),
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  )
}
