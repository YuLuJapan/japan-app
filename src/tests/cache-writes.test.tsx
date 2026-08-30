// Writes that put the server's own answer where the screen reads it.
//
// The point is what happens *before* any refetch: the row the person just
// changed is already right, so the confirmation has nothing to wait for. These
// assert on the cache immediately after the mutation settles, with the refetch
// deliberately never resolving — if a test passes, the screen was correct
// without it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  useCreateItineraryItem,
  useCreatePlace,
  useCreateReminder,
  useCreateTip,
  useCreateShoppingItem,
  useCreateStep,
  useCreateTrip,
  useDeleteReminder,
  useDeleteFile,
  useDeleteShoppingItem,
  useDeleteStep,
  useDeleteTrip,
  useUpdateStep,
  useRenameFile,
  useUploadFile,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMember,
  useUpdatePlace,
  useUpdateReminder,
  useUpdateZone,
  useUpdateShoppingItem,
  useUpdateTrip,
} from '../api/mutations'
import type { FileMeta, Place, PlaceListItem, Reminder, ShoppingItem, Trip } from '../api/types'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
}))

const file: FileMeta = {
  id: 'f1',
  display_name: 'Old name',
  mime_type: 'application/pdf',
  size_bytes: 10,
}

const item: ShoppingItem = {
  id: 's1',
  trip_id: 't1',
  name: 'Kit Kats',
  category: 'snacks',
  note: null,
  shop: null,
  zone_id: null,
  price_yen: 500,
  url: null,
  image_url: null,
  bought: false,
  position: 0,
}

const trip: Trip = {
  id: 't1',
  name: 'Japan',
  country: 'Japan',
  country_code: 'JP',
  display_title: 'Japan',
  start_date: '2026-10-01',
  end_date: '2026-10-14',
  description: null,
  people: [],
  local_currency: 'JPY',
  home_currencies: ['USD'],
  start_time: null,
  start_tz: null,
}

let client: QueryClient

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/trips/t1/x']}>
      <Routes>
        <Route path="/trips/:tripId/x" element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, gcTime: 86_400_000, retry: false } },
  })
  // Any refetch hangs for the whole test: nothing here may depend on one.
  mocks.get.mockImplementation(() => new Promise(() => {}))
  mocks.patch.mockReset()
  mocks.post.mockReset()
  mocks.delete.mockReset()
  mocks.delete.mockResolvedValue(undefined)
})

afterEach(() => {
  client.clear()
})

