import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type {
  Category,
  GeocodeResult,
  ItineraryItem,
  PlaceDetail,
  PlaceListItem,
  Rates,
  Reminder,
  SearchResult,
  ShoppingItem,
  TripBundle,
  TripDocument,
  ZoneDetail,
} from './types'

export const useTrip = () =>
  useQuery({ queryKey: ['trip'], queryFn: () => api.get<TripBundle>('/trip') })

export const useItinerary = () =>
  useQuery({
    queryKey: ['itinerary'],
    queryFn: () => api.get<{ items: ItineraryItem[] }>('/itinerary'),
  })

export const useZone = (zoneId: string) =>
  useQuery({ queryKey: ['zone', zoneId], queryFn: () => api.get<ZoneDetail>(`/zones/${zoneId}`) })

export const useZonePlaces = (zoneId: string, category: Category) =>
  useQuery({
    queryKey: ['zone-places', zoneId, category],
    queryFn: () =>
      api.get<{ places: PlaceListItem[] }>(`/zones/${zoneId}/places?category=${category}`),
  })

// Every place in a zone, all categories — powers the city map's pins.
export const useZoneMapPlaces = (zoneId: string) =>
  useQuery({
    queryKey: ['zone-places', zoneId, ''],
    queryFn: () => api.get<{ places: PlaceListItem[] }>(`/zones/${zoneId}/places`),
  })

export const usePlace = (placeId: string) =>
  useQuery({
    queryKey: ['place', placeId],
    queryFn: () => api.get<PlaceDetail>(`/places/${placeId}`),
    enabled: placeId !== '', // PlaceForm in add mode has no place to fetch
  })

export const useShoppingList = () =>
  useQuery({
    queryKey: ['shopping'],
    queryFn: () => api.get<{ items: ShoppingItem[] }>('/shopping'),
  })

export const useTripFiles = () =>
  useQuery({
    queryKey: ['trip-files'],
    queryFn: () => api.get<{ files: TripDocument[] }>('/files'),
  })

export const useRates = () =>
  useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<Rates>('/rates'),
    staleTime: 1000 * 60 * 60 * 6, // refetch at most every ~6h
  })

// Free OpenStreetMap place search (proxied by the server). Called on demand
// from the map's search box, not as a standing query.
export const geocode = (query: string, bias?: { lat: number; lng: number }) => {
  const params = new URLSearchParams({ q: query })
  if (bias) {
    params.set('lat', String(bias.lat))
    params.set('lng', String(bias.lng))
  }
  return api.get<{ results: GeocodeResult[] }>(`/geocode?${params}`)
}

export const useReminders = () =>
  useQuery({
    queryKey: ['reminders'],
    queryFn: () => api.get<{ reminders: Reminder[] }>('/reminders'),
  })

// null public_key = the server has no VAPID keys yet, so notifications can't
// be turned on (the Reminders screen explains what's missing).
export const usePushKey = () =>
  useQuery({
    queryKey: ['push-key'],
    queryFn: () => api.get<{ public_key: string | null }>('/push/key'),
    staleTime: Infinity,
  })

export const useSearch = (query: string) =>
  useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  })
