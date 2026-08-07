// Upload a file from the device: pick → (rename) → send as base64 to the API,
// which stores the blob and creates the row. Owner is `parent` (trip/zone/place).
import { useRef, useState } from 'react'
import { useUploadFile } from '../api/mutations'
import type { FileParent } from '../api/types'
import { useCanEdit } from '../lib/session'

const MAX_BYTES = 3 * 1024 * 1024
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic'

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '')

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export function FileUploader({
  parent,
  label = 'Upload file',
}: {
  parent: FileParent
  label?: string
}) {
  const canEdit = useCanEdit()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [localError, setLocalError] = useState('')
  const upload = useUploadFile()

  const pick = (f: File | null) => {
    setLocalError('')
    if (!f) return
    if (f.size > MAX_BYTES) {
      setLocalError('That file is larger than 3 MB. Please pick a smaller file.')
      return
    }
    setFile(f)
    setName(stripExt(f.name))
  }

  const reset = () => {
    setFile(null)
    setName('')
    setLocalError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const submit = async () => {
    if (!file || !name.trim()) return
    try {
      const data_base64 = await readBase64(file)
      upload.mutate(
        { parent, display_name: name.trim(), mime_type: file.type, data_base64 },
        { onSuccess: reset }
      )
    } catch {
      setLocalError('Could not read the file — try again.')
    }
  }

  if (!canEdit) return null

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Choose a file"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />

      {!file ? (
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() => inputRef.current?.click()}
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
            <path d="M12 5v14M5 12h14" />
          </svg>
          {label}
        </button>
      ) : (
        <div className="space-y-2 rounded-2xl border border-line bg-white p-3">
          <p className="truncate text-xs text-muted">{file.name}</p>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Document name"
            aria-label="Document name"
            autoFocus
          />
          {upload.isError && <p className="text-sm text-brand">Upload failed — try again.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={submit}
              disabled={upload.isPending}
            >
              {upload.isPending ? 'Uploading…' : upload.isError ? 'Retry' : 'Upload'}
            </button>
            <button type="button" className="btn-ghost" onClick={reset} disabled={upload.isPending}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {localError && <p className="mt-1 text-sm text-brand">{localError}</p>}
    </div>
  )
}
