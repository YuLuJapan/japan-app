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
  useDeleteFile,
  useDeleteShoppingItem,
  useRenameFile,
  useUpdateShoppingItem,
} from '../api/mutations'
import type { FileMeta, ShoppingItem } from '../api/types'

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { get: mocks.get, patch: mocks.patch, delete: mocks.delete },
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
