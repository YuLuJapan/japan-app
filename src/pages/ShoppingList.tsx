// Shopping list: the things we want to buy in Japan. Each item shows its photo,
// where to buy it and what it should cost (yen, with a live ≈ conversion from
// /api/rates), and can be ticked off as bought. Bought items sink to the bottom.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRates, useShoppingList, useTrip } from '../api/hooks'
import { useUpdateShoppingItem } from '../api/mutations'
import type { Rates, ShoppingCategory, ShoppingItem } from '../api/types'
import { SHOPPING_CATEGORIES, SHOPPING_CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'

const yen = new Intl.NumberFormat('en-US')
const ilsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' })

/** "¥1,500 ≈ ₪36" — the second half only once today's rate has loaded. */
function priceLabel(priceYen: number, rates?: Rates): string {
  const base = `¥${yen.format(priceYen)}`
  return rates ? `${base} ≈ ${ilsFmt.format(priceYen * rates.ils)}` : base
}

function ItemCard({
  item,
  zoneName,
  rates,
  onToggle,
  busy,
}: {
  item: ShoppingItem
  zoneName?: string
  rates?: Rates
  onToggle: () => void
  busy: boolean
}) {
  const meta = SHOPPING_CATEGORY_META[item.category] ?? SHOPPING_CATEGORY_META.other
  const where = [item.shop, zoneName].filter(Boolean).join(' · ')

  return (
    <li
      className={`card flex items-stretch gap-3 overflow-hidden ${item.bought ? 'opacity-60' : ''}`}
    >
      <Link to={`/shopping/${item.id}/edit`} className="flex min-w-0 flex-1 items-stretch gap-3">
        <ZoneImage
          src={item.image_url}
          alt={item.name}
          icon={meta.icon}
          className="h-24 w-24 shrink-0"
        />
        <div className="min-w-0 flex-1 py-3">
          <p className={`line-clamp-2 font-bold leading-snug ${item.bought ? 'line-through' : ''}`}>
            {item.name}
          </p>
          {item.note && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{item.note}</p>}
          {where && <p className="mt-1 truncate text-xs font-semibold text-muted">📍 {where}</p>}
          {item.price_yen != null && (
            <p className="mt-1 font-display text-sm font-extrabold text-brand">
              {priceLabel(item.price_yen, rates)}
            </p>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={item.bought}
        aria-label={item.bought ? `Mark ${item.name} as not bought` : `Mark ${item.name} as bought`}
        className="flex w-14 shrink-0 items-center justify-center border-l border-line active:scale-95"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold text-white ${
            item.bought ? 'border-brand bg-brand' : 'border-line'
          }`}
          aria-hidden
        >
          {item.bought ? '✓' : ''}
        </span>
      </button>
    </li>
  )
}

export default function ShoppingList() {
  const { data, isPending, isError, refetch } = useShoppingList()
  const trip = useTrip()
  const { data: rates } = useRates()
  const update = useUpdateShoppingItem()
  const [filter, setFilter] = useState<ShoppingCategory | 'all'>('all')

  if (isPending) return <Loading />
  if (isError)
    return <ErrorState message="Could not load the shopping list." onRetry={() => refetch()} />

  const items = data.items
  const zoneName = (zoneId: string | null) =>
    trip.data?.steps.find((s) => s.zone?.id === zoneId)?.zone?.name

  // only offer filters for categories that actually have something in them
  const usedCategories = SHOPPING_CATEGORIES.filter((c) => items.some((i) => i.category === c))
  const shown = filter === 'all' ? items : items.filter((i) => i.category === filter)
  const toBuy = shown.filter((i) => !i.bought)
  const bought = shown.filter((i) => i.bought)
  const budget = toBuy.reduce((sum, i) => sum + (i.price_yen ?? 0), 0)

  const card = (item: ShoppingItem) => (
    <ItemCard
      key={item.id}
      item={item}
      zoneName={zoneName(item.zone_id)}
      rates={rates}
      busy={update.isPending && update.variables?.id === item.id}
      onToggle={() => update.mutate({ id: item.id, patch: { bought: !item.bought } })}
    />
  )

  return (
    <div className="space-y-5">
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
        <Link to="/shopping/new" className="btn-primary shrink-0 px-4">
          + Add
        </Link>
      </div>

      {update.isError && (
        <ErrorState message="Could not save that change." onRetry={() => update.reset()} />
      )}

      {usedCategories.length > 1 && (
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`chip shrink-0 border ${
              filter === 'all'
                ? 'border-brand bg-brand text-white'
                : 'border-line bg-white text-ink'
            }`}
          >
            All
          </button>
          {usedCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              className={`chip shrink-0 border ${
                filter === c ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink'
              }`}
            >
              {SHOPPING_CATEGORY_META[c].icon} {SHOPPING_CATEGORY_META[c].label}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          message={
            items.length === 0
              ? 'Add the shoes, the Uniqlo must-haves, the hair products — everything you want to bring home.'
              : 'Nothing in this category yet.'
          }
        />
      ) : (
        <>
          {toBuy.length > 0 && (
            <section>
              <h2 className="section-title mb-2">To buy · {toBuy.length}</h2>
              <ul className="space-y-3">{toBuy.map(card)}</ul>
            </section>
          )}
          {bought.length > 0 && (
            <section>
              <h2 className="section-title mb-2">Bought · {bought.length}</h2>
              <ul className="space-y-3">{bought.map(card)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
