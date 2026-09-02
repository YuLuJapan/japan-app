// Documents open in an in-app preview instead of downloading (FR-008).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../api/client'
import DocumentPreview from '../pages/DocumentPreview'
import TripFiles from '../pages/TripFiles'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  blob: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

// The PDF is rasterised rather than framed (no mobile browser renders a PDF
// inside a frame — that was this screen's blank-preview bug), and jsdom has no
// canvas to rasterise onto, so the pdf.js boundary is mocked exactly as the
// map's Leaflet engine is.
const pdf = vi.hoisted(() => ({ renderPdf: vi.fn() }))

vi.mock('../pdf/engine.pdfjs', () => ({ renderPdf: pdf.renderPdf, MAX_PAGES: 10 }))

const renderedPages = (count: number, pageCount = count) => ({
  canvases: Array.from({ length: count }, (_, i) => {
    const canvas = document.createElement('canvas')
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', `Page ${i + 1} of ${pageCount}`)
    return canvas
  }),
  pageCount,
})

const doc = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'file-1',
  display_name: 'Flight ticket',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  attached_to: { kind: 'trip', id: 'trip-1', name: 'Trip' },
  ...over,
})

const renderPreview = () =>
  renderAt('/trips/trip-1/files/file-1', [
    { path: '/trips/:tripId/files/:fileId', element: <DocumentPreview /> },
  ])

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  pdf.renderPdf.mockResolvedValue(renderedPages(1))
})

describe('DocumentPreview page', () => {
  it('renders a PDF inline with save/full-screen actions instead of downloading it', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    mocks.blob.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }))
    renderPreview()

    // Drawn, not framed. A framed PDF is blank on every phone browser, so the
    // assertion is that the pages themselves are on the screen.
    expect(await screen.findByRole('img', { name: 'Page 1 of 1' })).toBeInTheDocument()
    expect(pdf.renderPdf).toHaveBeenCalledWith('blob:preview', expect.any(Number))
    // Trip-scoped, like every other content route. This assertion used to
    // name the flat path, which is how the 404 survived: phase 3a-ii deleted
    // /api/files/:id/content and the test went on asserting the call it had
    // made impossible.
    expect(mocks.blob).toHaveBeenCalledWith('/trips/trip-1/files/file-1/content')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'download',
      'Flight ticket.pdf'
    )
    expect(screen.getByRole('link', { name: 'Open full screen' })).toBeInTheDocument()
  })

  it('says how many pages it left out of a long document', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    mocks.blob.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }))
    pdf.renderPdf.mockResolvedValue(renderedPages(10, 24))
    renderPreview()

    expect(await screen.findByText(/first 10 of 24 pages/)).toBeInTheDocument()
  })

  // pdf.js failing to load (a phone with no signal that has never opened a
  // document) or unreadable bytes must leave the two working ways in, not a
  // blank screen — the bug this whole path exists to fix.
  it('falls back to the download-only card when the PDF cannot be drawn', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    mocks.blob.mockResolvedValue(new Blob(['not a pdf'], { type: 'application/pdf' }))
    pdf.renderPdf.mockRejectedValue(new Error('InvalidPDFException'))
    renderPreview()

    expect(await screen.findByText(/can’t be shown here/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open full screen' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()
  })

  it('renders an image attached to a place, with a link back to it', async () => {
    mocks.get.mockResolvedValue({
      files: [
        doc({
          display_name: 'Entrance ticket',
          mime_type: 'image/png',
          attached_to: { kind: 'activity', id: 'place-1', name: 'teamLab' },
        }),
      ],
    })
    mocks.blob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    renderPreview()

    expect(await screen.findByAltText('Entrance ticket')).toHaveAttribute('src', 'blob:preview')
    expect(screen.getByRole('link', { name: 'teamLab' })).toHaveAttribute(
      'href',
      '/trips/trip-1/activities/place-1'
    )
  })

  it('explains a missing blob rather than showing a blank screen (FR-013)', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    mocks.blob.mockRejectedValue(new ApiError(404, 'FILE_MISSING', 'gone'))
    renderPreview()

    expect(await screen.findByText(/missing from storage/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument()
  })
})

describe('a document that has only just been attached', () => {
  // The list this page looks a document up in can be a beat behind the upload
  // that created it — invalidated rather than replaced, or answered from the
  // service worker's copy while the function wakes. Saying the file does not
  // exist and then showing it is the worse of the two lies, so the page waits.
  const renderWithCache = (seed: unknown[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['trip-files', 'trip-1'], { files: seed })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/trips/trip-1/files/file-1']}>
          <Routes>
            <Route path="/trips/:tripId/files/:fileId" element={<DocumentPreview />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  it('waits for the list to come back rather than saying it does not exist', async () => {
    let land: (value: { files: unknown[] }) => void = () => {}
    mocks.get.mockReturnValue(new Promise((resolve) => (land = resolve)))
    mocks.blob.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }))
    renderWithCache([])

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('This document no longer exists.')).not.toBeInTheDocument()

    land({ files: [doc()] })
    expect(await screen.findByTitle('Flight ticket')).toBeInTheDocument()
  })

  it('still says so once the list has been read and the file is not in it', async () => {
    mocks.get.mockResolvedValue({ files: [] })
    renderWithCache([])

    expect(await screen.findByText('This document no longer exists.')).toBeInTheDocument()
  })
})

describe('Documents list', () => {
  it('links each document to its preview screen', async () => {
    mocks.get.mockResolvedValue({ files: [doc()] })
    renderAt('/trips/trip-1/files', [{ path: '/trips/:tripId/files', element: <TripFiles /> }])

    expect(await screen.findByRole('link', { name: /Flight ticket/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/files/file-1'
    )
  })
})
