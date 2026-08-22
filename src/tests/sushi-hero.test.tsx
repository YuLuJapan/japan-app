import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SushiSequence, pinLengthFor, skipLegs } from '../components/SushiSequence'

// jsdom has no 2D context, so the canvas half of the hero bails out early and
// what is left is exactly what these tests care about: the escape hatch out of
// the scroll-linked sequence.

const HEADER = 72

/** jsdom reports every rect as zero, so the hero has to be given a height. */
function stubGeometry({ heroBottom, pageHeight }: { heroBottom: number; pageHeight: number }) {
  const rect = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue({ bottom: heroBottom } as DOMRect)
  const height = vi
    .spyOn(document.documentElement, 'scrollHeight', 'get')
    .mockReturnValue(pageHeight)
  return () => {
    rect.mockRestore()
    height.mockRestore()
  }
}

// Returning null is what a canvas-less jsdom means anyway; stubbing it keeps
// the run free of its "not implemented" stack trace.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => vi.restoreAllMocks())

describe('SushiSequence hero', () => {
  it('offers a way past the sequence', () => {
    render(<SushiSequence title="Yuval & Luciana in Japan" />)
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument()
  })

  it('scrolls to the end of the hero so the content below lands under the header', async () => {
    // Reduced motion takes the un-animated branch: one jump, no tween.
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const restore = stubGeometry({ heroBottom: 2000, pageHeight: 4000 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    render(<SushiSequence title="Yuval & Luciana in Japan" />)
    await userEvent.click(screen.getByRole('button', { name: /get started/i }))

    expect(scrollTo).toHaveBeenCalledWith(0, 2000 - HEADER)
    restore()
  })

  it('never scrolls past the bottom of the page', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    // A hero taller than everything below it: the clamp is what keeps the
    // button from asking for a scroll position that does not exist.
    const restore = stubGeometry({ heroBottom: 5000, pageHeight: 1200 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    render(<SushiSequence title="Yuval & Luciana in Japan" />)
    await userEvent.click(screen.getByRole('button', { name: /get started/i }))

    expect(scrollTo).toHaveBeenCalledWith(0, 1200 - window.innerHeight)
    restore()
  })
})

describe('pinLengthFor', () => {
  it('releases the pin before the sequence ends, so the page moves while it plays', () => {
    // The whole point: a pin shorter than the scrub leaves a stretch of scroll
    // where the hero is sliding away and the last frames are still running.
    expect(pinLengthFor('+=150%')).toBe('+=125%')
  })

  it('never asks for a negative pin, however short the sequence', () => {
    expect(pinLengthFor('+=10%')).toBe('+=0%')
  })

  it('leaves an end it cannot do the arithmetic on alone', () => {
    expect(pinLengthFor('+=800px')).toBe('+=800px')
  })
})

describe('skipLegs', () => {
  // A 390×844 phone: a 772-tall stage over a 125% pin, so the hero's spacer
  // ends 1827px down and the pin lets go 772px before that.
  const phone = () => skipLegs(0, 1827, 772, 844)

  it('gives the page-and-sequence-together stretch a second of its own', () => {
    const [, drift] = phone()
    // 25% of the viewport, at a steady pace, starting the moment the pin lets
    // go: one second of the hero rising while the last frames land.
    expect(drift).toEqual({ to: 1055 + 211, ms: 1000, steady: true })
  })

  it('runs the pinned sequence first and the leftover hero last', () => {
    const [scrub, , exit] = phone()
    expect(scrub).toEqual({ to: 1055, ms: 1500 })
    expect(exit).toEqual({ to: 1827, ms: 600 })
  })

  it('just leaves when there is no pinned sequence to keep company', () => {
    // Nothing pinned (GSAP blocked, say): the hero is exactly its own height,
    // so there is no sequence still playing for the drift to sit alongside.
    expect(skipLegs(0, 772, 772, 844)).toEqual([{ to: 772, ms: 600 }])
    // Same from below the release point, where the sequence is already over.
    expect(skipLegs(1500, 1827, 772, 844)).toEqual([{ to: 1827, ms: 600 }])
    // And nothing at all to do when the hero is already behind us.
    expect(skipLegs(1827, 1827, 772, 844)).toEqual([])
  })
})
