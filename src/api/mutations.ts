// Mutations with cache invalidation so edits appear immediately locally and on
// the other traveler's phone via refetch-on-focus (FR-018).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { ItineraryItem, ItineraryItemInput, Place, PlaceInput, Tip } from './types'

function usePlaceInvalidation() {
  const qc = useQueryClient()
  return (zoneId?: string, placeId?: string) => {
    qc.invalidateQueries({ queryKey: ['trip'] })
    if (zoneId) {
      qc.invalidateQueries({ queryKey: ['zone', zoneId] })
      qc.invalidateQueries({ queryKey: ['zone-places', zoneId] })
    }
    if (placeId) qc.invalidateQueries({ queryKey: ['place', placeId] })
  }
}

export function useCreatePlace() {
  const invalidate = usePlaceInvalidation()
  return useMutation({
    mutationFn: (input: PlaceInput) => api.post<{ place: Place }>('/places', input),
    onSuccess: (data) => invalidate(data.place.zone_id, data.place.id),
  })
}

export function useUpdatePlace(placeId: string) {
  const invalidate = usePlaceInvalidation()
  return useMutation({
    mutationFn: (patch: Partial<PlaceInput>) =>
      api.patch<{ place: Place }>(`/places/${placeId}`, patch),
    onSuccess: (data) => invalidate(data.place.zone_id, placeId),
  })
}

export function useDeletePlace(zoneId: string | undefined) {
  const invalidate = usePlaceInvalidation()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (placeId: string) => api.delete<void>(`/places/${placeId}`),
    onSuccess: (_data, placeId) => {
      qc.removeQueries({ queryKey: ['place', placeId] })
      invalidate(zoneId)
      qc.invalidateQueries({ queryKey: ['trip-files'] }) // deleted place's files re-parent to trip
    },
  })
}

function useItineraryInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['itinerary'] })
}

export function useCreateItineraryItem() {
  const invalidate = useItineraryInvalidation()
  return useMutation({
    mutationFn: (input: ItineraryItemInput) =>
      api.post<{ item: ItineraryItem }>('/itinerary', input),
    onSuccess: invalidate,
  })
}

export function useUpdateItineraryItem() {
  const invalidate = useItineraryInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ItineraryItemInput> }) =>
      api.patch<{ item: ItineraryItem }>(`/itinerary/${id}`, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteItineraryItem() {
  const invalidate = useItineraryInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/itinerary/${id}`),
    onSuccess: invalidate,
  })
}

interface TipParent {
  zone_id?: string
  place_id?: string
}

function useTipInvalidation(parent: TipParent) {
  const qc = useQueryClient()
  return () => {
    if (parent.zone_id) qc.invalidateQueries({ queryKey: ['zone', parent.zone_id] })
    if (parent.place_id) qc.invalidateQueries({ queryKey: ['place', parent.place_id] })
  }
}

export function useCreateTip(parent: TipParent) {
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    mutationFn: (body: string) => api.post<{ tip: Tip }>('/tips', { body, ...parent }),
    onSuccess: invalidate,
  })
}

export function useUpdateTip(parent: TipParent) {
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    mutationFn: ({ tipId, body }: { tipId: string; body: string }) =>
      api.patch<{ tip: Tip }>(`/tips/${tipId}`, { body }),
    onSuccess: invalidate,
  })
}

export function useDeleteTip(parent: TipParent) {
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    mutationFn: (tipId: string) => api.delete<void>(`/tips/${tipId}`),
    onSuccess: invalidate,
  })
}
