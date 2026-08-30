// The sign-in screen's video backdrop. What is asserted here is the handover
// — which clip is on screen, and which one is loaded behind it — because that
// is the part with state in it. Playback itself is jsdom's no-op (see
// tests/setup.ts): there is no decoder to assert against, and the two things
// that can actually go wrong (a clip that never loads, a reader who has asked
// for less motion) both end on the same still frame.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { GATE_POSTER, GateBackdrop } from '../components/GateBackdrop'

const CLIPS = ['/gate/clip-1.mp4', '/gate/clip-2.mp4']

function videos(container: HTMLElement) {
  return Array.from(container.querySelectorAll('video'))
}

/** The one the reader can see: opacity is what the crossfade animates. */
function visible(container: HTMLElement) {
  return videos(container).find((v) => v.style.opacity === '1')
}

afterEach(() => vi.restoreAllMocks())

describe('GateBackdrop', () => {
  it('plays the clips one after another, looping back to the first', () => {
    const { container } = render(<GateBackdrop clips={CLIPS} />)

    expect(visible(container)).toHaveAttribute('src', CLIPS[0])
    // The second clip is mounted from the start rather than swapped in on the
    // handover — that is the whole point of the second element.
    expect(videos(container).map((v) => v.getAttribute('src'))).toEqual(CLIPS)

    fireEvent.ended(visible(container)!)
    expect(visible(container)).toHaveAttribute('src', CLIPS[1])

    fireEvent.ended(visible(container)!)
    expect(visible(container)).toHaveAttribute('src', CLIPS[0])
  })

  it('holds the next clip back until the one on screen can play', () => {
    const { container } = render(<GateBackdrop clips={CLIPS} />)
    const [first, second] = videos(container)

    expect(second).toHaveAttribute('preload', 'none')

    fireEvent.canPlay(first)
    expect(second).toHaveAttribute('preload', 'auto')
  })

  it('falls back to the still once every clip has failed to load', () => {
    const { container } = render(<GateBackdrop clips={CLIPS} />)

    fireEvent.error(videos(container)[0])
    expect(videos(container)).toHaveLength(2)

    fireEvent.error(visible(container)!)
    expect(videos(container)).toHaveLength(0)
    expect(container.querySelector('img')).toHaveAttribute('src', GATE_POSTER)
  })

  it('shows one still frame and loads no video at all for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { container } = render(<GateBackdrop clips={CLIPS} />)

    expect(videos(container)).toHaveLength(0)
    expect(container.querySelector('img')).toHaveAttribute('src', GATE_POSTER)
  })
})
