// The export screen. What is asserted here is mostly *shape*: FR-005 is a
// statement about the UI, and the failure it guards against — one button with
// a detail toggle — is a screen that passes every functional test.
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TripExport from '../pages/TripExport'
import { renderAt } from './helpers'
import { getToasts, resetToasts } from '../lib/toast'
import { fullPayload, sharePayload } from './export-fixture'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

// The writers are exercised in export-file.test.ts, against the real payload.
// Here they would only slow the screen down and put a PDF engine inside jsdom.
const rendered = vi.hoisted(() => ({ calls: [] as string[], fail: false }))

vi.mock('../export/pdf', () => ({
  renderPdf: async () => {
    rendered.calls.push('pdf')
    if (rendered.fail) throw new Error('no')
    return new Blob(['%PDF'], { type: 'application/pdf' })
  },
}))
vi.mock('../export/xlsx', () => ({
  renderXlsx: async () => {
    rendered.calls.push('xlsx')
    return new Blob(['PK'], { type: 'application/zip' })
  },
}))

const captured = vi.hoisted(() => ({ events: [] as { name: string; props: unknown }[] }))

vi.mock('../lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/posthog')>()),
  capture: (name: string, props: unknown) => captured.events.push({ name, props }),
  captureError: () => {},
}))

function render() {
  rendered.calls = []
  rendered.fail = false
  captured.events = []
  resetToasts()
  mocks.get.mockImplementation((path: string) => {
    if (path.startsWith('/trips/trip-1/export')) {
      return Promise.resolve({
        export: path.includes('detail=full') ? fullPayload() : sharePayload(),
      })
    }
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
  return renderAt('/trips/trip-1/export', [
    { path: '/trips/:tripId/export', element: <TripExport /> },
  ])
}

describe('the export screen', () => {
  it('offers two separately labelled actions and no control that switches one into the other', async () => {
    render()
    expect(await screen.findByRole('button', { name: /share with a friend/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /full copy/i })).toBeInTheDocument()

    // FR-005: no switch, no radio, no select, and nothing offering both
    // versions from one control. A toggle left where the last person put it is
    // how a confirmation number reaches a group chat.
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    for (const button of screen.getAllByRole('button')) {
      const label = button.textContent ?? ''
      expect(/share with a friend/i.test(label) && /full copy/i.test(label)).toBe(false)
    }
  })

  it('says what each version contains, so nobody has to guess', async () => {
    render()
    expect(await screen.findByText(/nothing you wrote about a place goes with it/i)).toBeVisible()
    expect(screen.getByText(/descriptions, links, tips and the day-by-day plan/i)).toBeVisible()
  })

  it('makes the file and offers Share and Save on a second tap', async () => {
    render()
    await userEvent.click(await screen.findByRole('button', { name: /share with a friend/i }))

    const sheet = await screen.findByRole('dialog', { name: /your file is ready/i })
    expect(sheet).toBeInTheDocument()
    // The second tap is the point (research R7): sharing is a button on the
    // result, not something that happened while the file was being made.
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByText(/test-trip-share\.pdf/)).toBeInTheDocument()
  })

  it('records the shape of the export and nothing about the trip', async () => {
    render()
    await userEvent.click(await screen.findByRole('button', { name: /full copy/i }))
    await screen.findByRole('dialog', { name: /your file is ready/i })

    const event = captured.events.find((e) => e.name === 'trip_exported')
    expect(event?.props).toEqual({
      format: 'pdf',
      detail: 'full',
      place_count: 2,
      day_count: 1,
      included_stays: true,
    })
    // No name, no address, no title — the properties are shapes.
    expect(JSON.stringify(event?.props)).not.toContain('Ramen')
  })

  it('changes format without changing what is included', async () => {
    render()
    await userEvent.click(await screen.findByRole('button', { name: /share with a friend/i }))
    await screen.findByRole('dialog', { name: /your file is ready/i })

    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() => expect(rendered.calls).toEqual(['pdf', 'xlsx']))
    // Still the share version — a format cannot widen the detail level (FR-014).
    expect(await screen.findByText(/test-trip-share\.xlsx/)).toBeInTheDocument()
    expect(screen.getByText(/share with a friend/i, { selector: 'p' })).toBeInTheDocument()
  })

  it('says so plainly when the file cannot be made', async () => {
    render()
    rendered.fail = true
    await userEvent.click(await screen.findByRole('button', { name: /share with a friend/i }))

    // FR-020: a failure speaks. A spinner that stops, or an empty file, is the
    // failure this guards against. The toast is read off the store rather than
    // the DOM: it is rendered by components/Feedback.tsx, which lives in the
    // app shell rather than on this screen.
    await waitFor(() =>
      expect(getToasts()).toEqual([
        expect.objectContaining({
          tone: 'error',
          message: expect.stringMatching(/could not be made/i),
        }),
      ])
    )
    // And the screen goes back to offering the two versions rather than
    // showing a result sheet over an empty file.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /share with a friend/i })).toBeEnabled()
  })
})
