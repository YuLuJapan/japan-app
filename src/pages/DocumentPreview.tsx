// In-app preview for an attached document (FR-008): boarding passes, receipts
// and entrance tickets open here instead of being handed to the browser's
// downloader. The bytes are fetched with the access code and turned into an
// object URL, so both datastore backends (data URLs / signed URLs) behave the
// same. Download and full-screen stay available for anything the browser
// cannot render inline (and for saving to the phone's wallet/files).
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { useTripFiles } from '../api/hooks'
import type { TripDocument } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
}

const size = (bytes: number) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const fileName = (doc: TripDocument) => {
  const ext = EXT_BY_MIME[doc.mime_type] ?? 'bin'
  return doc.display_name.toLowerCase().endsWith(`.${ext}`)
    ? doc.display_name
    : `${doc.display_name}.${ext}`
}

const parentHref = (doc: TripDocument) =>
  doc.attached_to.kind === 'place'
    ? `/places/${doc.attached_to.id}`
    : doc.attached_to.kind === 'zone'
      ? `/zones/${doc.attached_to.id}`
      : null

type ContentState =
  { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string }

/** Fetch the blob once and expose it as an object URL, revoked on unmount. */
function useFileContent(fileId: string): ContentState {
  const [state, setState] = useState<ContentState>({ status: 'loading' })

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setState({ status: 'loading' })

    api
      .blob(`/files/${fileId}/content`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ status: 'ready', url: objectUrl })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message:
            err instanceof ApiError && err.code === 'FILE_MISSING'
              ? 'This file is missing from storage, so there is nothing to preview.'
              : 'Could not load this document — check your connection and try again.',
        })
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId])

  return state
}

function Viewer({ doc, url }: { doc: TripDocument; url: string }) {
  const [zoomed, setZoomed] = useState(false)

  if (doc.mime_type.startsWith('image/')) {
    return (
      <div className={`overflow-auto rounded-3xl bg-white shadow-card ${zoomed ? '' : 'p-2'}`}>
        <img
          src={url}
          alt={doc.display_name}
          onClick={() => setZoomed((z) => !z)}
          className={
            zoomed
              ? 'max-w-none cursor-zoom-out'
              : 'mx-auto max-h-[70vh] w-full cursor-zoom-in rounded-2xl object-contain'
          }
          style={zoomed ? { width: '200%' } : undefined}
        />
      </div>
    )
  }

  if (doc.mime_type === 'application/pdf') {
    return (
      <iframe
        src={url}
        title={doc.display_name}
        className="h-[70vh] w-full rounded-3xl border border-line bg-white shadow-card"
      />
    )
  }

  return (
    <div className="rounded-3xl bg-white p-6 text-center shadow-card">
      <p className="text-sm text-muted">
        This file type can’t be shown here. Open it full screen or download it below.
      </p>
    </div>
  )
}

export default function DocumentPreview() {
  const { fileId = '' } = useParams()
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useTripFiles()
  const content = useFileContent(fileId)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load documents." onRetry={() => refetch()} />

  const doc = data.files.find((f) => f.id === fileId)
  if (!doc) return <ErrorState message="This document no longer exists." />

  const href = parentHref(doc)

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-sm font-semibold text-muted"
      >
        ‹ Back
      </button>

      <h1 className="mt-2 font-display text-xl font-extrabold">{doc.display_name}</h1>
      <p className="mt-1 text-xs text-muted">
        {size(doc.size_bytes)}
        {doc.attached_to.kind !== 'trip' && (
          <>
            {' · '}
            {href ? (
              <Link to={href} className="text-brand">
                {doc.attached_to.name}
              </Link>
            ) : (
              doc.attached_to.name
            )}
          </>
        )}
      </p>

      <div className="mt-4">
        {content.status === 'loading' && <Loading />}
        {content.status === 'error' && <p className="text-sm text-brand">{content.message}</p>}
        {content.status === 'ready' && <Viewer doc={doc} url={content.url} />}
      </div>

      {content.status === 'ready' && (
        <div className="mt-4 flex gap-2">
          <a
            href={content.url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost flex-1"
          >
            Open full screen
          </a>
          <a href={content.url} download={fileName(doc)} className="btn-primary flex-1">
            Download
          </a>
        </div>
      )}
    </div>
  )
}
