// Mutations with cache invalidation so edits appear immediately locally and on
// the other traveler's phone via refetch-on-focus (FR-018).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  FileMeta,
  FileParent,
  FileUploadInput,
  ItineraryItem,
  ItineraryItemInput,
  JourneyStep,
  JourneyStepInput,
  Place,
  PlaceInput,
  Reminder,
  ReminderInput,
  ShoppingItem,
  ShoppingItemInput,
  Tip,
} from './types'
import type { SubscriptionPayload } from '../lib/push'

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

function useShoppingInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['shopping'] })
}

export function useCreateShoppingItem() {
  const invalidate = useShoppingInvalidation()
  return useMutation({
    mutationFn: (input: ShoppingItemInput) => api.post<{ item: ShoppingItem }>('/shopping', input),
    onSuccess: invalidate,
  })
}

export function useUpdateShoppingItem() {
  const invalidate = useShoppingInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ShoppingItemInput> }) =>
      api.patch<{ item: ShoppingItem }>(`/shopping/${id}`, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteShoppingItem() {
  const invalidate = useShoppingInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/shopping/${id}`),
    onSuccess: invalidate,
  })
}

function invalidateForFileParent(qc: ReturnType<typeof useQueryClient>, parent?: FileParent) {
  qc.invalidateQueries({ queryKey: ['trip-files'] })
  if (parent?.kind === 'zone') qc.invalidateQueries({ queryKey: ['zone', parent.id] })
  if (parent?.kind === 'place') qc.invalidateQueries({ queryKey: ['place', parent.id] })
}

export function useUploadFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FileUploadInput) => api.post<{ file: FileMeta }>('/files', input),
    onSuccess: (_data, input) => invalidateForFileParent(qc, input.parent),
  })
}

export function useDeleteFile(parent?: FileParent) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) => api.delete<void>(`/files/${fileId}`),
    onSuccess: () => invalidateForFileParent(qc, parent),
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

function useStepInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['trip'] })
}

export function useCreateStep() {
  const invalidate = useStepInvalidation()
  return useMutation({
    mutationFn: (input: JourneyStepInput) => api.post<{ step: JourneyStep }>('/steps', input),
    onSuccess: invalidate,
  })
}

export function useUpdateStep() {
  const invalidate = useStepInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<JourneyStepInput> }) =>
      api.patch<{ step: JourneyStep }>(`/steps/${id}`, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteStep() {
  const invalidate = useStepInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/steps/${id}`),
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

function useReminderInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['reminders'] })
}

export function useCreateReminder() {
  const invalidate = useReminderInvalidation()
  return useMutation({
    mutationFn: (input: ReminderInput) => api.post<{ reminder: Reminder }>('/reminders', input),
    onSuccess: invalidate,
  })
}

export function useUpdateReminder() {
  const invalidate = useReminderInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ReminderInput> }) =>
      api.patch<{ reminder: Reminder }>(`/reminders/${id}`, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteReminder() {
  const invalidate = useReminderInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/reminders/${id}`),
    onSuccess: invalidate,
  })
}

// Push subscriptions — one row per device that turned notifications on.
export function useRegisterPush() {
  return useMutation({
    mutationFn: (payload: SubscriptionPayload) =>
      api.post<{ subscription: { id: string; label: string | null } }>(
        '/push/subscriptions',
        payload
      ),
  })
}

export function useUnregisterPush() {
  return useMutation({
    mutationFn: (endpoint: string) =>
      api.delete<void>(`/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`),
  })
}

export function useSendTestPush() {
  return useMutation({
    mutationFn: () =>
      api.post<{ subscriptions: number; sent: number; failed: number }>('/push/test', {}),
  })
}
