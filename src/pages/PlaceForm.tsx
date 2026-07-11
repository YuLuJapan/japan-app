// Add/edit places on the fly (FR-015, SC-008). On save failure the entered
// text is preserved and a retry is offered (FR-019) — form state lives here,
// never cleared on error.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { usePlace } from '../api/hooks'
import { useCreatePlace, useUpdatePlace } from '../api/mutations'
import type { Category, PlaceInput, PlaceLink } from '../api/types'
import { CATEGORIES, CATEGORY_LABELS } from '../api/types'
import { Loading } from '../components/Loading'

export default function PlaceForm() {
  const { zoneId, placeId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editing = Boolean(placeId)

  const existing = usePlace(placeId ?? '')
  const create = useCreatePlace()
  const update = useUpdatePlace(placeId ?? '')
  const mutation = editing ? update : create

  const [name, setName] = useState('')
  const [nameJa, setNameJa] = useState('')
  const [category, setCategory] = useState<Category>((params.get('category') as Category) || 'food')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [links, setLinks] = useState<PlaceLink[]>([])

  // prefill once when editing
  const loaded = editing && existing.data
  useEffect(() => {
    if (loaded) {
      const p = existing.data.place
      setName(p.name)
      setNameJa(p.name_ja ?? '')
      setCategory(p.category)
      setDescription(p.description ?? '')
      setAddress(p.address ?? '')
      setImageUrl(p.image_url ?? '')
      setLinks(p.links)
    }
  }, [Boolean(loaded)])

  if (editing && existing.isPending) return <Loading />

  const targetZone = editing ? existing.data?.place.zone_id : zoneId

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const input: Partial<PlaceInput> = {
      name: name.trim(),
      name_ja: nameJa.trim() || null,
      category,
      description: description.trim() || null,
      address: address.trim() || null,
      image_url: imageUrl.trim() || null,
      links: links.filter((l) => l.label.trim() && l.url.trim()),
    }
    const onSuccess = (data: { place: { id: string } }) =>
      navigate(`/places/${data.place.id}`, { replace: true })
    if (editing) update.mutate(input, { onSuccess })
    else if (targetZone) create.mutate({ ...input, zone_id: targetZone } as PlaceInput, { onSuccess })
  }

  const setLink = (i: number, patch: Partial<PlaceLink>) =>
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <form onSubmit={submit} className="space-y-4">
      <Link to={editing ? `/places/${placeId}` : `/zones/${targetZone}`} className="text-xs text-fog">
        ← Back
      </Link>
      <h1 className="font-display text-2xl font-bold">{editing ? 'Edit place' : 'Add a place'}</h1>

      <div>
        <label className="label" htmlFor="name">
          Name *
        </label>
        <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div>
        <label className="label" htmlFor="name-ja">
          Japanese name
        </label>
        <input id="name-ja" className="field" value={nameJa} onChange={(e) => setNameJa(e.target.value)} />
      </div>

      <div>
        <label className="label" htmlFor="category">
          Category *
        </label>
        <select
          id="category"
          className="field"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c].en} {CATEGORY_LABELS[c].ja}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="description">
          Notes
        </label>
        <textarea
          id="description"
          className="field min-h-28"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="address">
          Address
        </label>
        <input id="address" className="field" value={address} onChange={(e) => setAddress(e.target.value)} />
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
      </div>

      <div>
        <span className="label">Links</span>
        <div className="space-y-2">
          {links.map((link, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={`Link ${i + 1} label`}
                className="field w-28"
                placeholder="Label"
                value={link.label}
                onChange={(e) => setLink(i, { label: e.target.value })}
              />
              <input
                aria-label={`Link ${i + 1} URL`}
                className="field flex-1"
                placeholder="https://…"
                inputMode="url"
                value={link.url}
                onChange={(e) => setLink(i, { url: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove link ${i + 1}`}
                className="btn-ghost px-3"
                onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-medium text-shu"
            onClick={() => setLinks((ls) => [...ls, { label: '', url: '' }])}
          >
            + Add link
          </button>
        </div>
      </div>

      {mutation.isError && (
        <div className="rounded-lg border border-shu/30 bg-shu/5 px-4 py-3">
          <p className="text-sm text-sumi">
            Save failed — your text is safe. Check the connection and retry.
          </p>
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : mutation.isError ? 'Retry save' : editing ? 'Save changes' : 'Add place'}
      </button>
    </form>
  )
}
