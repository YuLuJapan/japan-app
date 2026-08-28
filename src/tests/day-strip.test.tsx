// Regression cover for the day picker's auto-scroll: it must scroll the strip in
// its own scroll coordinates, not in page coordinates (see DayStrip's comment).
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DayStrip } from '../components/DayStrip'

const days = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
  '2026-10-11',
]

const CHIP = 52
const GAP = 8
const PAD = 20
const VIEW = 300
// The app container is centred on a wide screen, so the strip starts well to the
// right of the page's left edge — the offset that used to leak into scrollLeft.
const PAGE_X = 485

function Harness() {
  const [selected, setSelected] = useState(days[0])
  return <DayStrip days={days} selected={selected} onSelect={setSelected} />
}

/** Lay the strip out as a real browser would, with `scrollLeft` shifting the chips. */
function layout() {
  const strip = screen.getByTestId('day-strip')
  const chips = screen.getAllByRole('button')
  let scrollLeft = 0
  const scrollTo = vi.fn((opts: { left: number }) => {
    scrollLeft = opts.left
  })
  const box = (left: number, width: number) => ({ left, width, right: left + width }) as DOMRect
  Object.defineProperties(strip, {
    clientWidth: { value: VIEW, configurable: true },
    scrollWidth: { value: PAD * 2 + days.length * CHIP + (days.length - 1) * GAP },
    scrollLeft: { get: () => scrollLeft, configurable: true },
    scrollTo: { value: scrollTo, configurable: true },
    getBoundingClientRect: { value: () => box(PAGE_X, VIEW), configurable: true },
  })
  chips.forEach((chip, i) => {
    const content = PAD + i * (CHIP + GAP)
    Object.defineProperties(chip, {
      offsetLeft: { value: PAGE_X + content, configurable: true },
      offsetWidth: { value: CHIP, configurable: true },
      getBoundingClientRect: {
        value: () => box(PAGE_X + content - scrollLeft, CHIP),
        configurable: true,
      },
    })
  })
  return { chips, scrollTo }
}

// The strip breaks out of the page padding (-mx-5) and puts it back (px-5) so
// the first chip lines up with the headings above it. Snapping undoes that
// unless scroll-padding says otherwise — the snapport is the scrollport, which
// ignores padding, so the browser scrolls the padding away and leaves chip one
// flush against the screen edge.
describe('the strip lines up with the rest of the page', () => {
  it('carries scroll padding to match its own padding', () => {
    render(<DayStrip days={days} selected={days[0]} onSelect={() => {}} />)
    const strip = screen.getByTestId('day-strip')
    expect(strip.className).toContain('px-5')
    expect(strip.className).toContain('scroll-px-5')
  })
})

describe('DayStrip auto-scroll', () => {
  it('leaves the strip put when the picked day is already in view', () => {
    render(<Harness />)
    const { chips, scrollTo } = layout()

    fireEvent.click(chips[1])

    expect(chips[1]).toHaveAttribute('aria-pressed', 'true')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls an off-screen day into the middle, in the strip‘s own coordinates', () => {
    render(<Harness />)
    const { chips, scrollTo } = layout()

    fireEvent.click(chips[8])

    // Chip 8 sits at 500px inside the strip's content; centring it in a 300px
    // viewport lands at 500 - 150 + 26. The page offset must not be part of it.
    expect(scrollTo).toHaveBeenCalledWith({ left: 376 })
  })

  it('never scrolls past the end of the strip', () => {
    render(<Harness />)
    const { chips, scrollTo } = layout()

    fireEvent.click(chips[days.length - 1])

    const max = PAD * 2 + days.length * CHIP + (days.length - 1) * GAP - VIEW
    expect(scrollTo).toHaveBeenCalledWith({ left: max })
  })
})
