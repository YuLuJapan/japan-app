// Shopping home: one section per category, each a swipeable carousel of items.
// "See all" opens the category's own page; tapping an item opens its detail.
import { Link } from 'react-router-dom'
import { useRates, useShoppingList } from '../api/hooks'
import type { ShoppingCategory, ShoppingItem } from '../api/types'
import { SHOPPING_CATEGORIES, SHOPPING_CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ShoppingTile, priceLabel } from '../components/ShoppingCards'
import { useShoppingActions } from '../lib/shopping'
import { useCanEdit } from '../lib/session'

export default function ShoppingList() {
  const canEdit = useCanEdit()
  const { data, isPending, isError, refetch } = useShoppingList()
  const { data: rates } = useRates()
  const { update, toggleBought, isToggling } = useShoppingActions()

  if (isPending) return <Loading />
  if (isError)
    return <ErrorState message="Could not load the shopping list." onRetry={() => refetch()} />

  const items = data.items
  const budget = items.filter((i) => !i.bought).reduce((sum, i) => sum + (i.price_yen ?? 0), 0)

  // only sections that actually hold something, in the canonical category order
  const sections = SHOPPING_CATEGORIES.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((s) => s.items.length > 0)

  const tile = (item: ShoppingItem) => (
    <ShoppingTile
      key={item.id}
      item={item}
      rates={rates}
      busy={isToggling(item.id)}
      onToggle={() => toggleBought(item)}
    />
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-title text-brand">Shopping</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold">Things to buy</h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 0
              ? 'Nothing on the list yet.'
              : `${items.filter((i) => i.bought).length}/${items.length} bought`}
            {budget > 0 && ` · still to spend ${priceLabel(budget, rates)}`}
          </p>
        </div>
        {canEdit && (
          <Link to="/shopping/new" className="btn-primary shrink-0 px-4">
            + Add
          </Link>
        )}
      </div>

      {update.isError && (
        <ErrorState message="Could not save that change." onRetry={() => update.reset()} />
      )}

      {items.length === 0 ? (
        <EmptyState
          message={
            canEdit
              ? 'Add the shoes, the Uniqlo must-haves, the hair products — everything you want to bring home.'
              : 'Nothing on the list yet.'
          }
        />
      ) : (
        sections.map(({ category, items: inCategory }) => (
          <CategorySection
            key={category}
            category={category}
            count={inCategory.length}
            left={inCategory.filter((i) => !i.bought).length}
          >
            {inCategory.map(tile)}
          </CategorySection>
        ))
      )}
    </div>
  )
}

function CategorySection({
  category,
  count,
  left,
  children,
}: {
  category: ShoppingCategory
  count: number
  left: number
  children: React.ReactNode
}) {
  const meta = SHOPPING_CATEGORY_META[category]
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-extrabold">
          {meta.icon} {meta.label}
        </h2>
        <Link to={`/shopping/c/${category}`} className="shrink-0 text-sm font-bold text-brand">
          See all {count} ›
        </Link>
      </div>
      <p className="mb-2 text-xs font-semibold text-muted">
        {left === 0 ? 'All bought 🎉' : `${left} still to buy`}
      </p>
      {/* full-bleed so the carousel runs to the screen edge, like a shelf */}
      <ul className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">{children}</ul>
    </section>
  )
}
