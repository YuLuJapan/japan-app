// Which escape hatch the homepage hero offers out of its scroll-linked sushi
// sequence. Three variants are live at once so they can be compared on a real
// phone; `?hero=fold` (or `stories`, or `skip`) switches and is remembered, so
// the link only has to be opened once per device.
//
// This is scaffolding for picking a winner — once one is chosen, delete the
// other two branches in SushiSequence and this file with them.
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

export type HeroMode = 'skip' | 'fold' | 'stories'

export const HERO_MODES: HeroMode[] = ['skip', 'fold', 'stories']

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
