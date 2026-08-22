// Every item in one shopping category, in one place — the "See all" target from
// the Shopping home. Unbought first (the working list), bought collected below.
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useRates, useShoppingList } from '../api/hooks'
import { useDeleteShoppingItem } from '../api/mutations'
import type { ShoppingCategory as Category, ShoppingItem } from '../api/types'
import { SHOPPING_CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ShoppingRow, priceLabel } from '../components/ShoppingCards'
import { SwipeRow } from '../components/SwipeRow'
import { useShoppingActions } from '../lib/shopping'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

export default function ShoppingCategoryPage() {
  const { category = '' } = useParams()
  const canEdit = useCanEdit()
  const tripId = useTripId()
  const [pendingDelete, setPendingDelete] = useState<ShoppingItem | null>(null)
  const remove = useDeleteShoppingItem()
  const cat = category as Category
  const meta = SHOPPING_CATEGORY_META[cat] ?? { label: category, icon: '🛍️' }
  const { data, isPending, isError, refetch } = useShoppingList(tripId)
  const { data: rates } = useRates()
  const { update, zoneName, toggleBought, isToggling } = useShoppingActions()

  if (isPending) return <Loading />
  if (isError)
    return <ErrorState message="Could not load the shopping list." onRetry={() => refetch()} />

  const items = data.items.filter((i) => i.category === cat)
  const toBuy = items.filter((i) => !i.bought)
  const bought = items.filter((i) => i.bought)
  const budget = toBuy.reduce((sum, i) => sum + (i.price_yen ?? 0), 0)

  // Swipe right ticks an item off (undo is one more swipe); swipe left asks
  // before deleting — the swipe is easy to trigger by accident and a delete
  // can't be undone (FR-017).
  const row = (item: ShoppingItem) => {
    const card = (
      <ShoppingRow
        item={item}
        zoneName={zoneName(item.zone_id)}
        rates={rates}
        busy={isToggling(item.id)}
        onToggle={() => toggleBought(item)}
      />
    )
    return (
      <li key={item.id}>
        {canEdit ? (
          <SwipeRow
            rightLabel={item.bought ? 'Not bought' : 'Bought'}
            leftLabel="Delete"
            onSwipeRight={() => toggleBought(item)}
            onSwipeLeft={() => setPendingDelete(item)}
          >
            {card}
          </SwipeRow>
        ) : (
          card
        )}
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <Link to={`/trips/${tripId}/shopping`} className="text-sm font-semibold text-muted">
        ‹ Shopping
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">
            <span className="mr-2">{meta.icon}</span>
            {meta.label}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 0 ? 'Nothing here yet.' : `${bought.length}/${items.length} bought`}
            {budget > 0 && ` · ${priceLabel(budget, rates)} to go`}
          </p>
        </div>
        {canEdit && (
          <Link
            to={`/trips/${tripId}/shopping/new?category=${cat}`}
            className="btn-primary shrink-0 px-4"
          >
            + Add
          </Link>
        )}
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

      {canEdit && items.length > 0 && (
        <p className="text-center text-xs text-muted">
          Swipe a row right to tick it off, left to delete it.
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete this item?'}
        message="It will be removed from the shopping list."
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
          setPendingDelete(null)
        }}
      />
    </div>
  )
}
