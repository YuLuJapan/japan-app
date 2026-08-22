import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SushiSequence } from '../components/SushiSequence'

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
