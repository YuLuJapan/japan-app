import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type {
  Category,
  ItineraryItem,
  PlaceDetail,
  PlaceListItem,
  Rates,
  SearchResult,
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

export const usePlace = (placeId: string) =>
  useQuery({
    queryKey: ['place', placeId],
    queryFn: () => api.get<PlaceDetail>(`/places/${placeId}`),
    enabled: placeId !== '', // PlaceForm in add mode has no place to fetch
  })

export const useTripFiles = () =>
  useQuery({ queryKey: ['trip-files'], queryFn: () => api.get<{ files: TripDocument[] }>('/files') })

export const useRates = () =>
  useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<Rates>('/rates'),
    staleTime: 1000 * 60 * 60 * 6, // refetch at most every ~6h
  })

export const useSearch = (query: string) =>
  useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  })
