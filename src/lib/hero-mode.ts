// Which escape hatch the homepage hero offers out of its scroll-linked sushi
// sequence. Every variant is live at once so they can be compared on a real
// phone; `?hero=express` (or any other name below) switches and is remembered,
// so the link only has to be opened once per device.
//
//   skip    — a coral pill that glides the window down over ~1.2s
//   express — the same pill, 600ms, leaves fast and settles soft
//   watch   — plays the sequence in place first, then drops to the content
//   glass   — a frosted chip with a nudging chevron; skip's motion
//   hairline — the same motion behind almost nothing: a letterspaced label
//             over a rule with a segment tracing down it
//   bar     — a full-width CTA above the tab bar that doubles as a progress
//             meter for a hand scroll
//   fold    — the hero shrinks in place instead of travelling
//   stories — segmented bar, tap the hero's halves to step chapters
//
// This is scaffolding for picking a winner — once one is chosen, delete the
// other two branches in SushiSequence and this file with them.
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

export type HeroMode =
  'skip' | 'express' | 'watch' | 'glass' | 'hairline' | 'bar' | 'fold' | 'stories'

export const HERO_MODES: HeroMode[] = [
  'skip',
  'express',
  'watch',
  'glass',
  'hairline',
  'bar',
  'fold',
  'stories',
]

const KEY = 'hero_mode'

const isMode = (value: string | null): value is HeroMode =>
  !!value && (HERO_MODES as string[]).includes(value)

export function readHeroMode(search = ''): HeroMode {
  const asked = new URLSearchParams(search).get('hero')
  if (isMode(asked)) {
    // Remember it, so browsing away from the query string keeps the variant.
    try {
      localStorage.setItem(KEY, asked)
    } catch {
      /* private mode: the query string still works for this page view */
    }
    return asked
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (isMode(saved)) return saved
  } catch {
    /* fall through to the default */
  }
  return 'skip'
}

export function useHeroMode(): HeroMode {
  const { search } = useLocation()
  return useMemo(() => readHeroMode(search), [search])
}
