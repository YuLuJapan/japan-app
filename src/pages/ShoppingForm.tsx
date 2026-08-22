// Add/edit a shopping-list item. Same failure contract as PlaceForm (FR-019):
// on a failed save the entered text stays put and a retry is offered.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  containsJapanese,
  fetchProductPreview,
  fetchTranslation,
  useShoppingList,
  useTrip,
} from '../api/hooks'
import { useCreateShoppingItem, useUpdateShoppingItem } from '../api/mutations'
import type { ShoppingCategory, ShoppingItemInput } from '../api/types'
import { SHOPPING_CATEGORIES, SHOPPING_CATEGORY_META } from '../api/types'
import { ImagePicker } from '../components/ImagePicker'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'
import { useTripId } from '../lib/trip'

export default function ShoppingForm() {
  const { itemId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const tripId = useTripId()
  const editing = Boolean(itemId)

  const list = useShoppingList(tripId)
  const trip = useTrip(tripId)
  const create = useCreateShoppingItem(tripId)
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
  const [pastedUrl, setPastedUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [translateNote, setTranslateNote] = useState<string | null>(null)

  /** Swap a Japanese name for English, parking the original in the details. */
  async function translateName() {
    const original = name.trim()
    if (!original || translating) return
    setTranslating(true)
    setTranslateNote(null)
    try {
      const result = await fetchTranslation(original)
      if (result.translated) {
        setName(result.translated)
        if (!note.trim()) setNote(`Japanese name: ${original}`)
        setTranslateNote('Translated — the Japanese name is saved in the details.')
      } else {
        setTranslateNote('Could not translate that one — leaving it as it is.')
      }
    } catch {
      setTranslateNote('Translation is unavailable right now.')
    } finally {
      setTranslating(false)
    }
  }

  /**
   * Fill the form from a product page's own metadata. Only ever *adds* — a
   * field you already typed is never overwritten, so re-reading a link can't
   * wipe your edits.
   */
  async function importFromUrl() {
    const link = pastedUrl.trim()
    if (!link || importing) return
    setImporting(true)
    setImportNote(null)
    try {
      const preview = await fetchProductPreview(link)
      const filled: string[] = []
      if (preview.name && !name.trim()) {
        setName(preview.name)
        filled.push('name')
        // keep the Japanese original in the details — it's what you point at
        // in the shop when nobody speaks English
        if (preview.name_ja && !note.trim()) setNote(`Japanese name: ${preview.name_ja}`)
      }
      if (preview.image_url && !imageUrl.trim()) {
        setImageUrl(preview.image_url)
        filled.push('photo')
      }
      if (preview.shop && !shop.trim()) {
        setShop(preview.shop)
        filled.push('shop')
      }
      if (preview.price_yen != null && price.trim() === '') {
        setPrice(String(preview.price_yen))
        filled.push('price')
      }
      if (!url.trim()) setUrl(preview.url)

      setImportNote(
        filled.length > 0
          ? `Filled in the ${filled.join(', ')} — check it over and edit anything.${
              preview.price_note ? ` ${preview.price_note}` : ''
            }`
          : (preview.price_note ??
              'Could not read that page — fill the details in yourself (the link is saved).')
      )
    } catch {
      setImportNote('Could not read that link. Check it, or fill the details in yourself.')
    } finally {
      setImporting(false)
    }
  }

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
        { onSuccess: () => navigate(`/trips/${tripId}/shopping/${itemId}`, { replace: true }) }
      )
    else
      create.mutate(input, {
        onSuccess: (data) =>
          navigate(`/trips/${tripId}/shopping/${data.item.id}`, { replace: true }),
      })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Link
        to={editing ? `/trips/${tripId}/shopping/${itemId}` : `/trips/${tripId}/shopping`}
        className="text-sm font-semibold text-muted"
      >
        ‹ {editing ? 'Item' : 'Shopping'}
      </Link>
      <h1 className="font-display text-2xl font-bold">
        {editing ? 'Edit item' : 'Add something to buy'}
      </h1>

      {!editing && (
        <div className="rounded-2xl border border-line bg-white p-3">
          <label className="label" htmlFor="product-link">
            Have a link? Paste it
          </label>
          <div className="flex gap-2">
            <input
              id="product-link"
              className="field flex-1"
              inputMode="url"
              placeholder="https://… product page"
              value={pastedUrl}
              onChange={(e) => setPastedUrl(e.target.value)}
              onKeyDown={(e) => {
                // Enter inside this field means "read it", not "submit the form"
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void importFromUrl()
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost px-4"
              disabled={importing || pastedUrl.trim() === ''}
              onClick={() => void importFromUrl()}
            >
              {importing ? '…' : 'Read link'}
            </button>
          </div>
          {importNote && <p className="mt-2 text-xs text-muted">{importNote}</p>}
        </div>
      )}

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
        {/* A name in Japanese is unreadable for us — offer to swap it for
            English, keeping the original in the details for the shop. */}
        {containsJapanese(name) && (
          <button
            type="button"
            className="btn-ghost mt-2 w-full"
            disabled={translating}
            onClick={() => void translateName()}
          >
            {translating ? 'Translating…' : '🌐 Translate to English'}
          </button>
        )}
        {translateNote && <p className="mt-1 text-xs text-muted">{translateNote}</p>}
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
        {imageUrl.trim() !== '' ? (
          <div className="mt-2 overflow-hidden rounded-2xl border border-line">
            <ZoneImage
              src={imageUrl.trim()}
              alt="Preview"
              icon={SHOPPING_CATEGORY_META[category].icon}
              fit="contain"
              className="h-40 w-full"
            />
          </div>
        ) : (
          !editing && (
            <p className="mt-1 text-xs text-muted">
              Leave this blank and we’ll look a photo up for you when you save.
            </p>
          )
        )}
        <ImagePicker
          query={[name.trim(), shop.trim()].filter(Boolean).join(' ')}
          onPick={setImageUrl}
        />
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
