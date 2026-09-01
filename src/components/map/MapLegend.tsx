// The small white card floating over the map's right side.
//
// One swatch and label per category **actually present in the current view**
// — a legend for a category with no pin on screen explains nothing, and for a
// member whose view withholds stays it would name something they were never
// sent (FR-017). The swatch carries `CATEGORY_META.icon` inside
// `CATEGORY_META.dot`'s circle — the same pairing the map's own pins and the
// card row below draw, so the legend key matches what is actually on screen
// rather than a colour a traveller has to match by eye.
import { CATEGORY_META, type Category } from '../../api/types'

export function MapLegend({ categories }: { categories: Category[] }) {
  if (!categories.length) return null
  return (
    <div className="pointer-events-none absolute right-3 top-20 z-[500] rounded-2xl bg-white/95 px-3 py-2 shadow-card backdrop-blur">
      <ul className="space-y-1">
        {categories.map((c) => (
          <li key={c} className="flex items-center gap-2 text-xs font-semibold text-ink">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none ${CATEGORY_META[c].dot}`}
              aria-hidden="true"
            >
              {CATEGORY_META[c].icon}
            </span>
            {CATEGORY_META[c].label}
          </li>
        ))}
      </ul>
    </div>
  )
}
