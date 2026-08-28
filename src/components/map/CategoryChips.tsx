// The filter row inside the sheet.
//
// `All` is a solid dark pill when active; every other chip wears its category's
// tint from `CATEGORY_META.color`. Horizontally scrollable, because five chips
// do not fit across 320px and a wrapped second row would push the card row off
// the peeking sheet.
//
// **Only the categories actually present are offered** (FR-010). For a member
// whose view withholds stays that means no hotel chip — which is courtesy
// rather than control: the hotels were never sent to their device at all
// (FR-016, enforced in `listZonePlaces`).
//
// The filtering itself is client-side over the list already fetched, so
// switching a chip costs no request.
import { CATEGORY_META, type Category } from '../../api/types'

export function CategoryChips({
  present,
  active,
  onToggle,
  onAll,
}: {
  present: Category[]
  /** Null means every category — the `All` state, not a full selection. */
  active: Set<Category> | null
  onToggle: (category: Category) => void
  onAll: () => void
}) {
  if (present.length < 2) return null
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
      <button
        type="button"
        onClick={onAll}
        aria-pressed={active === null}
        className={`chip shrink-0 px-4 py-2 ${
          active === null ? 'bg-ink text-white' : 'bg-canvas text-muted'
        }`}
      >
        All
      </button>
      {present.map((c) => {
        const on = active === null || active.has(c)
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            aria-pressed={on}
            className={`chip shrink-0 px-4 py-2 ${on ? CATEGORY_META[c].color : 'bg-canvas text-muted'}`}
          >
            {CATEGORY_META[c].label}
          </button>
        )
      })}
    </div>
  )
}
