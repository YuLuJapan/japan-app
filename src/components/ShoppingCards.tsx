// The two shapes a shopping item takes on screen: a tile (horizontal carousel
// on the Shopping home) and a row (vertical lists on a category page). Both tap
// through to the item's detail page; the tick button is a direct action.
import { Link } from 'react-router-dom'
import type { Rates, ShoppingItem } from '../api/types'
import { SHOPPING_CATEGORY_META } from '../api/types'
import { ZoneImage } from './ZoneImage'

const yen = new Intl.NumberFormat('en-US')
const ilsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' })

/** "¥1,500 ≈ ₪36" — the conversion appears once today's rate has loaded. */
export function priceLabel(priceYen: number, rates?: Rates): string {
  const base = `¥${yen.format(priceYen)}`
  return rates ? `${base} ≈ ${ilsFmt.format(priceYen * rates.ils)}` : base
}

export function categoryIcon(item: ShoppingItem): string {
  return (SHOPPING_CATEGORY_META[item.category] ?? SHOPPING_CATEGORY_META.other).icon
}

interface CardProps {
  item: ShoppingItem
  zoneName?: string
  rates?: Rates
  onToggle: () => void
  busy: boolean
}

function TickButton({
  item,
  onToggle,
  busy,
  className,
}: Pick<CardProps, 'item' | 'onToggle' | 'busy'> & { className: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={item.bought}
      aria-label={item.bought ? `Mark ${item.name} as not bought` : `Mark ${item.name} as bought`}
      className={className}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold text-white ${
          item.bought ? 'border-brand bg-brand' : 'border-line bg-white'
        }`}
        aria-hidden
      >
        {item.bought ? '✓' : ''}
      </span>
    </button>
  )
}

/** Carousel tile: photo on top, name + price under it (yen only — it's a shelf). */
export function ShoppingTile({ item, onToggle, busy }: CardProps) {
  return (
    <li className={`relative w-36 shrink-0 ${item.bought ? 'opacity-60' : ''}`}>
      <Link to={`/shopping/${item.id}`} className="card block overflow-hidden active:scale-[0.98]">
        <ZoneImage
          src={item.image_url}
          alt={item.name}
          icon={categoryIcon(item)}
          className="h-28 w-full"
        />
        <div className="px-2.5 pb-2.5 pt-2">
          <p
            className={`line-clamp-2 text-sm font-bold leading-snug ${
              item.bought ? 'line-through' : ''
            }`}
          >
            {item.name}
          </p>
          {item.price_yen != null && (
            <p className="mt-1 font-display text-sm font-extrabold text-brand">
              ¥{yen.format(item.price_yen)}
            </p>
          )}
        </div>
      </Link>
      <TickButton
        item={item}
        onToggle={onToggle}
        busy={busy}
        className="absolute right-1.5 top-1.5 rounded-full shadow-card active:scale-95"
      />
    </li>
  )
}

/** List row: photo left, details right, tick on the far right. */
export function ShoppingRow({ item, zoneName, rates, onToggle, busy }: CardProps) {
  const where = [item.shop, zoneName].filter(Boolean).join(' · ')

  return (
    <li
      className={`card flex items-stretch gap-3 overflow-hidden ${item.bought ? 'opacity-60' : ''}`}
    >
      <Link to={`/shopping/${item.id}`} className="flex min-w-0 flex-1 items-stretch gap-3">
        <ZoneImage
          src={item.image_url}
          alt={item.name}
          icon={categoryIcon(item)}
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
      <TickButton
        item={item}
        onToggle={onToggle}
        busy={busy}
        className="flex w-14 shrink-0 items-center justify-center border-l border-line active:scale-95"
      />
    </li>
  )
}
