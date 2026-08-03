// Every item in one shopping category, in one place — the "See all" target from
// the Shopping home. Unbought first (the working list), bought collected below.
import { Link, useParams } from 'react-router-dom'
import { useRates, useShoppingList } from '../api/hooks'
import type { ShoppingCategory as Category, ShoppingItem } from '../api/types'
import { SHOPPING_CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ShoppingRow, priceLabel } from '../components/ShoppingCards'
import { useShoppingActions } from '../lib/shopping'

export default function ShoppingCategoryPage() {
  const { category = '' } = useParams()
  const cat = category as Category
  const meta = SHOPPING_CATEGORY_META[cat] ?? { label: category, icon: '🛍️' }
  const { data, isPending, isError, refetch } = useShoppingList()
  const { data: rates } = useRates()
  const { update, zoneName, toggleBought, isToggling } = useShoppingActions()

  if (isPending) return <Loading />
  if (isError)
    return <ErrorState message="Could not load the shopping list." onRetry={() => refetch()} />

  const items = data.items.filter((i) => i.category === cat)
  const toBuy = items.filter((i) => !i.bought)
  const bought = items.filter((i) => i.bought)
  const budget = toBuy.reduce((sum, i) => sum + (i.price_yen ?? 0), 0)

  const row = (item: ShoppingItem) => (
    <ShoppingRow
      key={item.id}
      item={item}
      zoneName={zoneName(item.zone_id)}
      rates={rates}
      busy={isToggling(item.id)}
      onToggle={() => toggleBought(item)}
    />
  )

  return (
    <div className="space-y-5">
      <Link to="/shopping" className="text-sm font-semibold text-muted">
        ‹ Shopping
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">
            <span className="mr-2">{meta.icon}</span>
            {meta.label}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 0 ? 'Nothing here yet.' : `${bought.length}/${items.length} bought`}
            {budget > 0 && ` · ${priceLabel(budget, rates)} to go`}
          </p>
        </div>
        <Link to={`/shopping/new?category=${cat}`} className="btn-primary shrink-0 px-4">
          + Add
        </Link>
      </div>

      {update.isError && (
        <ErrorState message="Could not save that change." onRetry={() => update.reset()} />
      )}

      {items.length === 0 ? (
        <EmptyState message={`Nothing under ${meta.label.toLowerCase()} yet.`} />
      ) : (
        <>
          {toBuy.length > 0 && (
            <section>
              <h2 className="section-title mb-2">To buy · {toBuy.length}</h2>
              <ul className="space-y-3">{toBuy.map(row)}</ul>
            </section>
          )}
          {bought.length > 0 && (
            <section>
              <h2 className="section-title mb-2">Bought · {bought.length}</h2>
              <ul className="space-y-3">{bought.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
