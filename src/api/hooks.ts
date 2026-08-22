import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { useTripId, useTripPath } from './tripPath'
import type {
  Category,
  GeocodeResult,
  ImageResult,
  ItineraryItem,
  PlaceDetail,
  PlaceListItem,
  ProductPreview,
  Rates,
  Reminder,
  SearchResult,
  ShoppingItem,
  Translation,
  Trip,
  TripBundle,
  TripDateImpact,
  TripDocument,
  ZoneDetail,
} from './types'

export const useTrips = () =>
  useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ trips: Trip[] }>('/trips') })

export const useTrip = (tripId: string) =>
  useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => api.get<TripBundle>(`/trips/${tripId}`),
  })

export const useItinerary = (tripId: string) =>
  useQuery({
    queryKey: ['itinerary', tripId],
    queryFn: () => api.get<{ items: ItineraryItem[] }>(`/trips/${tripId}/itinerary`),
  })

export const useZone = (zoneId: string) => {
  const path = useTripPath()
  return useQuery({
    // Keyed by zone alone, not by trip: ids are globally unique, and the
    // invalidations in mutations.ts match on this prefix.
    queryKey: ['zone', zoneId],
    queryFn: () => api.get<ZoneDetail>(path(`/zones/${zoneId}`)),
  })
}

export const useZonePlaces = (zoneId: string, category: Category) => {
  const path = useTripPath()
  return useQuery({
    queryKey: ['zone-places', zoneId, category],
    queryFn: () =>
      api.get<{ places: PlaceListItem[] }>(path(`/zones/${zoneId}/places?category=${category}`)),
  })
}

export const usePlace = (placeId: string) => {
  const path = useTripPath()
  return useQuery({
    queryKey: ['place', placeId],
    queryFn: () => api.get<PlaceDetail>(path(`/places/${placeId}`)),
    enabled: placeId !== '', // PlaceForm in add mode has no place to fetch
  })
}

export const useShoppingList = (tripId: string) =>
  useQuery({
    queryKey: ['shopping', tripId],
    queryFn: () => api.get<{ items: ShoppingItem[] }>(`/trips/${tripId}/shopping`),
  })

export const useTripFiles = (tripId: string) =>
  useQuery({
    queryKey: ['trip-files', tripId],
    queryFn: () => api.get<{ files: TripDocument[] }>(`/trips/${tripId}/files`),
  })

export const useRates = () =>
  useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<Rates>('/rates'),
    staleTime: 1000 * 60 * 60 * 6, // refetch at most every ~6h
  })

// Free OpenStreetMap place search (proxied by the server). Called on demand
// from the journey editor's destination box, not as a standing query.
export const geocode = (query: string, bias?: { lat: number; lng: number }) => {
  const params = new URLSearchParams({ q: query })
  if (bias) {
    params.set('lat', String(bias.lat))
    params.set('lng', String(bias.lng))
  }
  return api.get<{ results: GeocodeResult[] }>(`/geocode?${params}`)
}

// Dry run for a trip's new dates: what they would strand. Called on demand from
// the trip sheet when the traveller saves, not as a standing query.
export const tripDateImpact = (tripId: string, startDate: string, endDate: string) => {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
  return api.get<TripDateImpact>(`/trips/${tripId}/date-impact?${params}`)
}

export const useReminders = (tripId: string) =>
  useQuery({
    queryKey: ['reminders', tripId],
    queryFn: () => api.get<{ reminders: Reminder[] }>(`/trips/${tripId}/reminders`),
  })

// null public_key = the server has no VAPID keys yet, so notifications can't
// be turned on (the Reminders screen explains what's missing).
export const usePushKey = () =>
  useQuery({
    queryKey: ['push-key'],
    queryFn: () => api.get<{ public_key: string | null }>('/push/key'),
    staleTime: Infinity,
  })

// Web photo search for items with no picture (Wikimedia-backed, see
// server/src/services/images.ts). Enabled only once the caller asks, so opening
// a form doesn't fire a lookup.
export const useImageSearch = (query: string, enabled: boolean) =>
  useQuery({
    queryKey: ['images', query],
    queryFn: () => api.get<{ results: ImageResult[] }>(`/images?q=${encodeURIComponent(query)}`),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 1000 * 60 * 30,
  })

// Read a product page's own metadata so pasting a shop link fills the form.
// Called on demand from the form, not as a standing query.
export const fetchProductPreview = (url: string) =>
  api.get<ProductPreview>(`/product-preview?url=${encodeURIComponent(url)}`)

// Japanese → English for anything typed or pasted in Japanese.
export const fetchTranslation = (text: string) =>
  api.get<Translation>(`/translate?q=${encodeURIComponent(text)}`)

/** Kana, kanji or full-width punctuation — mirrors the server's check. */
export const containsJapanese = (text: string) => /[぀-ゟ゠-ヿ㐀-䶿一-鿿＀-ﾟ]/.test(text)

export const useSearch = (query: string) => {
  const path = useTripPath()
  const tripId = useTripId()
  return useQuery({
    queryKey: ['search', tripId, query],
    queryFn: () =>
      api.get<{ results: SearchResult[] }>(path(`/search?q=${encodeURIComponent(query)}`)),
    enabled: query.trim().length >= 2,
  })
}
