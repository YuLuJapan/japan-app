// Type a place, get real candidates, pick one.
//
// This was the journey editor's destination field, inline, and it is now here
// because the place form needs exactly the same interaction (research R7): a
// second copy would have drifted. The extraction is behaviour-preserving —
// `src/tests/journey-editor.test.tsx` passes unchanged over it, which is what
// makes this a refactor rather than a rewrite.
//
// The one rule worth naming: **a candidate is only ever emitted when it is
// picked.** Typing produces a list and nothing else, and changing the text
// withdraws whatever was picked, because a location that describes a different
// name is worse than no location at all (FR-003).
//
// The two callers differ in what they search for and what they lean on — a
// city with no bias, a place name plus its address biased by its zone — and
// that is a prop, not a fork.
import { useEffect, useId, useState } from 'react'
import { geocode } from '../api/hooks'
import type { GeocodeResult } from '../api/types'

/** Long enough that typing a name is one request, short enough to feel live. */
const DEBOUNCE_MS = 450

export function LocationPicker({
  label,
  placeholder,
  initialQuery = '',
  near,
  onPick,
  onQueryChange,
  pickedText = (r) => r.name,
  hint,
}: {
  label: string
  placeholder: string
  /** What the field starts with. Leaving it untouched searches for nothing. */
  initialQuery?: string
  /** Coordinates to lean the search on — the zone the place sits in. */
  near?: { lat: number; lng: number }
  /** A candidate the traveller accepted, or `null` when they took it back. */
  onPick: (result: GeocodeResult | null) => void
  /**
   * What is in the box now, and whether it differs from what it started with.
   *
   * One callback rather than two, because the two callers want different
   * halves of it: the journey editor watches `touched` (an edit that never
   * opens this field keeps the zone it has, and only a changed one has to be
   * re-validated against a real place), and the place form keeps the `query`,
   * because there the box *is* the address it saves.
   */
  onQueryChange?: (query: string, touched: boolean) => void
  /**
   * What lands in the field once a candidate is picked. A city keeps its short
   * name; an address field wants the whole line it just confirmed.
   */
  pickedText?: (result: GeocodeResult) => string
  /** Rendered under the field; the caller says what a pick would mean. */
  hint?: React.ReactNode
}) {
  const [query, setQuery] = useState(initialQuery)
  const [picked, setPicked] = useState<GeocodeResult | null>(null)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const fieldId = useId()

  // Untouched means "keep what this already has": the journey editor's rule,
  // which is why an edit that never opens this field needs no re-validation.
  const touched = query.trim() !== initialQuery.trim()

  useEffect(() => {
    const q = query.trim()
    if (!touched || picked || q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let ignore = false
    setSearching(true)
    const t = setTimeout(() => {
      geocode(q, near)
        .then((r) => !ignore && setResults(r.results))
        .catch(() => !ignore && setResults([]))
        .finally(() => !ignore && setSearching(false))
    }, DEBOUNCE_MS)
    return () => {
      ignore = true
      clearTimeout(t)
    }
    // `near` is a fresh object each render at some call sites; its two numbers
    // are what the search depends on.
  }, [query, touched, picked, near?.lat, near?.lng])

  const pick = (r: GeocodeResult) => {
    const text = pickedText(r)
    setPicked(r)
    setQuery(text)
    setResults([])
    onQueryChange?.(text, text.trim() !== initialQuery.trim())
    onPick(r)
  }

  const retype = (value: string) => {
    setQuery(value)
    onQueryChange?.(value, value.trim() !== initialQuery.trim())
    if (picked) {
      setPicked(null)
      onPick(null)
    }
  }

  return (
    <div>
      <label className="label" htmlFor={`${fieldId}-location`}>
        {label}
      </label>
      <input
        id={`${fieldId}-location`}
        className="field"
        placeholder={placeholder}
        value={query}
        onChange={(e) => retype(e.target.value)}
      />
      {touched && !picked && query.trim().length >= 2 && (
        <div className="mt-1 overflow-hidden rounded-2xl ring-1 ring-line">
          {searching && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
          {!searching && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted">No matches — try a different name.</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng},${i}`}
              type="button"
              onClick={() => pick(r)}
              className="flex w-full flex-col items-start border-b border-line bg-white px-3 py-2 text-left last:border-0 hover:bg-line/40 active:bg-line/60"
            >
              <span className="text-sm font-semibold">{r.name}</span>
              {r.address && <span className="line-clamp-1 text-xs text-muted">{r.address}</span>}
            </button>
          ))}
        </div>
      )}
      {hint}
    </div>
  )
}
