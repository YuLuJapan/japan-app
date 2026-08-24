import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { useTripId, useTripPath } from './tripPath'
import type {
  Category,
  CurrencyCatalogue,
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
  TripInvite,
  TripMember,
  InvitePreview,
  ZoneDetail,
} from './types'

/** The signed-in account, and whether it has accepted the current terms. */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api.get<{
        user: { id: string; email: string; display_name: string | null }
        terms: { accepted: boolean; version: string }
      }>('/me'),
    // The answer changes only when the terms change or the account accepts,
    // and both of those invalidate this explicitly.
    staleTime: Infinity,
  })

export const useTrips = () =>
  useQuery({ queryKey: ['trips'], queryFn: () => api.get<{ trips: Trip[] }>('/trips') })

// `enabled` on the trip-scoped hooks: the trip sheet mounts before there is a
// trip (adding one), and firing `/trips//…` would 404 on every keystroke.
export const useTrip = (tripId: string) =>
  useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => api.get<TripBundle>(`/trips/${tripId}`),
    enabled: !!tripId,
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

/**
 * Today's rate from one currency into the handful the trip converts to.
 * Both arguments come from the trip (`local_currency` / `home_currencies`);
 * the defaults are what the calculator was fixed to before it could be chosen.
 */
export const useRates = (base = 'JPY', symbols: string[] = ['USD', 'ILS']) => {
  const wanted = symbols.join(',')
  return useQuery({
    queryKey: ['rates', base, wanted],
    queryFn: () =>
      api.get<Rates>(`/rates?${new URLSearchParams({ base, symbols: wanted }).toString()}`),
    staleTime: 1000 * 60 * 60 * 6, // refetch at most every ~6h
  })
}

/** The currencies a trip can be priced in. Static — fetched once per session. */
export const useCurrencies = () =>
  useQuery({
    queryKey: ['currencies'],
    queryFn: () => api.get<CurrencyCatalogue>('/currencies'),
    staleTime: Infinity,
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

export const useTripMembers = (tripId: string) =>
  useQuery({
    queryKey: ['members', tripId],
    queryFn: () => api.get<{ members: TripMember[] }>(`/trips/${tripId}/members`),
    enabled: !!tripId,
  })

export const useTripInvites = (tripId: string) =>
  useQuery({
    queryKey: ['invites', tripId],
    queryFn: () => api.get<{ invites: TripInvite[] }>(`/trips/${tripId}/invites`),
    enabled: !!tripId,
  })

/**
 * Invitations waiting for the signed-in account — the ones addressed to their
 * email, which arrive without anyone having to send the link.
 *
 * `email_unconfirmed` is not an error: the account simply hasn't proved the
 * address is theirs yet, and the list is empty until it does.
 */
export const useMyInvitations = () =>
  useQuery({
    queryKey: ['invitations'],
    queryFn: () =>
      api.get<{ invitations: InvitePreview[]; email_unconfirmed?: true }>('/invitations'),
  })

// The invite link's own preview, read before signing in decides anything.
export const useInvitePreview = (token: string) =>
  useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ invite: InvitePreview }>(`/invites/${token}`),
    retry: false,
  })
