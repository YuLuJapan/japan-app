// Which set of tab labels a given number of tabs gets.
//
// The point of asserting this at all is that shortening is a *function of the
// count* rather than a separate edit (research R8): turning `show-map` off
// leaves at most five tabs, so today's labels come back with nothing to undo.
// That is what makes the flag a total rollback rather than a partial one.
//
// What no jsdom test can prove is that a label is legible at 320px. That is a
// step in quickstart §B3, at 375 and 320, and it is where SC-006 is verified.
import { describe, expect, it } from 'vitest'
import { navLabels } from '../lib/nav-labels'

describe('navLabels', () => {
  it("keeps today's labels at five tabs or fewer", () => {
    for (const count of [3, 4, 5]) {
      expect(navLabels(count)).toMatchObject({
        journey: 'Journey',
        shopping: 'Shopping',
        reminders: 'Reminders',
        essentials: 'Essentials',
        docs: 'Documents',
      })
    }
  })

  it('shortens three of them at six', () => {
    expect(navLabels(6)).toMatchObject({
      reminders: 'Alerts',
      essentials: 'Info',
      docs: 'Docs',
    })
  })

  it('leaves the short ones alone — they already fit', () => {
    expect(navLabels(6)).toMatchObject({ journey: 'Journey', shopping: 'Shopping', map: 'Map' })
  })

  it('names the map at either width, since it only exists at six', () => {
    expect(navLabels(5).map).toBe('Map')
  })
})
