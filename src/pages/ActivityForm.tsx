// Add/edit an activity on the fly (FR-015, SC-008). On save failure the
// entered text is preserved and a retry is offered (FR-019) — form state lives
// here, never cleared on error.
//
// This is the *full* form: a location, links, a photo, a tag. The day plan's
// inline editor is the quick one — a name, a time, a tag — and both survive
// 010 deliberately. One entity, two depths of form, no second concept.
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useActivity } from '../api/hooks'
import { useCreateActivity, useUpdateActivity } from '../api/mutations'
import { useZone } from '../api/hooks'
import type { ActivityInput, Category, GeocodeResult, PlaceLink } from '../api/types'
import { CATEGORIES, CATEGORY_META } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Loading } from '../components/Loading'
import { LocationPicker } from '../components/LocationPicker'
import { useTripId } from '../lib/trip'

export default function ActivityForm() {
  const { zoneId, activityId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const tripId = useTripId()
  const editing = Boolean(activityId)

  const existing = useActivity(activityId ?? '')
  // The city this activity sits in, for the location search to lean on. Adding
  // knows its zone from the route; editing learns it with the activity.
  const zone = useZone(zoneId ?? existing.data?.activity.zone_id ?? '')
  const create = useCreateActivity()
  const update = useUpdateActivity()
  const mutation = editing ? update : create

  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>((params.get('category') as Category) || 'food')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [links, setLinks] = useState<PlaceLink[]>([])
  // The candidate the traveller accepted, and nothing else. Null is the
  // default and stays the default until somebody picks: a place saves
  // perfectly well with no location (FR-004), and a guessed one would put a
  // confident wrong pin on the map.
  const [located, setLocated] = useState<GeocodeResult | null>(null)

  // prefill once when editing
  const loaded = editing && existing.data
  useEffect(() => {
    if (loaded) {
      const p = existing.data.activity
      setName(p.name)
      setCategory(p.category ?? 'other')
      setDescription(p.description ?? '')
      setAddress(p.address ?? '')
      setImageUrl(p.image_url ?? '')
      setLinks(p.links)
    }
  }, [Boolean(loaded)])

  if (editing && existing.isPending) return <Loading />

  const targetZone = editing ? existing.data?.activity.zone_id : zoneId
  const z = zone.data?.zone
  const zoneBias =
    typeof z?.lat === 'number' && typeof z?.lng === 'number'
      ? { lat: z.lat, lng: z.lng }
      : undefined

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const input: Partial<ActivityInput> = {
      name: name.trim(),
      category,
      description: description.trim() || null,
      address: address.trim() || null,
      image_url: imageUrl.trim() || null,
      links: links.filter((l) => l.label.trim() && l.url.trim()),
      // Only what was accepted. Omitted rather than nulled when nothing was
      // picked, so editing an activity's notes never quietly clears the
      // location the backfill found for it (the PATCH convention `flight`
      // follows). `day` is absent for the same reason: this form does not
      // schedule — `ScheduleActivity` on the detail screen does.
      ...(located ? { lat: located.lat, lng: located.lng } : {}),
    }
    const onSuccess = (data: { activity: { id: string } }) =>
      navigate(`/trips/${tripId}/activities/${data.activity.id}`, { replace: true })
    if (editing && activityId) update.mutate({ id: activityId, patch: input }, { onSuccess })
    else if (targetZone)
      create.mutate({ ...input, zone_id: targetZone } as ActivityInput, { onSuccess })
  }

  const setLink = (i: number, patch: Partial<PlaceLink>) =>
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <form onSubmit={submit} className="space-y-4">
      <Breadcrumbs
        trail={[
          { label: 'Journey', to: `/trips/${tripId}` },
          editing
            ? { label: name || 'This activity', to: `/trips/${tripId}/activities/${activityId}` }
            : { label: 'Zone', to: `/trips/${tripId}/zones/${targetZone}` },
        ]}
      />
      <h1 className="font-display text-2xl font-bold">
        {editing ? 'Edit activity' : 'Add an activity'}
      </h1>

      <div>
        <label className="label" htmlFor="name">
          Name *
        </label>
        <input
          id="name"
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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
              {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
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

      {/* The address *is* the lookup. Typing one offers real candidates biased
          by the city this place sits in; picking one is what stores where it
          is (FR-003). Typing an address and picking nothing saves the address
          alone, which is exactly what the form did before this feature.

          `initialQuery` is read from the loaded place rather than from form
          state: the prefill effect lands one render after the data does, and
          the picker keeps its own copy of what it started with. */}
      <LocationPicker
        label="Location"
        placeholder="Street, area, or landmark"
        initialQuery={editing ? (existing.data?.activity.address ?? '') : ''}
        near={zoneBias}
        onPick={setLocated}
        onQueryChange={(query) => setAddress(query)}
        pickedText={(r) => [r.name, r.address].filter(Boolean).join(', ')}
        hint={
          located ? (
            <p className="mt-1 text-xs text-muted">
              {/* Where it landed, in words — the check that says whether the
                  lookup found the right Ichiran. A mini-map would be a nicer
                  version of this line, and would have to arrive as a
                  progressive enhancement behind the same MapEngine port: this
                  screen must not import src/map/, or Slice A stops being
                  revertible on its own. */}
              Located at {[located.name, located.address].filter(Boolean).join(', ')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Pick a suggestion to put this on the map. Saving without one is fine — it just won't
              have a pin.
            </p>
          )
        }
      />

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
            className="text-sm font-bold text-brand"
            onClick={() => setLinks((ls) => [...ls, { label: '', url: '' }])}
          >
            + Add link
          </button>
        </div>
      </div>

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
              : 'Add place'}
      </button>
    </form>
  )
}
