// Add/edit a shopping-list item. Same failure contract as PlaceForm (FR-019):
// on a failed save the entered text stays put and a retry is offered.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useShoppingList, useTrip } from '../api/hooks'
import { useCreateShoppingItem, useUpdateShoppingItem } from '../api/mutations'
import type { ShoppingCategory, ShoppingItemInput } from '../api/types'
import { SHOPPING_CATEGORIES, SHOPPING_CATEGORY_META } from '../api/types'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'

export default function ShoppingForm() {
  const { itemId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editing = Boolean(itemId)

  const list = useShoppingList()
  const trip = useTrip()
  const create = useCreateShoppingItem()
  const update = useUpdateShoppingItem()
  const mutation = editing ? update : create

  const [name, setName] = useState('')
  // adding from a category page starts you in that category
  const [category, setCategory] = useState<ShoppingCategory>(
    (params.get('category') as ShoppingCategory) || 'clothes'
  )
  const [note, setNote] = useState('')
  const [shop, setShop] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [url, setUrl] = useState('')
  const [bought, setBought] = useState(false)

  const existing = editing ? list.data?.items.find((i) => i.id === itemId) : undefined

  // prefill once when editing
  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setCategory(existing.category)
      setNote(existing.note ?? '')
      setShop(existing.shop ?? '')
      setZoneId(existing.zone_id ?? '')
      setPrice(existing.price_yen == null ? '' : String(existing.price_yen))
      setImageUrl(existing.image_url ?? '')
      setUrl(existing.url ?? '')
      setBought(existing.bought)
    }
  }, [Boolean(existing)])

  if (editing && list.isPending) return <Loading />

  // cities on the itinerary, so an item can be tied to where its shop is
  const zones = (trip.data?.steps ?? [])
    .map((s) => s.zone)
    .filter((z): z is NonNullable<typeof z> => Boolean(z))
    .filter((z, i, all) => all.findIndex((o) => o.id === z.id) === i)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsedPrice = Number(price.replace(/[^0-9.]/g, ''))
    const input: ShoppingItemInput = {
      name: name.trim(),
      category,
      note: note.trim() || null,
      shop: shop.trim() || null,
      zone_id: zoneId || null,
      price_yen: price.trim() === '' || Number.isNaN(parsedPrice) ? null : Math.round(parsedPrice),
      image_url: imageUrl.trim() || null,
      url: url.trim() || null,
      bought,
    }
    // land on the item's page either way, so you see what you just saved
    if (editing && itemId)
      update.mutate(
        { id: itemId, patch: input },
        { onSuccess: () => navigate(`/shopping/${itemId}`, { replace: true }) }
      )
    else
      create.mutate(input, {
        onSuccess: (data) => navigate(`/shopping/${data.item.id}`, { replace: true }),
      })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Link
        to={editing ? `/shopping/${itemId}` : '/shopping'}
        className="text-sm font-semibold text-muted"
      >
        ‹ {editing ? 'Item' : 'Shopping'}
      </Link>
      <h1 className="font-display text-2xl font-extrabold">
        {editing ? 'Edit item' : 'Add something to buy'}
      </h1>

      <div>
        <label className="label" htmlFor="name">
          What is it? *
        </label>
        <input
          id="name"
          className="field"
          placeholder="Onitsuka Tiger Mexico 66"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          className="field"
          value={category}
          onChange={(e) => setCategory(e.target.value as ShoppingCategory)}
        >
          {SHOPPING_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SHOPPING_CATEGORY_META[c].icon} {SHOPPING_CATEGORY_META[c].label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="note">
          Details
        </label>
        <textarea
          id="note"
          className="field min-h-24"
          placeholder="Size, colour, model — anything that helps pick the right one"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="shop">
          Where to buy it
        </label>
        <input
          id="shop"
          className="field"
          placeholder="Uniqlo Ginza / Don Quijote / any drugstore"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="zone">
          City
        </label>
        <select
          id="zone"
          className="field"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
        >
          <option value="">Anywhere</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="price">
          Expected price (yen)
        </label>
        <input
          id="price"
          className="field"
          inputMode="numeric"
          placeholder="12000"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="image-url">
          Photo URL
        </label>
        <input
          id="image-url"
          className="field"
          inputMode="url"
          placeholder="https://… (paste any image link)"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        {imageUrl.trim() !== '' && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-line">
            <ZoneImage
              src={imageUrl.trim()}
              alt="Preview"
              icon={SHOPPING_CATEGORY_META[category].icon}
              className="h-40 w-full"
            />
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="url">
          Product link
        </label>
        <input
          id="url"
          className="field"
          inputMode="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <button
        type="button"
        onClick={() => setBought((b) => !b)}
        aria-pressed={bought}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-left active:scale-[0.99]"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold text-white ${
            bought ? 'border-brand bg-brand' : 'border-line'
          }`}
          aria-hidden
        >
          {bought ? '✓' : ''}
        </span>
        <span className="text-sm font-semibold">Already bought</span>
      </button>

      {mutation.isError && (
        <div className="rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3">
          <p className="text-sm text-ink">
            Save failed — your text is safe. Check the connection and retry.
          </p>
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
        {mutation.isPending
          ? 'Saving…'
          : mutation.isError
            ? 'Retry save'
            : editing
              ? 'Save changes'
              : 'Add to list'}
      </button>

    </form>
  )
}
