// "Find a photo": searches the web (Wikimedia, via /api/images) for a picture
// of whatever you're adding, and fills the photo field with the one you tap.
// Only runs when asked — no lookups just from opening a form.
import { useState } from 'react'
import { useImageSearch } from '../api/hooks'

interface Props {
  /** What to search for — usually the item's name (plus shop). */
  query: string
  onPick: (url: string) => void
}

export function ImagePicker({ query, onPick }: Props) {
  const [searching, setSearching] = useState(false)
  const { data, isFetching, isError, refetch } = useImageSearch(query, searching)
  const canSearch = query.trim().length >= 2

  if (!searching) {
    return (
      <button
        type="button"
        className="btn-ghost mt-2 w-full"
        disabled={!canSearch}
        onClick={() => setSearching(true)}
      >
        {canSearch ? '🔍 Find a photo on the web' : 'Type a name first to find a photo'}
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-2xl border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Photos for “{query}”</p>
        <button
          type="button"
          className="text-sm font-bold text-brand"
          onClick={() => setSearching(false)}
        >
          Close
        </button>
      </div>

      {isFetching && <p className="mt-3 text-sm text-muted">Searching…</p>}

      {isError && (
        <div className="mt-3 text-sm text-muted">
          Photo search is unavailable right now.{' '}
          <button type="button" className="font-bold text-brand" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {!isFetching && !isError && data && data.results.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          Nothing found for this one — paste a photo link above instead.
        </p>
      )}

      {!isFetching && data && data.results.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {data.results.map((r) => (
            <li key={r.url}>
              <button
                type="button"
                onClick={() => {
                  onPick(r.url)
                  setSearching(false)
                }}
                className="w-full overflow-hidden rounded-xl border border-line active:scale-95"
                title={[r.title, r.credit].filter(Boolean).join(' — ')}
              >
                <img
                  src={r.thumb_url}
                  alt={r.title}
                  loading="lazy"
                  className="h-20 w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && data.results.length > 0 && (
        <p className="mt-2 text-[11px] text-muted">Photos from Wikipedia / Wikimedia Commons.</p>
      )}
    </div>
  )
}
