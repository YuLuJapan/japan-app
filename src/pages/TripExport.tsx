// Two labelled actions, and never a toggle.
//
// FR-005 is the shape of this screen, not a detail of it: a single "Export"
// button with a share/full switch is how a confirmation number reaches a group
// chat, because a switch left where the last person put it looks the same
// either way. So both versions are buttons, both say what they contain, and
// there is nothing on the screen that turns one into the other.
//
// The second tap is deliberate too (research R7). Web Share must be called
// inside a user gesture, and iOS Safari drops the transient activation across
// the `await` that generating a file requires — so we generate, show the
// result, and share from *its* button. That is still two taps: pick the
// version, then share it (SC-002).
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTripExport } from '../api/hooks'
import type { ExportDetail, ExportFormat, ExportPayload } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { downloadFile, shareFile, toExportFile } from '../lib/export-file'
import { capture, captureError } from '../lib/posthog'
import { showToast } from '../lib/toast'
import { useTripId } from '../lib/trip'

/**
 * The formats the screen offers.
 *
 * The JSON backup is deliberately not one of them: it answers a question
 * ("keep everything, for a machine") that nobody on this screen is asking, and
 * a fourth chip made the row read as a list of file types rather than a choice
 * between three ways of reading the same trip. `ExportFormat` still names it —
 * it is what `src/export/json.ts` and the field policy's `'json'` level are
 * written against — so putting the chip back is one line here.
 */
type OfferedFormat = Exclude<ExportFormat, 'json'>

/** Every writer, behind a dynamic import — none of this is in the entry bundle. */
const RENDERERS: Record<OfferedFormat, () => Promise<(p: ExportPayload) => Promise<Blob>>> = {
  pdf: () => import('../export/pdf').then((m) => m.renderPdf),
  docx: () => import('../export/docx').then((m) => m.renderDocx),
  xlsx: () => import('../export/xlsx').then((m) => m.renderXlsx),
}

const FORMATS: { id: OfferedFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Reads and prints anywhere' },
  { id: 'docx', label: 'Word', hint: 'They can edit and add to it' },
  { id: 'xlsx', label: 'Excel', hint: 'Places as sortable rows' },
]

const VERSIONS: { id: ExportDetail; label: string; blurb: string }[] = [
  {
    id: 'share',
    label: 'Share with a friend',
    blurb:
      'The route, the stops and their dates, and every place by name, address and type. Nothing you wrote about a place goes with it.',
  },
  {
    id: 'full',
    label: 'Full copy',
    blurb:
      'Everything above plus your descriptions, links, tips and the day-by-day plan. For printing or keeping outside the app.',
  },
]

type Screen =
  | { kind: 'idle' }
  | { kind: 'working'; detail: ExportDetail }
  | { kind: 'ready'; detail: ExportDetail; format: OfferedFormat; file: File }

export default function TripExport() {
  const tripId = useTripId()
  // Both levels, both fetched: the screen cannot know which button is coming,
  // and a payload that has been fetched once is what makes an offline export
  // possible at all (research R4).
  const share = useTripExport('share')
  const full = useTripExport('full')
  const [screen, setScreen] = useState<Screen>({ kind: 'idle' })

  const queryFor = (detail: ExportDetail) => (detail === 'share' ? share : full)

  async function build(detail: ExportDetail, format: OfferedFormat) {
    setScreen({ kind: 'working', detail })
    try {
      const query = queryFor(detail)
      // Already on the device in the ordinary case. `refetch` covers a first
      // visit that raced the fetch; offline it resolves from the service
      // worker's copy, and throws only when there has never been one.
      const data = query.data ?? (await query.refetch()).data
      if (!data) throw new Error('The trip could not be read for export')
      const payload = data.export
      const render = await RENDERERS[format]()
      const file = toExportFile(await render(payload), payload.trip.title, detail, format)
      setScreen({ kind: 'ready', detail, format, file })
      capture('trip_exported', {
        format,
        detail,
        place_count: payload.stats.place_count,
        day_count: payload.stats.day_count,
        included_stays: payload.stats.included_stays,
      })
    } catch (err) {
      // FR-020: an export that fails says so. A stalled spinner or an empty
      // file would both be worse than the sentence.
      captureError(err, 'export', { detail, format })
      showToast('error', 'That file could not be made — try again in a moment.')
      setScreen({ kind: 'idle' })
    }
  }

  const working = screen.kind === 'working'

  return (
    <div>
      <Breadcrumbs trail={[{ label: 'Trip', to: `/trips/${tripId}` }]} />
      <h1 className="mt-2 font-display text-2xl font-bold">Export this trip</h1>
      <p className="mt-1.5 text-sm text-muted">Made on this phone, so it works with no signal.</p>

      <div className="mt-5 space-y-3">
        {VERSIONS.map((version) => (
          <button
            key={version.id}
            type="button"
            disabled={working}
            onClick={() => build(version.id, 'pdf')}
            className="w-full rounded-3xl border border-line bg-white p-5 text-left shadow-card disabled:opacity-60"
          >
            <span className="font-display text-lg font-bold">{version.label}</span>
            <span className="mt-1.5 block text-sm text-muted">{version.blurb}</span>
            {working && screen.detail === version.id && (
              <span className="mt-3 block text-sm font-bold text-brand">Making the file…</span>
            )}
          </button>
        ))}
      </div>

      {screen.kind === 'ready' && (
        <ResultSheet
          detail={screen.detail}
          format={screen.format}
          file={screen.file}
          onFormat={(format) => build(screen.detail, format)}
          onClose={() => setScreen({ kind: 'idle' })}
        />
      )}
    </div>
  )
}

/**
 * What to do with the file that now exists.
 *
 * The format choice lives here rather than next to the two buttons on purpose:
 * a format never changes what is included (FR-014), so offering it before the
 * version would suggest the two decisions are the same kind of decision.
 */
function ResultSheet({
  detail,
  format,
  file,
  onFormat,
  onClose,
}: {
  detail: ExportDetail
  format: OfferedFormat
  file: File
  onFormat: (format: OfferedFormat) => void
  onClose: () => void
}) {
  const label = detail === 'share' ? 'Share with a friend' : 'Full copy'
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Your file is ready"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold">Your file is ready</h2>
        <p className="mt-1 text-sm text-muted">
          {label} · {file.name}
        </p>

        <div className="mt-5 flex gap-3">
          <button type="button" className="btn-ghost flex-1" onClick={() => downloadFile(file)}>
            Save
          </button>
          <button
            type="button"
            className="btn bg-brand flex-1 text-white"
            onClick={() => void shareFile(file)}
          >
            Share
          </button>
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-wide text-muted">
          Same content, another format
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              aria-pressed={option.id === format}
              onClick={() => onFormat(option.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                option.id === format
                  ? 'border-brand bg-brand/10 font-bold text-brand'
                  : 'border-line text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button type="button" className="btn-ghost mt-5 w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}
