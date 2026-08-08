// One shopping item in full: the photo, what it should cost (yen + today's
// shekel/dollar estimate), where to buy it, and the notes. Ticking it off is the
// primary action here; editing and deleting hang off it (mirrors PlaceDetail).
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRates, useShoppingList } from '../api/hooks'
import { useDeleteShoppingItem } from '../api/mutations'
import { SHOPPING_CATEGORY_META } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { ImagePicker } from '../components/ImagePicker'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'
import { placeMapsUrl } from '../lib/maps'
import { useShoppingActions } from '../lib/shopping'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

const yen = new Intl.NumberFormat('en-US')
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const ilsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' })

export default function ShoppingItemDetail() {
  const { itemId = '' } = useParams()
  const canEdit = useCanEdit()
  const tripId = useTripId()
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useShoppingList(tripId)
  const { data: rates } = useRates()
  const { update, zoneName, toggleBought, isToggling } = useShoppingActions()
  const remove = useDeleteShoppingItem()
  const [confirming, setConfirming] = useState(false)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this item." onRetry={() => refetch()} />

  const item = data.items.find((i) => i.id === itemId)
  if (!item) {
    return (
      <div className="space-y-4">
        <Link to={`/trips/${tripId}/shopping`} className="text-sm font-semibold text-muted">
          ‹ Shopping
        </Link>
        <ErrorState message="That item is no longer on the list." />
      </div>
    )
  }

  const meta = SHOPPING_CATEGORY_META[item.category] ?? SHOPPING_CATEGORY_META.other
  const city = zoneName(item.zone_id)

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/trips/${tripId}/shopping/c/${item.category}`}
          className="text-sm font-semibold text-muted"
        >
          ‹ {meta.label}
        </Link>
        <div className="mt-3 overflow-hidden rounded-3xl shadow-card">
          <ZoneImage
            src={item.image_url}
            alt={item.name}
            icon={meta.icon}
            fit="contain"
            className="h-52 w-full"
          />
        </div>
        {/* Items saved before the web lookup existed (or whose search came up
            empty) can get a photo here without a trip through the edit form. */}
        {canEdit && !item.image_url && (
          <ImagePicker
            query={[item.name, item.shop ?? ''].filter(Boolean).join(' ')}
            onPick={(url) => update.mutate({ id: item.id, patch: { image_url: url } })}
          />
        )}
        {/* title gets the full width — the chip sits under it, so long product
            names don't get squeezed into a narrow column */}
        <h1
          className={`mt-3 font-display text-2xl font-extrabold ${item.bought ? 'line-through' : ''}`}
        >
          {item.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="chip bg-canvas text-muted">
            {meta.icon} {meta.label}
          </span>
          {item.bought && <span className="chip bg-brand/10 text-brand">✓ Already bought</span>}
        </div>
      </div>

      {item.price_yen != null && (
        <section className="rounded-3xl border border-brand/20 bg-brand/5 px-4 py-3">
          <h2 className="section-title">Should cost about</h2>
          <p className="mt-0.5 font-display text-2xl font-extrabold">
            ¥{yen.format(item.price_yen)}
          </p>
          {rates && (
            <p className="mt-0.5 text-sm text-muted">
              ≈ {ilsFmt.format(item.price_yen * rates.ils)} ≈{' '}
              {usdFmt.format(item.price_yen * rates.usd)}
            </p>
          )}
        </section>
      )}

      {(item.shop || city) && (
        <section>
          <h2 className="section-title">Where to buy it</h2>
          <p className="mt-1 text-sm font-semibold">
            {item.shop ?? 'Anywhere'}
            {city && <span className="font-normal text-muted"> · {city}</span>}
          </p>
          {item.shop && (
            <a
              href={placeMapsUrl(item.shop, city)}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-ghost mt-2 w-full"
            >
              Find it on the map
            </a>
          )}
        </section>
      )}

      {item.note && (
        <section>
          <h2 className="section-title">Details</h2>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{item.note}</p>
        </section>
      )}

      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="btn-ghost w-full">
          Open product link
        </a>
      )}

      {update.isError && (
        <ErrorState message="Could not save that change." onRetry={() => update.reset()} />
      )}

      {canEdit && (
        <div className="space-y-3">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={isToggling(item.id)}
            onClick={() => toggleBought(item)}
          >
            {isToggling(item.id)
              ? 'Saving…'
              : item.bought
                ? 'Put back on the list'
                : 'Mark as bought'}
          </button>
          <div className="flex gap-3">
            <Link to={`/trips/${tripId}/shopping/${item.id}/edit`} className="btn-ghost flex-1">
              Edit
            </Link>
            <button type="button" className="btn-danger flex-1" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Delete this item?"
        message="It will be removed from the shopping list."
        confirmLabel="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(item.id, {
            onSuccess: () => navigate(`/trips/${tripId}/shopping`, { replace: true }),
          })
        }
      />
    </div>
  )
}