describe('renaming a file', () => {
  it('writes the new name into every list holding it, without a refetch', async () => {
    client.setQueryData(['trip-files', 't1'], {
      files: [{ ...file, attached_to: { kind: 'zone', id: 'z1', name: 'Kyoto' } }],
    })
    client.setQueryData(['zone', 'z1'], { zone: { id: 'z1' }, tips: [], files: [file] })
    mocks.patch.mockResolvedValue({ file: { ...file, display_name: 'New name' } })

    const { result } = renderHook(() => useRenameFile({ kind: 'zone', id: 'z1' }), { wrapper })
    result.current.mutate({ fileId: 'f1', display_name: 'New name' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const docs = client.getQueryData<{ files: FileMeta[] }>(['trip-files', 't1'])
    const zone = client.getQueryData<{ files: FileMeta[] }>(['zone', 'z1'])
    expect(docs?.files[0].display_name).toBe('New name')
    expect(zone?.files[0].display_name).toBe('New name')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('keeps what the response does not carry — a document knows where it hangs', async () => {
    // The trip's list rows carry `attached_to`, which the file response has no
    // idea about. Merging rather than replacing is what preserves it.
    client.setQueryData(['trip-files', 't1'], {
      files: [{ ...file, attached_to: { kind: 'zone', id: 'z1', name: 'Kyoto' } }],
    })
    mocks.patch.mockResolvedValue({ file: { ...file, display_name: 'New name' } })

    const { result } = renderHook(() => useRenameFile({ kind: 'trip' }), { wrapper })
    result.current.mutate({ fileId: 'f1', display_name: 'New name' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const docs = client.getQueryData<{ files: { attached_to?: unknown }[] }>(['trip-files', 't1'])
    expect(docs?.files[0].attached_to).toEqual({ kind: 'zone', id: 'z1', name: 'Kyoto' })
  })
})

describe('the shopping list', () => {
  it('moves a ticked item between sections on the spot', async () => {
    // The list filters on `bought`, so writing the row back is the whole move.
    client.setQueryData(['shopping', 't1'], { items: [item] })
    mocks.patch.mockResolvedValue({ item: { ...item, bought: true } })

    const { result } = renderHook(() => useUpdateShoppingItem(), { wrapper })
    result.current.mutate({ id: 's1', patch: { bought: true } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData<{ items: ShoppingItem[] }>(['shopping', 't1'])?.items[0].bought
    ).toBe(true)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('takes a deleted item straight out', async () => {
    client.setQueryData(['shopping', 't1'], { items: [item] })

    const { result } = renderHook(() => useDeleteShoppingItem(), { wrapper })
    result.current.mutate('s1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ items: ShoppingItem[] }>(['shopping', 't1'])?.items).toEqual([])
  })
})

describe('deleting a document', () => {
  it('takes it out of every list at once', async () => {
    client.setQueryData(['trip-files', 't1'], { files: [file] })
    client.setQueryData(['place', 'p1'], { place: { id: 'p1' }, tips: [], files: [file] })

    const { result } = renderHook(() => useDeleteFile(), { wrapper })
    result.current.mutate('f1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ files: FileMeta[] }>(['trip-files', 't1'])?.files).toEqual([])
    expect(client.getQueryData<{ files: FileMeta[] }>(['place', 'p1'])?.files).toEqual([])
  })
})

describe('what is deliberately left to the refetch', () => {
  it('leaves a cache it cannot read alone rather than mangling it', async () => {
    // `setQueriesData` sweeps every key under a prefix, and not all of them
    // hold a file list. Anything unrecognised is passed through untouched.
    client.setQueryData(['zone', 'z1'], { zone: { id: 'z1' }, place_counts: { food: 2 } })
    mocks.patch.mockResolvedValue({ file: { ...file, display_name: 'New name' } })

    const { result } = renderHook(() => useRenameFile({ kind: 'trip' }), { wrapper })
    result.current.mutate({ fileId: 'f1', display_name: 'New name' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(['zone', 'z1'])).toEqual({
      zone: { id: 'z1' },
      place_counts: { food: 2 },
    })
  })
})

describe('the patch does not replace the refresh', () => {
  it('still refetches on the next visit, despite the fresh cache entry', async () => {
    // Writing to the cache refreshes `dataUpdatedAt`, which could plausibly
    // make a stale query look fresh and skip the reconciling refetch — the
    // thing that catches whatever the response could not tell us. The
    // invalidation that follows the patch is what makes sure it doesn't.
    client.setQueryData(['zone', 'z1'], { zone: { id: 'z1' }, tips: [], files: [file] })
    mocks.patch.mockResolvedValue({ file: { ...file, display_name: 'New name' } })

    const { result } = renderHook(() => useRenameFile({ kind: 'zone', id: 'z1' }), { wrapper })
    result.current.mutate({ fileId: 'f1', display_name: 'New name' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await waitFor(() => expect(client.getQueryState(['zone', 'z1'])?.isInvalidated).toBe(true))
    const fetched = await client.fetchQuery({
      queryKey: ['zone', 'z1'],
      queryFn: () => Promise.resolve({ zone: { id: 'z1' }, tips: [], files: [] }),
      staleTime: 60_000,
    })
    expect(fetched).toEqual({ zone: { id: 'z1' }, tips: [], files: [] })
  })
})

describe('the trips list', () => {
  it('shows a new trip at once, at the end where created_at puts it', async () => {
    const existing = { ...trip, id: 't0', display_title: 'Lisbon' }
    client.setQueryData(['trips'], { trips: [existing] })
    mocks.post.mockResolvedValue({ trip })

    const { result } = renderHook(() => useCreateTrip(), { wrapper })
    result.current.mutate({ name: 'Japan', start_date: '2026-10-01', end_date: '2026-10-14' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData<{ trips: Trip[] }>(['trips'])
    expect(cached?.trips.map((t) => t.id)).toEqual(['t0', 't1'])
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('shows an edited trip at once, server-computed title and all', async () => {
    client.setQueryData(['trips'], { trips: [trip] })
    client.setQueryData(['trip', 't1'], { trip, steps: [], trip_files_count: 0 })
    // `display_title` is the server's to compute, and it hands it back.
    mocks.patch.mockResolvedValue({
      trip: { ...trip, name: 'Honeymoon', display_title: 'Honeymoon' },
    })

    const { result } = renderHook(() => useUpdateTrip('t1'), { wrapper })
    result.current.mutate({ name: 'Honeymoon' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ trips: Trip[] }>(['trips'])?.trips[0].display_title).toBe(
      'Honeymoon'
    )
    expect(client.getQueryData<{ trip: Trip }>(['trip', 't1'])?.trip.display_title).toBe(
      'Honeymoon'
    )
  })

  it('leaves the bundle to the refetch when the server moved more than the trip', async () => {
    // New dates can move journey steps and rewrite the day plan. Patching the
    // trip alone would show a range its own stops fall outside of: stale but
    // self-consistent beats half-new.
    const steps = [{ id: 'step-1', start_date: '2026-10-01', end_date: '2026-10-03' }]
    client.setQueryData(['trips'], { trips: [trip] })
    client.setQueryData(['trip', 't1'], { trip, steps, trip_files_count: 0 })
    mocks.patch.mockResolvedValue({
      trip: { ...trip, start_date: '2026-11-01', end_date: '2026-11-14' },
      moved_stops: ['step-1'],
    })

    const { result } = renderHook(() => useUpdateTrip('t1'), { wrapper })
    result.current.mutate({ start_date: '2026-11-01', end_date: '2026-11-14' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const bundle = client.getQueryData<{ trip: Trip }>(['trip', 't1'])
    expect(bundle?.trip.start_date).toBe('2026-10-01') // untouched, awaiting the refetch
    // …while the list row, which is only ever the trip's own fields, is current
    expect(client.getQueryData<{ trips: Trip[] }>(['trips'])?.trips[0].start_date).toBe(
      '2026-11-01'
    )
  })

  it('takes a deleted trip straight off the list', async () => {
    client.setQueryData(['trips'], { trips: [trip, { ...trip, id: 't2' }] })

    const { result } = renderHook(() => useDeleteTrip(), { wrapper })
    result.current.mutate('t1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ trips: Trip[] }>(['trips'])?.trips.map((t) => t.id)).toEqual([
      't2',
    ])
  })
})

describe('tips', () => {
  it('appears under its zone the moment it is added', async () => {
    client.setQueryData(['zone', 'z1'], { zone: { id: 'z1' }, tips: [], files: [] })
    mocks.post.mockResolvedValue({ tip: { id: 'tip-1', zone_id: 'z1', body: 'Book ahead' } })

    const { result } = renderHook(() => useCreateTip({ zone_id: 'z1' }), { wrapper })
    result.current.mutate('Book ahead')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const zone = client.getQueryData<{ tips: { body: string }[] }>(['zone', 'z1'])
    expect(zone?.tips.map((t) => t.body)).toEqual(['Book ahead'])
    expect(mocks.get).not.toHaveBeenCalled()
  })
})

describe('reminders', () => {
  const reminder = (over: Partial<Reminder>): Reminder => ({
    id: 'r1',
    trip_id: 't1',
    title: 'Book the ryokan',
    body: null,
    url: null,
    remind_at: '2026-09-12T00:00:00.000Z',
    time_zone: 'Asia/Tokyo',
    sent_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    ...over,
  })

  it('re-times one into its new place in the list, not just in place', async () => {
    // The list is soonest first, so moving a reminder later has to move the row.
    const early = reminder({ id: 'r1', remind_at: '2026-09-01T00:00:00.000Z' })
    const late = reminder({ id: 'r2', remind_at: '2026-09-20T00:00:00.000Z' })
    client.setQueryData(['reminders', 't1'], { reminders: [early, late] })
    mocks.patch.mockResolvedValue({
      reminder: { ...early, remind_at: '2026-09-30T00:00:00.000Z' },
    })

    const { result } = renderHook(() => useUpdateReminder(), { wrapper })
    result.current.mutate({ id: 'r1', patch: { remind_at: '2026-09-30T00:00:00.000Z' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData<{ reminders: Reminder[] }>(['reminders', 't1'])
    expect(cached?.reminders.map((r) => r.id)).toEqual(['r2', 'r1'])
  })

  it('drops a deleted one at once', async () => {
    client.setQueryData(['reminders', 't1'], { reminders: [reminder({ id: 'r1' })] })
    const { result } = renderHook(() => useDeleteReminder(), { wrapper })
    result.current.mutate('r1')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ reminders: Reminder[] }>(['reminders', 't1'])?.reminders).toEqual(
      []
    )
  })

  it('sorts a new one in rather than tacking it on the end', async () => {
    const late = reminder({ id: 'r2', remind_at: '2026-09-20T00:00:00.000Z' })
    client.setQueryData(['reminders', 't1'], { reminders: [late] })
    mocks.post.mockResolvedValue({
      reminder: reminder({ id: 'r3', remind_at: '2026-09-05T00:00:00.000Z' }),
    })

    const { result } = renderHook(() => useCreateReminder('t1'), { wrapper })
    result.current.mutate({ title: 'Pack', remind_at: '2026-09-05T00:00:00.000Z' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData<{ reminders: Reminder[] }>(['reminders', 't1'])
    expect(cached?.reminders.map((r) => r.id)).toEqual(['r3', 'r2'])
  })
})

describe('the journey', () => {
  it("keeps a step's zone when the step itself changes", async () => {
    // The bundle's step carries the zone — name and photo for the card — and
    // the step response has no idea about it. Merging is what keeps it.
    const step = {
      id: 'step-1',
      position: 0,
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      zone: { id: 'z1', name: 'Kyoto', image_url: 'photo.jpg' },
    }
    client.setQueryData(['trip', 't1'], { trip, steps: [step], trip_files_count: 0 })
    mocks.patch.mockResolvedValue({
      step: {
        id: 'step-1',
        trip_id: 't1',
        zone_id: 'z1',
        position: 0,
        start_date: '2026-10-02',
        end_date: '2026-10-05',
      },
    })

    const { result } = renderHook(() => useUpdateStep(), { wrapper })
    result.current.mutate({ id: 'step-1', patch: { start_date: '2026-10-02' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const steps = client.getQueryData<{ steps: (typeof step)[] }>(['trip', 't1'])?.steps
    expect(steps?.[0].start_date).toBe('2026-10-02')
    expect(steps?.[0].zone).toEqual({ id: 'z1', name: 'Kyoto', image_url: 'photo.jpg' })
  })

  it('takes a removed step out of the journey at once', async () => {
    const step = {
      id: 'step-1',
      position: 0,
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      zone: null,
    }
    client.setQueryData(['trip', 't1'], { trip, steps: [step], trip_files_count: 0 })

    const { result } = renderHook(() => useDeleteStep(), { wrapper })
    result.current.mutate('step-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ steps: unknown[] }>(['trip', 't1'])?.steps).toEqual([])
  })
})

describe('a zone photo', () => {
  it('changes on the zone and on its journey card together', async () => {
    client.setQueryData(['zone', 'z1'], {
      zone: { id: 'z1', image_url: 'old.jpg' },
      tips: [],
      files: [],
    })
    client.setQueryData(['trip', 't1'], {
      trip,
      steps: [
        { id: 'step-1', position: 0, zone: { id: 'z1', name: 'Kyoto', image_url: 'old.jpg' } },
      ],
      trip_files_count: 0,
    })
    mocks.patch.mockResolvedValue({ zone: { id: 'z1', image_url: 'new.jpg' } })

    const { result } = renderHook(() => useUpdateZone('z1'), { wrapper })
    result.current.mutate({ image_url: 'new.jpg' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData<{ zone: { image_url: string } }>(['zone', 'z1'])?.zone.image_url
    ).toBe('new.jpg')
    const steps = client.getQueryData<{ steps: { zone: { image_url: string } }[] }>([
      'trip',
      't1',
    ])?.steps
    expect(steps?.[0].zone.image_url).toBe('new.jpg')
  })
})

describe('sharing', () => {
  it('flips a sharing switch on the row you flipped it on', async () => {
    const member = {
      user_id: 'u1',
      role: 'viewer' as const,
      email: 'friend@example.com',
      display_name: 'Friend',
      avatar_url: null,
      can_see_stays: false,
      can_see_flight: false,
      can_see_documents: false,
      can_see_shopping: false,
    }
    client.setQueryData(['members', 't1'], { members: [member] })
    mocks.patch.mockResolvedValue({ member: { ...member, can_see_stays: true } })

    const { result } = renderHook(() => useUpdateMember('t1'), { wrapper })
    result.current.mutate({ userId: 'u1', can_see_stays: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData<{ members: (typeof member)[] }>(['members', 't1'])
    expect(cached?.members[0].can_see_stays).toBe(true)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('drops a removed member and a revoked invitation at once', async () => {
    client.setQueryData(['members', 't1'], { members: [{ user_id: 'u1' }, { user_id: 'u2' }] })
    client.setQueryData(['invites', 't1'], { invites: [{ id: 'i1' }, { id: 'i2' }] })

    const member = renderHook(() => useRemoveMember('t1'), { wrapper })
    member.result.current.mutate('u1')
    await waitFor(() => expect(member.result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData<{ members: { user_id: string }[] }>(['members', 't1'])?.members
    ).toEqual([{ user_id: 'u2' }])

    const invite = renderHook(() => useRevokeInvite('t1'), { wrapper })
    invite.result.current.mutate('i1')
    await waitFor(() => expect(invite.result.current.isSuccess).toBe(true))
    expect(client.getQueryData<{ invites: { id: string }[] }>(['invites', 't1'])?.invites).toEqual([
      { id: 'i2' },
    ])
  })
})

describe('activities in a zone', () => {
  const place = (over: Partial<Place> = {}): Place => ({
    id: 'p1',
    zone_id: 'z1',
    category: 'food',
    name: 'Ramen Bar',
    name_ja: null,
    description: 'Tiny counter, queue early',
    address: null,
    links: [],
    image_url: null,
    lat: null,
    lng: null,
    summary_line: 'Tiny counter, queue early',
    ...over,
  })

  const row = (over: Partial<PlaceListItem> = {}): PlaceListItem => ({
    id: 'p1',
    name: 'Ramen Bar',
    name_ja: null,
    category: 'food',
    summary_line: 'Tiny counter, queue early',
    image_url: null,
    address: null,
    lat: null,
    lng: null,
    ...over,
  })

  it('shows an edited name and summary back in the zone list, in place', async () => {
    // The list you return to after editing — the one that used to hold the old
    // name until a refetch caught up.
    client.setQueryData(['place', 'p1'], { place: place(), tips: [], files: [] })
    client.setQueryData(['zone-places', 'z1', 'food'], {
      places: [row({ id: 'p0', name: 'First' }), row()],
    })
    mocks.patch.mockResolvedValue({
      place: place({ name: 'Ichiran', description: 'Solo booths', summary_line: 'Solo booths' }),
    })

    const { result } = renderHook(() => useUpdatePlace('p1'), { wrapper })
    result.current.mutate({ name: 'Ichiran', description: 'Solo booths' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const list = client.getQueryData<{ places: PlaceListItem[] }>(['zone-places', 'z1', 'food'])
    expect(list?.places.map((p) => p.name)).toEqual(['First', 'Ichiran']) // position kept
    expect(list?.places[1].summary_line).toBe('Solo booths') // the server's own line
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('moves it between lists, and between tallies, when the category changes', async () => {
    client.setQueryData(['place', 'p1'], { place: place(), tips: [], files: [] })
    client.setQueryData(['zone-places', 'z1', 'food'], { places: [row()] })
    client.setQueryData(['zone-places', 'z1', 'attraction'], { places: [] })
    client.setQueryData(['zone', 'z1'], {
      zone: { id: 'z1' },
      tips: [],
      files: [],
      place_counts: { hotel: 0, attraction: 2, food: 1, shopping: 0, other: 0 },
    })
    mocks.patch.mockResolvedValue({ place: place({ category: 'attraction' }) })

    const { result } = renderHook(() => useUpdatePlace('p1'), { wrapper })
    result.current.mutate({ category: 'attraction' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData<{ places: PlaceListItem[] }>(['zone-places', 'z1', 'food'])?.places
    ).toEqual([])
    expect(
      client
        .getQueryData<{ places: PlaceListItem[] }>(['zone-places', 'z1', 'attraction'])
        ?.places.map((p) => p.id)
    ).toEqual(['p1'])
    const counts = client.getQueryData<{ place_counts: Record<string, number> }>(['zone', 'z1'])
    expect(counts?.place_counts).toMatchObject({ food: 0, attraction: 3 })
  })

  it('adds a new one to its list and its tally at once', async () => {
    client.setQueryData(['zone-places', 'z1', 'food'], { places: [row({ id: 'p0' })] })
    client.setQueryData(['zone', 'z1'], {
      zone: { id: 'z1' },
      tips: [],
      files: [],
      place_counts: { hotel: 0, attraction: 0, food: 1, shopping: 0, other: 0 },
    })
    mocks.post.mockResolvedValue({ place: place({ id: 'p2', name: 'New spot' }) })

    const { result } = renderHook(() => useCreatePlace(), { wrapper })
    result.current.mutate({ zone_id: 'z1', category: 'food', name: 'New spot' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const list = client.getQueryData<{ places: PlaceListItem[] }>(['zone-places', 'z1', 'food'])
    // Appended: the list is created_at ascending, so the newest belongs last.
    expect(list?.places.map((p) => p.id)).toEqual(['p0', 'p2'])
    const counts = client.getQueryData<{ place_counts: Record<string, number> }>(['zone', 'z1'])
    expect(counts?.place_counts.food).toBe(2)
  })

  it('leaves a category list it has never loaded alone', async () => {
    // Nothing is invented for a list nobody has opened: it simply fetches.
    client.setQueryData(['zone-places', 'z1', 'food'], { places: [] })
    mocks.post.mockResolvedValue({ place: place({ id: 'p3', category: 'shopping' }) })

    const { result } = renderHook(() => useCreatePlace(), { wrapper })
    result.current.mutate({ zone_id: 'z1', category: 'shopping', name: 'Loft' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(['zone-places', 'z1', 'shopping'])).toBeUndefined()
    expect(
      client.getQueryData<{ places: PlaceListItem[] }>(['zone-places', 'z1', 'food'])?.places
    ).toEqual([])
  })
})

describe('what the API now hands back whole', () => {
  it('puts an uploaded document straight into the list, where it hangs and all', async () => {
    // The upload answers with the row the Documents tab renders — `attached_to`
    // included, which the client could never have built.
    client.setQueryData(['trip-files', 't1'], { files: [] })
    mocks.post.mockResolvedValue({
      file: { ...file, attached_to: { kind: 'place', id: 'p1', name: 'Ramen Bar' } },
    })

    const { result } = renderHook(() => useUploadFile('t1'), { wrapper })
    result.current.mutate({
      parent: { kind: 'place', id: 'p1' },
      display_name: 'Old name',
      mime_type: 'application/pdf',
      data_base64: 'AAAA',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const docs = client.getQueryData<{ files: { attached_to: { name: string } }[] }>([
      'trip-files',
      't1',
    ])
    expect(docs?.files[0].attached_to).toEqual({ kind: 'place', id: 'p1', name: 'Ramen Bar' })
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('sorts a new journey stop into date order, with its zone on it', async () => {
    const later = {
      id: 'step-2',
      position: 1,
      start_date: '2026-10-10',
      end_date: '2026-10-12',
      zone: { id: 'z2', name: 'Kyoto' },
    }
    client.setQueryData(['trip', 't1'], { trip, steps: [later], trip_files_count: 0 })
    mocks.post.mockResolvedValue({
      step: {
        id: 'step-1',
        position: 2,
        start_date: '2026-10-02',
        end_date: '2026-10-05',
        zone: { id: 'z1', name: 'Tokyo', image_url: 'tokyo.jpg' },
      },
    })

    const { result } = renderHook(() => useCreateStep('t1'), { wrapper })
    result.current.mutate({ zone_id: 'z1', start_date: '2026-10-02', end_date: '2026-10-05' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const steps = client.getQueryData<{ steps: { id: string; zone: { name: string } }[] }>([
      'trip',
      't1',
    ])?.steps
    // Earlier stop first, though it was added second — and the card has a zone.
    expect(steps?.map((s) => s.id)).toEqual(['step-1', 'step-2'])
    expect(steps?.[0].zone.name).toBe('Tokyo')
  })

  it('drops a new activity into the right place in its day', async () => {
    const anytime = {
      id: 'i1',
      trip_id: 't1',
      zone_id: null,
      place_id: null,
      day: '2026-10-02',
      start_time: null,
      title: 'Wander',
      note: null,
      position: 0,
      highlight: false,
      icon: null,
    }
    client.setQueryData(['itinerary', 't1'], { items: [anytime] })
    mocks.post.mockResolvedValue({
      item: { ...anytime, id: 'i2', start_time: '09:00', title: 'Museum' },
    })

    const { result } = renderHook(() => useCreateItineraryItem('t1'), { wrapper })
    result.current.mutate({ day: '2026-10-02', title: 'Museum', start_time: '09:00' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Timed items sort ahead of untimed ones — the order the API returns.
    expect(
      client
        .getQueryData<{ items: { title: string }[] }>(['itinerary', 't1'])
        ?.items.map((i) => i.title)
    ).toEqual(['Museum', 'Wander'])
  })

  it('sinks a bought item below the ones still to buy', async () => {
    const toBuy = { ...item, id: 's2', name: 'Socks', position: 1 }
    client.setQueryData(['shopping', 't1'], { items: [item, toBuy] })
    mocks.patch.mockResolvedValue({ item: { ...item, bought: true } })

    const { result } = renderHook(() => useUpdateShoppingItem(), { wrapper })
    result.current.mutate({ id: 's1', patch: { bought: true } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData<{ items: ShoppingItem[] }>(['shopping', 't1'])?.items.map((i) => i.id)
    ).toEqual(['s2', 's1'])
  })

  it('adds a new shopping item without a refetch', async () => {
    client.setQueryData(['shopping', 't1'], { items: [item] })
    mocks.post.mockResolvedValue({ item: { ...item, id: 's3', name: 'Matcha', position: 1 } })

    const { result } = renderHook(() => useCreateShoppingItem('t1'), { wrapper })
    result.current.mutate({ name: 'Matcha' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData<{ items: ShoppingItem[] }>(['shopping', 't1'])?.items.map((i) => i.id)
    ).toEqual(['s1', 's3'])
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
