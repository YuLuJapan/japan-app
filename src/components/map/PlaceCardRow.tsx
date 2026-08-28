// The horizontally scrolling row under the chips.
//
// Each card is white and rounded with a `CATEGORY_META.dot` dot, the name in
// bold and a quieter second line. The row is **deliberately cut off at the
// right edge** so it reads as scrollable, exactly as the render draws it.
//
// One row serves both scales: at the city scale a card is a place, at the trip
// scale a city (research R6 — the page renders one shape and never asks which
// scale it is on). What differs is what a card carries, and that comes from
// the scope rather than from a branch here.
import { useEffect, useRef } from 'react'
import type { MapCard } from '../../map/scope'

export function PlaceCardRow({
  cards,
  selectedId,
  onSelect,
}: {
  cards: MapCard[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const row = useRef<HTMLDivElement | null>(null)

  // Tapping a pin selects a card that may be off-screen to the right; the row
  // scrolls to it so the two stay in step in both directions.
  useEffect(() => {
    if (!selectedId || !row.current) return
    const card = row.current.querySelector(`[data-card-id="${CSS.escape(selectedId)}"]`)
    card?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [selectedId])

  if (!cards.length) return null

  return (
    <div ref={row} className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          data-card-id={card.id}
          onClick={() => onSelect(card.id)}
          className={`w-56 shrink-0 rounded-2xl bg-white p-3 text-left shadow-card transition-shadow ${
            selectedId === card.id ? 'ring-2 ring-ink' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            {card.dot && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${card.dot}`} />}
            <span className="truncate font-bold">{card.title}</span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted">{card.subtitle}</span>
        </button>
      ))}
    </div>
  )
}
