// Change a zone's photo.
//
// Zones were read-only until now — the picture on a city's hero was whatever
// migration 0001 seeded and could never be anything else. This is the whole of
// the zone-editing surface: only the photo, because the name, its Japanese
// reading and the summary are what journey steps and search read.
//
// Two ways in, because both are how a photo actually gets found: search the web
// (the same Wikimedia lookup the shopping list uses — keyless and free), or
// paste a URL from wherever you were already looking.
import { useEffect, useState } from 'react'
import { useUpdateZone } from '../api/mutations'
import { saveErrorMessage } from '../lib/errors'
import { ImagePicker } from './ImagePicker'
import { ZoneImage } from './ZoneImage'

export function ZonePhotoEditor({
  zoneId,
  zoneName,
  imageUrl,
  onClose,
}: {
  zoneId: string
  zoneName: string
  imageUrl?: string | null
  onClose: () => void
}) {
  const [url, setUrl] = useState(imageUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateZone(zoneId)

  // Someone else may have changed the photo while this was open.
  useEffect(() => setUrl(imageUrl ?? ''), [imageUrl])

  const save = (next: string | null) => {
    setError(null)
    update.mutate(
      { image_url: next },
      { onSuccess: onClose, onError: (err) => setError(saveErrorMessage(err)) }
    )
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-3.5">
      <p className="text-sm font-semibold text-ink">Photo for {zoneName}</p>

      {/* What is about to be saved, not what is saved — a pasted URL that is
          wrong is far easier to notice here than after closing. */}
      <div className="mt-2 overflow-hidden rounded-xl">
        <ZoneImage src={url || null} alt="" className="h-28 w-full" />
      </div>

      <input
        className="field mt-2"
        aria-label="Photo URL"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <ImagePicker query={zoneName} onPick={setUrl} />

      {error && <p className="mt-2 text-xs font-medium text-brand">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onClose}>
          Cancel
        </button>
        {imageUrl && (
          <button
            type="button"
            className="btn-ghost flex-1"
            disabled={update.isPending}
            onClick={() => save(null)}
          >
            Remove
          </button>
        )}
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={update.isPending || url.trim() === (imageUrl ?? '')}
          onClick={() => save(url.trim() || null)}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
