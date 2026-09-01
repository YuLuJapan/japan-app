// The trip's files, and the grep that reads them.
//
// The thing under test is not "does grep work" — it is the property the whole
// mechanism rests on: **the prefix costs nothing to build, and a file costs
// something only when it is opened.** So the first assertion here is a call
// count, not a string. Everything after it is about a tool result being
// readable enough that a model can answer from it, which is the other half of
// the bargain: a lazy prefix that returns unreadable results is just a slower
// eager one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import type { DataStore, Trip } from '../src/lib/datastore.js'
import { tripFilePaths, tripFileSystem } from '../src/lib/chat-files.js'
import { buildLazyContext, buildTripContext } from '../src/lib/chat-context.js'
import { grepTool } from '../src/lib/ai/vfs.js'
import { fixture, largeFixture } from './fixture.js'

let store: DataStore

const trip = async (): Promise<Trip> => (await store.getTrip('trip-1'))!

const fs = async () => tripFileSystem(store, await trip())

/** What the model would have read, for a given call. */
const grep = async (input: Record<string, unknown>) => grepTool(await fs()).run(input)

beforeEach(() => {
  store = createMemoryStore(fixture())
})

describe('the listing', () => {
  it('names every file, and reads nothing to say so', async () => {
    // The point of the whole feature, as a call count. Building the prefix used
    // to be seven queries before the model had been asked anything.
    const places = vi.spyOn(store, 'listActivities')
    const zones = vi.spyOn(store, 'listZones')

    const manifest = (await fs()).manifest()

    for (const path of tripFilePaths()) expect(manifest).toContain(path)
    expect(places).not.toHaveBeenCalled()
    expect(zones).not.toHaveBeenCalled()
  })

  it('is byte-identical across builds', async () => {
    // It sits above the cache breakpoint. A byte that moves re-bills the whole
    // prefix and nothing else reports it (research R5, SC-008).
    expect((await fs()).manifest()).toBe((await fs()).manifest())
  })

  it('does not grow with the trip, where the eager prefix does', async () => {
    // The claim, measured rather than asserted — and measured on the *large*
    // fixture (~120 places), because on a toy trip the two prefixes are nearly
    // the same size and the comparison would prove nothing.
    //
    // The sharper half is the first assertion: the lazy prefix is the *same
    // length* on a trip three times the size, because the listing is fixed and
    // the front matter is six lines. It is flat where the other is linear.
    const small = buildLazyContext(await trip(), (await fs()).manifest())

    store = createMemoryStore(largeFixture())
    const large = buildLazyContext(await trip(), (await fs()).manifest())
    const eager = buildTripContext({
      trip: await trip(),
      steps: await store.listSteps('trip-1'),
      zones: await store.listZones('trip-1'),
      activities: await store.listActivities('trip-1'),
      tips: await store.listAllTips('trip-1'),
      shopping: await store.listShoppingItems('trip-1'),
      files: await store.listAllFiles('trip-1'),
    })

    expect(large.length).toBe(small.length)
    expect(large.length).toBeLessThan(eager.length / 6)
  })

  it('carries no sizes', async () => {
    // Deliberate: a size would have to be measured, measuring means building
    // every file, and building every file to write the prompt is the cost this
    // removes.
    expect((await fs()).manifest()).not.toMatch(/\d+ (lines|bytes|items)/)
  })
})

describe('reading a file whole', () => {
  it('returns it line-numbered, with the total', async () => {
    const result = await grep({ path: '/trip/saved.json' })
    expect(result).toContain('/trip/saved.json (lines 1-')
    expect(result).toContain('Ramen Bar')
    expect(result).toMatch(/^\s*\d+: /m)
  })

  it('pages a long file rather than truncating it away', async () => {
    store = createMemoryStore(largeFixture())
    const first = await grep({ path: '/trip/saved.json' })
    expect(first).toMatch(/Read on with offset \d+/)

    const offset = Number(first.match(/Read on with offset (\d+)/)![1])
    const second = await grep({ path: '/trip/saved.json', offset })
    expect(second).toContain(`(lines ${offset}-`)
    // The two pages meet rather than overlapping or skipping a line.
    expect(second).not.toContain(`\n${offset - 1}: `)
  })

  it('says so plainly when asked for a line past the end', async () => {
    expect(await grep({ path: '/trip/tips.json', offset: 9999 })).toContain(
      'there is nothing at line 9999'
    )
  })

  it('refuses to read every file at once', async () => {
    // A read with no path is the eager prefix rebuilt through a side door, so it
    // is refused with the one thing that would have worked instead.
    expect(await grep({})).toContain('Reading needs a path')
  })

  it('lists the real paths when asked for one that does not exist', async () => {
    // The model wrote the path, so a wrong one is routine. Answering with the
    // listing costs one round trip; answering "not found" costs the turn.
    const result = await grep({ path: '/trip/hotels.json' })
    expect(result).toContain('There is no file at "/trip/hotels.json"')
    expect(result).toContain('/trip/saved.json')
  })
})

