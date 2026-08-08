// Files with recognizable name/type; tap → the preview screen at /files/:id,
// which renders the document in the app rather than downloading it (FR-008).
// Load failures, incl. FILE_MISSING, are explained there (FR-013).
// When `deletable` is set, each file gets a confirmed delete (owner passed for
// cache invalidation).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteFile } from '../api/mutations'
import type { FileMeta, FileParent } from '../api/types'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'
import { ConfirmDialog } from './ConfirmDialog'

const icon = (mime: string) => {
  if (mime.includes('pdf')) return '📄'
  if (mime.startsWith('image/')) return '🖼️'
  return '📎'
}

const size = (bytes: number) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function FileList({ files, deletable }: { files: FileMeta[]; deletable?: FileParent }) {
  const canDelete = useCanEdit() && deletable
  const tripId = useTripId()
  const [deleting, setDeleting] = useState<FileMeta | null>(null)
  const remove = useDeleteFile(deletable)

  if (files.length === 0) return null

  return (
    <>
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.id}>
            <div className="flex items-center gap-1 rounded-2xl border border-line bg-white pr-2">
              <Link
                to={`/trips/${tripId}/files/${file.id}`}
                className="flex min-h-11 flex-1 items-center gap-3 px-4 py-3 text-left active:scale-[0.99]"
              >
                <span className="text-lg" aria-hidden>
                  {icon(file.mime_type)}
                </span>
                <span className="flex-1 text-sm font-semibold">{file.display_name}</span>
                <span className="text-xs text-muted">{size(file.size_bytes)}</span>
              </Link>
              {canDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${file.display_name}`}
                  onClick={() => setDeleting(file)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted active:scale-90"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete "${deleting.display_name}"?` : ''}
        message="This removes the file and its stored copy. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
