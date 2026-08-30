// The sign-in screen's video backdrop. Two things are asserted: the handover —
// which clip is on screen, and which one is loaded behind it — and that the
// video is *asked* to play, including after a browser turns the first ask
// down. jsdom has no decoder (play/pause/load are stubbed in tests/setup.ts),
// so a spy on `play` is as close to "it is moving" as this level gets; the
// real sequence was driven in a browser.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
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

  it('plays without waiting to be asked, and keeps playing across the handover', () => {
    const played = vi.spyOn(HTMLMediaElement.prototype, 'play')
    const { container } = render(<GateBackdrop clips={CLIPS} />)

    expect(played).toHaveBeenCalled()

    played.mockClear()
    fireEvent.ended(visible(container)!)
    expect(played).toHaveBeenCalled()
  })

  it('carries muted as an attribute, which is what iOS reads before allowing autoplay', () => {
    const { container } = render(<GateBackdrop clips={CLIPS} />)

    for (const video of videos(container)) {
      expect(video.muted).toBe(true)
      expect(video).toHaveAttribute('muted')
      expect(video).toHaveAttribute('playsinline')
    }
  })

  // Low Power Mode refuses autoplay outright. A touch is a gesture and a
  // gesture is always allowed, so the next one anywhere on the page is what
  // starts the video — the reader taps nothing in particular and it plays.
  it('asks again on the first gesture when the browser refuses to autoplay', async () => {
    const played = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('NotAllowedError'))
    render(<GateBackdrop clips={CLIPS} />)

    await waitFor(() => expect(played).toHaveBeenCalled())
    played.mockClear().mockResolvedValue(undefined)

    fireEvent.pointerDown(document)
    expect(played).toHaveBeenCalled()
  })

  // Reduce Motion is on by default on a lot of phones, and this screen *is*
  // the video: honouring it here would show most people a still gate.
  it('plays even where the reader has asked for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { container } = render(<GateBackdrop clips={CLIPS} />)

    expect(videos(container)).toHaveLength(2)
    expect(visible(container)).toHaveAttribute('src', CLIPS[0])
  })
})
