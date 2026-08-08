import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSearch } from '../api/hooks'
import { CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { useTripId } from '../lib/trip'

const typeIcon: Record<string, string> = { zone: '📍', tip: '💡' }

function resultIcon(type: string, subtitle: string) {
  if (type === 'place') return CATEGORY_META[subtitle as keyof typeof CATEGORY_META]?.icon ?? '📌'
  return typeIcon[type] ?? '📌'
}

export default function Search() {
  const tripId = useTripId()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  // debounce so we don't fire a request on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 250)
    return () => clearTimeout(t)
  }, [input])

  const { data, isFetching } = useSearch(query)
  const results = data?.results ?? []
  const ready = query.trim().length >= 2
  const label = useMemo(
    () => (subtitle: string, type: string) =>
      type === 'place'
        ? (CATEGORY_META[subtitle as keyof typeof CATEGORY_META]?.singular ?? 'Place')
        : subtitle,
    []
  )

  return (
    <div>
      <p className="section-title text-brand">Search</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold">Find anything</h1>

      <input
        className="field mt-4"
        type="search"
        inputMode="search"
        autoFocus
        placeholder="Places, zones, tips…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        aria-label="Search"
      />

      <div className="mt-5">
        {!ready ? (
          <p className="text-sm text-muted">Type at least 2 characters to search.</p>
        ) : isFetching && results.length === 0 ? (
          <p className="text-sm text-muted">Searching…</p>
        ) : results.length === 0 ? (
          <EmptyState message={`No matches for “${query}”.`} />
        ) : (
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <Link
                  to={`/trips/${tripId}${r.href}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 active:scale-[0.99]"
                >
                  <span className="text-lg" aria-hidden>
                    {resultIcon(r.type, r.subtitle)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="text-xs capitalize text-muted">
                      {label(r.subtitle, r.type)}
                    </span>
                  </span>
                  <span className="text-muted" aria-hidden>
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
