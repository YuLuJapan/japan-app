// How many saved places the map cannot show — stated, and led somewhere.
//
// **Directly under the chip row, always visible in the sheet's peeking state.**
// The obvious home for this in 2a was a last card in the horizontal row, and
// that would not satisfy FR-019: a count you have to scroll sideways to find is
// not "stated on the map" (research R11). It is the one element the render has
// no slot for, and giving it a scrolling position would quietly break the
// requirement it exists to serve.
//
// Two audiences, one honest answer. A member who can edit gets the list, and
// each row leads to that place's **existing** edit screen, where the location
// picker from Slice A already lives — there is deliberately no second place to
// set a location (FR-020). A member who cannot edit gets the same count, stated
// and inert, rather than a hidden gap or a button that would be refused
// (FR-021).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Activity } from '../../api/types'
import { CATEGORY_META } from '../../api/types'

export function MissingPlaces({
  places,
  tripId,
  canEdit,
}: {
  /** Exactly the places the map could not pin — `missingPlaces` from pins.ts. */
  places: Activity[]
  tripId: string
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)

  // Nothing missing, nothing said (FR-019's fourth scenario). Not an empty
  // line, not a zero — the absence is the message.
  if (!places.length) return null

  const count = `${places.length} ${places.length === 1 ? 'place is' : 'places are'} not on the map`

  if (!canEdit) return <p className="px-4 pt-2 text-sm text-muted">{count}.</p>

  return (
    <div className="px-4 pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-sm font-semibold text-brand underline underline-offset-2"
      >
        {count} — {open ? 'hide' : 'add locations'}
      </button>
      {open && (
        <ul className="mt-2 overflow-hidden rounded-2xl bg-white shadow-card">
          {places.map((place) => (
            <li key={place.id}>
              <Link
                to={`/trips/${tripId}/activities/${place.id}/edit`}
                className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 last:border-0"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{place.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {CATEGORY_META[place.category ?? 'other'].singular}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
