// The horizontally scrolling row under the chips.
//
// Each card is white and rounded with a small `CATEGORY_META.dot` circle
// carrying the category's `icon` glyph, the name in bold and a quieter second
// line. The row is **deliberately cut off at the right edge** so it reads as
// scrollable, exactly as the render draws it.
//
// One row serves both scales: at the city scale a card is a place, at the trip
// scale a city (research R6 — the page renders one shape and never asks which
// scale it is on). What differs is what a card carries, and that comes from
// the scope rather than from a branch here.
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { directionsUrl } from '../../lib/maps'
import type { MapCard } from '../../map/scope'

export function PlaceCardRow({
  cards,
  selectedId,
  onSelect,
  tripId,
  zoneName,
}: {
  cards: MapCard[]
  selectedId: string | null
  onSelect: (id: string) => void
  tripId: string
  /** The city a place sits in — what makes a text directions query unambiguous. */
  zoneName: string | null
}) {
  const row = useRef<HTMLDivElement | null>(null)

  // Tapping a pin selects a card that may be off-screen to the right; the row
  // scrolls to it so the two stay in step in both directions.
  useEffect(() => {
    if (!selectedId || !row.current) return
    const card = row.current.querySelector(`[data-card-id="${CSS.escape(selectedId)}"]`)
    // Guarded because scrolling is the nicety here and the selection is the
    // point: jsdom has no `scrollIntoView`, and neither do some older engines.
    card?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [selectedId])

  if (!cards.length) return null

  return (
    // `items-start` is load-bearing, not tidying: a flex row stretches its
    // children to the tallest by default, so expanding one card into its two
    // buttons made **every** card that tall — a row of empty boxes, and a
    // sheet that grew by their height and covered the map. Only the expanded
    // card is tall now.
    //
    // `py-1`, not `pb-1`: `overflow-x-auto` clips vertically as well as
    // horizontally, so the selected card's `ring-2` — which paints *outside*
    // the card's box — lost its top edge against the container. The padding is
    // the room the ring needs; without it the highlight reads as a card cut
    // off rather than as a card picked out.
    <div ref={row} className="no-scrollbar flex items-start gap-3 overflow-x-auto px-4 py-1">
      {cards.map((card) => (
        <div
          key={card.id}
          data-card-id={card.id}
          className={`shrink-0 rounded-2xl bg-white p-3 shadow-card ${
            selectedId === card.id ? 'w-72 ring-2 ring-ink' : 'w-56'
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(card.id)}
            className="block w-full text-left"
          >
            <span className="flex items-center gap-2">
              {card.dot && (
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none ${card.dot}`}
                  aria-hidden="true"
                >
                  {card.icon}
                </span>
              )}
              <span className="truncate font-bold">{card.title}</span>
            </span>
            <span className="mt-0.5 block truncate text-sm text-muted">{card.subtitle}</span>
          </button>
          {selectedId === card.id && card.place && (
            // The expanded state, and **not a second sheet**: 2a already has
            // one, and an overlay would cover it (research R13). One sheet,
            // two states — which is what the card row was already shaped for.
            //
            // Deliberately bare: the name and the "type · city" subtitle are
            // already on screen whether or not the card is expanded, so this
            // adds only the two ways out — never the address or the summary,
            // which read as more detail than a map card is for.
            <div className="mt-2 border-t border-line pt-2">
              <div className="flex gap-2">
                <Link
                  to={`/trips/${tripId}/activities/${card.id}`}
                  className="btn-ghost min-h-10 flex-1 px-3 text-xs"
                >
                  Open place
                </Link>
                <a
                  href={directionsUrl(card.title, card.place.address, zoneName, card.place)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary min-h-10 flex-1 px-3 text-xs"
                >
                  Directions
                </a>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
