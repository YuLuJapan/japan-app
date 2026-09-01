// The small white card floating over the map's right side.
//
// One glyph and label per category **actually present in the current view** —
// a legend for a category with no pin on screen explains nothing, and for a
// member whose view withholds stays it would name something they were never
// sent (FR-017). The glyph is `CATEGORY_META.icon` — the same emoji every
// category-picking surface in the app already uses (the place form's category
// select, `CategoryChips`) — rather than `CATEGORY_META.dot`'s colour swatch:
// four small colour dots read as one blur at a glance, where four shapes
// don't.
import { CATEGORY_META, type Category } from '../../api/types'

export function MapLegend({ categories }: { categories: Category[] }) {
  if (!categories.length) return null
  return (
    <div className="pointer-events-none absolute right-3 top-20 z-[500] rounded-2xl bg-white/95 px-3 py-2 shadow-card backdrop-blur">
      <ul className="space-y-1">
        {categories.map((c) => (
          <li key={c} className="flex items-center gap-2 text-xs font-semibold text-ink">
            <span className="shrink-0" aria-hidden="true">
              {CATEGORY_META[c].icon}
            </span>
            {CATEGORY_META[c].label}
          </li>
        ))}
      </ul>
    </div>
  )
}
