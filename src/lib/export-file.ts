// Naming an exported file, and handing it over.
//
// Two small jobs that both look trivial and both have a trap in them.
//
// **The name** follows the rules the app already uses for downloads
// (`downloadName` in `server/src/services/files.ts`): strip what would break a
// Content-Disposition header or escape a directory, then make sure the
// extension the type implies is on the end. The detail level is part of the
// name on purpose — two files of the same trip in a Downloads folder must not
// be indistinguishable, because one of them contains the booking references.
//
// **The delivery** is a second tap, not one. Web Share has to be called inside
// a user gesture, and iOS Safari drops the transient activation across the
// `await` that generating a PDF requires — sharing straight after generation
// throws `NotAllowedError` on the one platform where sharing matters most
// (research R7). So: generate, show a result sheet, share from *its* button.
// Where `canShare({ files })` says no — desktop, older browsers — we fall back
// to an object URL and a `download` link, the idiom `src/pages/DocumentPreview
// .tsx` already uses.
import type { ExportDetail, ExportFormat } from '../api/types'

const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
}

export const mimeFor = (format: ExportFormat) => MIME_BY_FORMAT[format]

/** What each version is called in a filename — and in the sheet that offers it. */
const SUFFIX: Record<ExportDetail, string> = { share: 'share', full: 'full' }

/**
 * `Yuval and Luciana in Japan` + `share` + `pdf` → `yuval-and-luciana-in-japan-share.pdf`.
 *
 * Lower-cased and hyphenated rather than merely sanitised: an exported file is
 * typed into a share sheet and read on someone else's phone, where a title
 * with spaces and apostrophes in it is a worse name than a plain one.
 */
export function exportFileName(title: string, detail: ExportDetail, format: ExportFormat): string {
  const base =
    title
      .normalize('NFKD')
      // Same intent as downloadName: nothing that could break a header or
      // escape a directory. Wider, because this name is built rather than
      // typed, so there is no reason to keep punctuation at all.
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80)
      .replace(/-+$/, '') || 'trip'
  return `${base}-${SUFFIX[detail]}.${format}`
}

/** How the file actually reached the traveller — reported, never guessed. */
export type DeliveryOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * Not an extension of `Navigator`: TypeScript's DOM library declares `share`
 * and `canShare` as always present, and they are exactly the two things that
 * are missing on the browsers this fallback exists for.
 */
interface ShareCapable {
  canShare?: (data?: ShareData) => boolean
  share?: (data?: ShareData) => Promise<void>
}

/**
 * Offer the file to the device's own share sheet.
 *
 * Returns `'cancelled'` when the traveller dismissed the sheet — that is not a
 * failure and must not raise anything. Anything else falls through to the
 * download, so this never leaves the caller without a file.
 */
export async function shareFile(file: File): Promise<DeliveryOutcome> {
  const nav = navigator as unknown as ShareCapable
  if (!nav.share || !nav.canShare?.({ files: [file] })) return downloadFile(file)
  try {
    await nav.share({ files: [file], title: file.name })
    return 'shared'
  } catch (err) {
    // The share sheet was dismissed. Every browser reports this as an
    // AbortError, and treating it as a failure would show an error toast for
    // someone simply changing their mind.
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    return downloadFile(file)
  }
}

/** Save it. The fallback everywhere, and a first-class choice on the sheet. */
export function downloadFile(file: File): DeliveryOutcome {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Not revoked synchronously: Safari has not finished reading the blob when
  // click() returns, and a revoked URL there saves an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

/** Wrap raw bytes as the named file the two functions above hand over. */
export const toExportFile = (
  bytes: BlobPart,
  title: string,
  detail: ExportDetail,
  format: ExportFormat
): File => new File([bytes], exportFileName(title, detail, format), { type: mimeFor(format) })
