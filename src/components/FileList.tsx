// Files with recognizable name/type; tap → the preview screen at /files/:id,
// which renders the document in the app rather than downloading it (FR-008).
// Load failures, incl. FILE_MISSING, are explained there (FR-013).
// When `deletable` is set, each file gets a confirmed delete, and — behind the
// `files-rename` flag — an inline rename (the parent is passed for cache
// invalidation, which both writes need).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteFile, useRenameFile } from '../api/mutations'
import type { FileMeta, FileParent } from '../api/types'
import { useBooleanFlag } from '../lib/flags'
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
  const canEdit = useCanEdit() && deletable
  // Off until the flag exists in PostHog and is turned on: everything below is
  // written, deployed and reachable, and simply not offered yet.
  const canRename = useBooleanFlag('files-rename', false) && canEdit
  const tripId = useTripId()
  const [deleting, setDeleting] = useState<FileMeta | null>(null)
  const [renaming, setRenaming] = useState<FileMeta | null>(null)
  const [draft, setDraft] = useState('')
  const remove = useDeleteFile(deletable)
  const rename = useRenameFile(deletable)

  const startRename = (file: FileMeta) => {
    setRenaming(file)
    setDraft(file.display_name)
  }

  const saveRename = () => {
    const display_name = draft.trim()
    // Unchanged or empty is a cancel, not a save: a request that could only
    // either no-op or fail validation is not worth making.
    if (!renaming || !display_name || display_name === renaming.display_name) {
      setRenaming(null)
      return
    }
    rename.mutate({ fileId: renaming.id, display_name }, { onSuccess: () => setRenaming(null) })
  }

  if (files.length === 0) return null

  return (
    <>
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.id}>
            {renaming?.id === file.id ? (
              <div className="space-y-2 rounded-2xl border border-line bg-white px-4 py-3">
                <input
                  className="field"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  aria-label={`Rename ${file.display_name}`}
                  maxLength={120}
                  autoFocus
                />
                <p className="text-xs text-muted">
                  Only the name changes — the file itself, and what it saves as, stay put.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    onClick={saveRename}
                    disabled={rename.isPending}
                  >
                    {rename.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost flex-1"
                    onClick={() => setRenaming(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
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
                {canRename && (
                  <button
                    type="button"
                    aria-label={`Rename ${file.display_name}`}
                    onClick={() => startRename(file)}
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
                      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                )}
                {canEdit && (
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
            )}
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