describe('searching', () => {
  it('finds a line and shows what is around it', async () => {
    const result = await grep({ path: '/trip/saved.json', pattern: 'Ramen' })
    expect(result).toContain('/trip/saved.json:')
    expect(result).toContain('Ramen Bar')
    // The context is the point: a match on a name is useless without the city
    // and category lines that bracket it.
    expect(result).toContain('Tokyo')
  })

  it('searches every file when given no path', async () => {
    // The first move for a question whose answer could be in two places.
    const result = await grep({ pattern: 'Suica' })
    expect(result).toContain('/trip/tips.json:')
    expect(result).toContain('Get a Suica card')
  })

  it('is case-insensitive, because the model does not know the casing', async () => {
    expect(await grep({ pattern: 'fushimi inari' })).toContain('Fushimi Inari')
  })

  it('says nothing matched rather than returning an empty result', async () => {
    // An empty search *is* an answer — "there is no ramen place saved in Osaka"
    // — and the model can only give it if the tool says so in words.
    expect(await grep({ path: '/trip/saved.json', pattern: 'zzz-no-such-place' })).toContain(
      'No lines in /trip/saved.json match that'
    )
  })

  it('explains a bad pattern instead of failing the turn', async () => {
    const result = await grep({ pattern: '[unclosed' })
    expect(result).toContain('not a valid regular expression')
  })

  it('caps a huge result and says how to narrow it', async () => {
    store = createMemoryStore(largeFixture())
    const result = await grep({ pattern: 'Place', context: 6 })
    expect(result).toContain('stopped at 300 lines')
    expect(result.split('\n').length).toBeLessThan(320)
  })
})

describe('what the files contain', () => {
  it('groups every place under the city it is in', async () => {
    const result = await grep({ path: '/trip/saved.json', pattern: 'Fushimi', context: 4 })
    expect(result).toContain('Kyoto')
    expect(result).toContain('"category": "attraction"')
  })

  it('carries the flight, booking reference and all', async () => {
    // A writer sees this everywhere else in the app; refusing to answer "what
    // time is our flight?" would be a feature that looks broken (FR-011).
    await store.updateTrip('trip-1', {
      flight: {
        airline: 'Ethiopian',
        booking_ref: 'ABC123',
        outbound: {
          depart_at: '2026-10-01T05:00:00Z',
          depart_tz: 'Asia/Jerusalem',
          legs: [{ flight_no: 'ET404', from: 'TLV', to: 'NRT' }],
        },
      },
    })
    const result = await grep({ path: '/trip/flight.json' })
    expect(result).toContain('ABC123')
    // The zone travels with the instant, always as a pair: without it the model
    // reads "05:00" and tells somebody the wrong hour after they land.
    expect(result).toContain('Asia/Jerusalem')
  })

  it('says the flight is not set rather than inventing one', async () => {
    await store.updateTrip('trip-1', { flight: null })
    expect(await grep({ path: '/trip/flight.json' })).toContain('1: null')
  })

  it('names documents without offering their contents', async () => {
    // 005 ships names only; what is inside a document is 007's job, behind its
    // own approval gate.
    const result = await grep({ path: '/trip/documents.json' })
    expect(result).toContain('Flight booking')
    expect(result).not.toContain('storage_path')
  })

  it('resolves a day-plan entry to its city and its place by name', async () => {
    const result = await grep({
      path: '/trip/plan.json',
      pattern: 'Walk Shinjuku',
      context: 5,
    })
    expect(result).toContain('Tokyo')
    expect(result).not.toContain('zone-tokyo')
  })
})

describe('whose trip it is', () => {
  it('never shows another trip through a file', async () => {
    // A new read path over the same rows, so the tenancy rule is re-asserted
    // here rather than assumed from the routes: Osaka belongs to trip-2 in the
    // fixture, and nothing about it may reach this trip's files.
    for (const path of tripFilePaths()) {
      const result = await grep({ path })
      expect(result).not.toContain('Osaka')
    }
    expect(await grep({ pattern: 'Osaka' })).toContain('No lines in any file match that')
  })
})

describe('paying for a file once', () => {
  it('reads the datastore once however many times a file is opened', async () => {
    // Three files need the city names and two need the place names, so without
    // memoising, a turn that read the plan and the tips would fetch the same
    // lists four times inside one serverless invocation.
    const zones = vi.spyOn(store, 'listZones')
    const files = await fs()
    const tool = grepTool(files)

    await tool.run({ path: '/trip/saved.json' })
    await tool.run({ path: '/trip/saved.json', pattern: 'Ramen' })
    await tool.run({ path: '/trip/tips.json' })

    expect(zones).toHaveBeenCalledTimes(1)
  })

  it('reads only the files that were opened', async () => {
    const shopping = vi.spyOn(store, 'listShoppingItems')
    const files = await fs()
    await grepTool(files).run({ path: '/trip/flight.json' })

    expect(shopping).not.toHaveBeenCalled()
    expect(files.touched).toEqual(['/trip/flight.json'])
  })
})
