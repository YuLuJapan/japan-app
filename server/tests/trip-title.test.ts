// The title rules, as a table. Pure — no server, no store, no HTTP.
import { describe, expect, it } from 'vitest'
import { displayTitle, formatNames } from '../src/lib/trip-title.js'

const people = (...names: string[]) => names.map((name) => ({ name }))

describe('formatNames', () => {
  it.each([
    [[], ''],
    [['Alex'], 'Alex'],
    [['Alex', 'Sam'], 'Alex and Sam'],
    [['Alex', 'Sam', 'Jo'], 'Alex, Sam and Jo'],
    [['Alex', 'Sam', 'Jo', 'Kim'], 'Alex, Sam and 2 others'],
    [['Alex', 'Sam', 'Jo', 'Kim', 'Lee'], 'Alex, Sam and 3 others'],
  ])('%j → %j', (names, expected) => {
    expect(formatNames(names)).toBe(expected)
  })

  it('ignores blanks rather than counting them', () => {
    expect(formatNames(['Alex', '  ', 'Sam'])).toBe('Alex and Sam')
  })
})

describe('displayTitle', () => {
  it('uses the name when one was given — it is an override, not a suggestion', () => {
    expect(displayTitle({ name: 'Honeymoon', country: 'Japan', people: people('Alex') })).toBe(
      'Honeymoon'
    )
  })

  it('treats a whitespace-only name as no name', () => {
    expect(displayTitle({ name: '   ', country: 'Japan' })).toBe('Trip to Japan')
  })

  it.each([
    [{ people: people('Yuval', 'Luciana'), country: 'Japan' }, 'Yuval and Luciana in Japan'],
    [{ people: people('Yuval'), country: 'Japan' }, 'Yuval in Japan'],
    [{ country: 'Japan' }, 'Trip to Japan'],
    [{ people: people('Yuval', 'Luciana') }, 'Yuval and Luciana’s trip'],
    [{}, 'Untitled trip'],
  ])('%j → %j', (trip, expected) => {
    expect(displayTitle(trip)).toBe(expected)
  })

  it('falls back to member names only when nobody is listed on the trip', () => {
    // The roster answers "who is going"; membership answers "who can open the
    // app", and may include a friend the trip was shared with.
    expect(displayTitle({ country: 'Japan', memberNames: ['Yuval', 'Friend'] })).toBe(
      'Yuval and Friend in Japan'
    )
    expect(
      displayTitle({ country: 'Japan', people: people('Yuval'), memberNames: ['Yuval', 'Friend'] })
    ).toBe('Yuval in Japan')
  })

  it('does not let a roster of blanks produce a stray possessive', () => {
    expect(displayTitle({ people: people('  ', '') })).toBe('Untitled trip')
  })
})
