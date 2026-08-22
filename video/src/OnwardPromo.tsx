// The Onward product video: 1080² for LinkedIn and Facebook feeds.
//
// Every screen in it is the real app, captured from the production build by
// video/scripts/capture.mjs — not a mockup. Re-run the capture and the video
// updates itself, which is the whole reason for doing it that way.
//
// The caption band at the top carries the same words as the voiceover
// (src/onward/script.ts), so the video works with the sound off — which is how
// most of a feed is watched.
import { Audio } from '@remotion/media'
import {
  AbsoluteFill,
  Easing,
  Interactive,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion'
import { PhoneFrame } from './onward/PhoneFrame'
import { DURATION, SCRIPT, lineEnd, lineStart } from './onward/script'
import { BODY, DISPLAY } from './onward/fonts'
import { COLORS, FPS } from './onward/theme'

/** The ring from the app's own mark. */
const RingMark: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.29,
      background: COLORS.brand,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        width: size * 0.34,
        height: size * 0.34,
        borderRadius: '50%',
        border: `${Math.round(size * 0.075)}px solid ${COLORS.canvas}`,
      }}
    />
  </div>
)

/** One line of the script, in the band above the phone. */
const Caption: React.FC<{ text: string; length: number }> = ({ text, length }) => {
  const frame = useCurrentFrame()
  return (
    <Interactive.Div
      name="Caption"
      style={{
        position: 'absolute',
        top: 58,
        left: 78,
        right: 78,
        fontFamily: DISPLAY,
        fontSize: 48,
        fontWeight: 700,
        lineHeight: 1.16,
        letterSpacing: '-0.02em',
        color: COLORS.ink,
        textAlign: 'center',
        opacity: interpolate(frame, [0, 9, length - 8, length], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(frame, [0, 16], ['0px 22px', '0px 0px'], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {text}
    </Interactive.Div>
  )
}

/** A small label pinned beside the phone, naming the thing on screen. */
const Pin: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  return (
    <Interactive.Div
      name="Pin"
      style={{
        position: 'absolute',
        top: 176,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: BODY,
        fontSize: 23,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: COLORS.brand,
        opacity: interpolate(frame, [10, 26], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {text}
    </Interactive.Div>
  )
}

/** The opening and closing cards: type only, no phone. */
const TypeCard: React.FC<{ text: string; length: number; closing?: boolean }> = ({
  text,
  length,
  closing,
}) => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill
      name={closing ? 'Closing' : 'Opening'}
      style={{ alignItems: 'center', justifyContent: 'center', padding: 110 }}
    >
      {closing && (
        <div
          style={{
            marginBottom: 44,
            scale: interpolate(frame, [0, 26], [0.82, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: 'perceptual-scale',
            }),
          }}
        >
          <RingMark size={128} />
        </div>
      )}
      <Interactive.Div
        name="Headline"
        style={{
          fontFamily: DISPLAY,
          fontSize: closing ? 76 : 68,
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: '-0.025em',
          color: COLORS.ink,
          textAlign: 'center',
          opacity: interpolate(frame, [0, 12, length - 10, length], [0, 1, 1, closing ? 1 : 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0, 20], ['0px 26px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {text}
      </Interactive.Div>
      {closing && (
        <Interactive.Div
          name="Url"
          style={{
            marginTop: 46,
            fontFamily: BODY,
            fontSize: 34,
            fontWeight: 600,
            color: COLORS.muted,
            opacity: interpolate(frame, [22, 40], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          onward.app
        </Interactive.Div>
      )}
    </AbsoluteFill>
  )
}

export const OnwardPromo: React.FC<{ voiceover: boolean }> = ({ voiceover }) => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill name="Onward" style={{ backgroundColor: COLORS.canvas }}>
      {/* A warm wash that drifts across the whole film, so a canvas-coloured
          background never reads as an empty white square in a feed. */}
      <AbsoluteFill
        name="Wash"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, ${COLORS.sun}22 0%, transparent 62%)`,
          translate: interpolate(frame, [0, DURATION], ['0px -40px', '0px 40px'], {
            easing: Easing.linear,
          }),
        }}
      />

      {SCRIPT.map((line, i) => {
        const from = lineStart(i)
        const length = lineEnd(i) - from
        const closing = i === SCRIPT.length - 1
        return (
          <Sequence key={line.text} from={from} durationInFrames={length} layout="none">
            {line.screen ? (
              <>
                <Caption text={line.text} length={length} />
                {line.pin ? <Pin text={line.pin} /> : null}
                <PhoneWithLocalFrame screen={line.screen} />
              </>
            ) : (
              <TypeCard text={line.text} length={length} closing={closing} />
            )}
          </Sequence>
        )
      })}

      {/* The read. Rendered without it until the file exists, so the whole
          video is previewable before the voiceover is generated. */}
      {voiceover ? <Audio src={staticFile('voiceover.mp3')} /> : null}
    </AbsoluteFill>
  )
}

/** Splits `useCurrentFrame` out so PhoneFrame stays a pure presentational component. */
const PhoneWithLocalFrame: React.FC<{ screen: string }> = ({ screen }) => {
  const localFrame = useCurrentFrame()
  return <PhoneFrame screen={screen} localFrame={localFrame} />
}

export { FPS }
