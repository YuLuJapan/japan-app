// The small white card floating over the map's right side.
//
// One swatch and label per category **actually present in the current view** —
// a legend for a category with no pin on screen explains nothing, and for a
// member whose view withholds stays it would name something they were never
// sent (FR-017). The colours come from `CATEGORY_META.dot`, the same table the
// pins, the chips and the card dots read, so re-landing spec 009's palette
// recolours all four at once.
import { CATEGORY_META, type Category } from '../../api/types'

export function MapLegend({ categories }: { categories: Category[] }) {
  if (!categories.length) return null
  return (
    <div className="pointer-events-none absolute right-3 top-20 z-[500] rounded-2xl bg-white/95 px-3 py-2 shadow-card backdrop-blur">
      <ul className="space-y-1">
        {categories.map((c) => (
          <li key={c} className="flex items-center gap-2 text-xs font-semibold text-ink">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_META[c].dot}`} />
            {CATEGORY_META[c].label}
          </li>
        ))}
      </ul>
    </div>
  )
}
