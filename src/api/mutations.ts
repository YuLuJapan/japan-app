// Mutations with cache invalidation so edits appear immediately locally and on
// the other traveler's phone via refetch-on-focus (FR-018).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { capture } from '../lib/posthog'
import { useTripPath } from './tripPath'
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
  StopResolution,
  StrandedResolution,
  Tip,
  Trip,
  TripInput,
  TripInvite,
  TripMember,
  ZoneDetail,
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
  const path = useTripPath()
  const invalidate = usePlaceInvalidation()
  return useMutation({
    meta: { success: 'Place added' },
    mutationFn: (input: PlaceInput) => api.post<{ place: Place }>(path('/places'), input),
    onSuccess: (data) => {
      capture('place_created')
      invalidate(data.place.zone_id, data.place.id)
    },
  })
}

export function useUpdatePlace(placeId: string) {
  const path = useTripPath()
  const invalidate = usePlaceInvalidation()
  return useMutation({
    meta: { success: 'Place saved' },
    mutationFn: (patch: Partial<PlaceInput>) =>
      api.patch<{ place: Place }>(path(`/places/${placeId}`), patch),
    onSuccess: (data) => {
      capture('place_updated')
      invalidate(data.place.zone_id, placeId)
    },
  })
}

export function useDeletePlace(zoneId: string | undefined) {
  const path = useTripPath()
  const invalidate = usePlaceInvalidation()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Place deleted' },
    mutationFn: (placeId: string) => api.delete<void>(path(`/places/${placeId}`)),
    onSuccess: (_data, placeId) => {
      capture('place_deleted')
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

/**
 * Change a zone's photo. Zones were read-only until now, so this is the only
 * zone mutation there is — see server/src/services/zones.ts.
 */
export function useUpdateZone(zoneId: string) {
  const path = useTripPath()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Photo updated' },
    mutationFn: (patch: { image_url: string | null }) =>
      api.patch<{ zone: ZoneDetail['zone'] }>(path(`/zones/${zoneId}`), patch),
    onSuccess: () => {
      capture('zone_image_updated')
      qc.invalidateQueries({ queryKey: ['zone', zoneId] })
      // The photo is on the journey cards too, so the bundle is now stale.
      qc.invalidateQueries({ queryKey: ['trip'] })
    },
  })
}

export function useCreateShoppingItem(tripId: string) {
  const invalidate = useShoppingInvalidation()
  return useMutation({
    meta: { success: 'Added to the list' },
    mutationFn: (input: ShoppingItemInput) =>
      api.post<{ item: ShoppingItem }>(`/trips/${tripId}/shopping`, input),
    onSuccess: () => {
      capture('shopping_item_created')
      invalidate()
    },
  })
}

export function useUpdateShoppingItem() {
  const path = useTripPath()
  const invalidate = useShoppingInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ShoppingItemInput> }) =>
      api.patch<{ item: ShoppingItem }>(path(`/shopping/${id}`), patch),
    onSuccess: () => {
      capture('shopping_item_updated')
      invalidate()
    },
  })
}

export function useDeleteShoppingItem() {
  const path = useTripPath()
  const invalidate = useShoppingInvalidation()
  return useMutation({
    meta: { success: 'Removed from the list' },
    mutationFn: (id: string) => api.delete<void>(path(`/shopping/${id}`)),
    onSuccess: () => {
      capture('shopping_item_deleted')
      invalidate()
    },
  })
}

function invalidateForFileParent(qc: ReturnType<typeof useQueryClient>, parent?: FileParent) {
  qc.invalidateQueries({ queryKey: ['trip-files'] })
  if (parent?.kind === 'zone') qc.invalidateQueries({ queryKey: ['zone', parent.id] })
  if (parent?.kind === 'place') qc.invalidateQueries({ queryKey: ['place', parent.id] })
}

export function useUploadFile(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Document uploaded' },
    mutationFn: (input: FileUploadInput) =>
      api.post<{ file: FileMeta }>(`/trips/${tripId}/files`, input),
    onSuccess: (_data, input) => {
      capture('file_uploaded', { parent_type: input.parent.kind })
      invalidateForFileParent(qc, input.parent)
    },
  })
}

export function useDeleteFile(parent?: FileParent) {
  const path = useTripPath()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Document deleted' },
    mutationFn: (fileId: string) => api.delete<void>(path(`/files/${fileId}`)),
    onSuccess: () => invalidateForFileParent(qc, parent),
  })
}

function useItineraryInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['itinerary'] })
}

export function useCreateItineraryItem(tripId: string) {
  const invalidate = useItineraryInvalidation()
  return useMutation({
    meta: { success: 'Added to the day' },
    mutationFn: (input: ItineraryItemInput) =>
      api.post<{ item: ItineraryItem }>(`/trips/${tripId}/itinerary`, input),
    onSuccess: () => {
      capture('itinerary_item_created')
      invalidate()
    },
  })
}

export function useUpdateItineraryItem() {
  const path = useTripPath()
  const invalidate = useItineraryInvalidation()
  return useMutation({
    meta: { success: 'Activity saved' },
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ItineraryItemInput> }) =>
      api.patch<{ item: ItineraryItem }>(path(`/itinerary/${id}`), patch),
    onSuccess: () => {
      capture('itinerary_item_updated')
      invalidate()
    },
  })
}

export function useDeleteItineraryItem() {
  const path = useTripPath()
  const invalidate = useItineraryInvalidation()
  return useMutation({
    meta: { success: 'Activity removed' },
    mutationFn: (id: string) => api.delete<void>(path(`/itinerary/${id}`)),
    onSuccess: () => {
      capture('itinerary_item_deleted')
      invalidate()
    },
  })
}

function useStepInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['trip'] })
}

export function useCreateStep(tripId: string) {
  const invalidate = useStepInvalidation()
  return useMutation({
    meta: { success: 'Destination added' },
    mutationFn: (input: JourneyStepInput) =>
      api.post<{ step: JourneyStep }>(`/trips/${tripId}/steps`, input),
    onSuccess: () => {
      capture('journey_step_created')
      invalidate()
    },
  })
}

export function useUpdateStep() {
  const path = useTripPath()
  const invalidate = useStepInvalidation()
  return useMutation({
    meta: { success: 'Journey updated' },
    mutationFn: ({ id, patch }: { id: string; patch: Partial<JourneyStepInput> }) =>
      api.patch<{ step: JourneyStep }>(path(`/steps/${id}`), patch),
    onSuccess: invalidate,
  })
}

export function useDeleteStep() {
  const path = useTripPath()
  const invalidate = useStepInvalidation()
  return useMutation({
    meta: { success: 'Destination removed' },
    mutationFn: (id: string) => api.delete<void>(path(`/steps/${id}`)),
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
  const path = useTripPath()
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    meta: { success: 'Tip added' },
    mutationFn: (body: string) => api.post<{ tip: Tip }>(path('/tips'), { body, ...parent }),
    onSuccess: invalidate,
  })
}

export function useUpdateTip(parent: TipParent) {
  const path = useTripPath()
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    meta: { success: 'Tip saved' },
    mutationFn: ({ tipId, body }: { tipId: string; body: string }) =>
      api.patch<{ tip: Tip }>(path(`/tips/${tipId}`), { body }),
    onSuccess: invalidate,
  })
}

export function useDeleteTip(parent: TipParent) {
  const path = useTripPath()
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    meta: { success: 'Tip removed' },
    mutationFn: (tipId: string) => api.delete<void>(path(`/tips/${tipId}`)),
    onSuccess: invalidate,
  })
}

function useReminderInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['reminders'] })
}

export function useCreateReminder(tripId: string) {
  const invalidate = useReminderInvalidation()
  return useMutation({
    meta: { success: 'Reminder set' },
    mutationFn: (input: ReminderInput) =>
      api.post<{ reminder: Reminder }>(`/trips/${tripId}/reminders`, input),
    onSuccess: () => {
      capture('reminder_created')
      invalidate()
    },
  })
}

export function useUpdateReminder() {
  const path = useTripPath()
  const invalidate = useReminderInvalidation()
  return useMutation({
    meta: { success: 'Reminder saved' },
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ReminderInput> }) =>
      api.patch<{ reminder: Reminder }>(path(`/reminders/${id}`), patch),
    onSuccess: invalidate,
  })
}

export function useDeleteReminder() {
  const path = useTripPath()
  const invalidate = useReminderInvalidation()
  return useMutation({
    meta: { success: 'Reminder deleted' },
    mutationFn: (id: string) => api.delete<void>(path(`/reminders/${id}`)),
    onSuccess: invalidate,
  })
}

// Push subscriptions — one row per device that turned notifications on, held
// against the account that turned it on.

/**
 * Re-register a device that is already subscribed, so the server records
 * whoever is signed in *now* as its owner.
 *
 * A push endpoint identifies a device, not a person, and reminders are
 * delivered to the members of the trip they belong to — so a row whose account
 * is stale (a device that predates accounts, or a phone someone else has since
 * signed into) would either hear nothing or hear the wrong trips. Called on
 * load rather than only on the toggle, because nobody re-taps a switch that is
 * already on. Fire-and-forget: it changes nothing visible, and the next visit
 * retries.
 */
export const syncPushSubscription = (payload: SubscriptionPayload) =>
  api.post<{ subscription: { id: string; label: string | null } }>('/push/subscriptions', payload)

export function useRegisterPush() {
  return useMutation({
    meta: { toast: false },
    mutationFn: (payload: SubscriptionPayload) =>
      api.post<{ subscription: { id: string; label: string | null } }>(
        '/push/subscriptions',
        payload
      ),
  })
}

export function useUnregisterPush() {
  return useMutation({
    meta: { toast: false },
    mutationFn: (endpoint: string) =>
      api.delete<void>(`/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`),
  })
}

export function useSendTestPush() {
  return useMutation({
    meta: { toast: false },
    mutationFn: () =>
      api.post<{ subscriptions: number; sent: number; failed: number }>('/push/test', {}),
  })
}

function useTripsInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['trips'] })
}

/**
 * Accept the terms as they currently stand.
 *
 * No version is sent: the server stamps its own, so a client cannot accept
 * text it was never shown. See server/src/lib/terms.ts.
 */
export function useAcceptTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ terms: { accepted: boolean } }>('/me/terms', {}),
    onSuccess: () => {
      capture('terms_accepted')
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useCreateTrip() {
  const invalidate = useTripsInvalidation()
  return useMutation({
    meta: { success: 'Trip created' },
    mutationFn: (input: TripInput) => api.post<{ trip: Trip }>('/trips', input),
    onSuccess: () => {
      capture('trip_created')
      invalidate()
    },
  })
}

export function useUpdateTrip(tripId: string) {
  const invalidate = useTripsInvalidation()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Trip saved' },
    // The `stranded_*` fields only matter when the new dates leave stops or
    // activities outside the trip; the server refuses the change without them.
    mutationFn: (
      patch: Partial<TripInput> & {
        stranded_activities?: StrandedResolution
        stranded_stops?: StopResolution
      }
    ) =>
      api.patch<{ trip: Trip; moved_stops?: string[]; moved?: string[]; deleted?: string[] }>(
        `/trips/${tripId}`,
        patch
      ),
    onSuccess: () => {
      capture('trip_updated')
      invalidate()
      qc.invalidateQueries({ queryKey: ['trip', tripId] })
      // A move/delete rewrote the day plan under the trip.
      qc.invalidateQueries({ queryKey: ['itinerary', tripId] })
    },
  })
}

export function useDeleteTrip() {
  const invalidate = useTripsInvalidation()
  return useMutation({
    meta: { success: 'Trip deleted' },
    mutationFn: (tripId: string) => api.delete<void>(`/trips/${tripId}`),
    onSuccess: () => {
      capture('trip_deleted')
      invalidate()
    },
  })
}

// --- sharing -----------------------------------------------------------------

export function useCreateInvite(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      role: 'partner' | 'viewer'
      email?: string
      can_see_stays: boolean
      can_see_flight: boolean
      can_see_documents: boolean
      can_see_shopping: boolean
    }) => api.post<{ invite: TripInvite; token: string }>(`/trips/${tripId}/invites`, input),
    onSuccess: () => {
      capture('trip_member_invited')
      qc.invalidateQueries({ queryKey: ['invites', tripId] })
    },
  })
}

export function useRevokeInvite(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Invitation revoked' },
    mutationFn: (inviteId: string) => api.delete<void>(`/trips/${tripId}/invites/${inviteId}`),
    onSuccess: () => {
      capture('trip_invitation_revoked')
      qc.invalidateQueries({ queryKey: ['invites', tripId] })
    },
  })
}

export function useUpdateMember(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Sharing updated' },
    mutationFn: ({ userId, ...patch }: { userId: string } & Record<string, unknown>) =>
      api.patch<{ member: TripMember }>(`/trips/${tripId}/members/${userId}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', tripId] }),
  })
}

export function useRemoveMember(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Removed from the trip' },
    mutationFn: (userId: string) => api.delete<void>(`/trips/${tripId}/members/${userId}`),
    onSuccess: () => {
      capture('trip_member_removed')
      qc.invalidateQueries({ queryKey: ['members', tripId] })
      // Leaving a trip removes it from your list, so that has to refetch too.
      qc.invalidateQueries({ queryKey: ['trips'] })
    },
  })
}

/** Accept or decline from the inbox — by id, with no link involved. */
function useInvitationAction(action: 'accept' | 'decline') {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: action === 'accept' ? 'Invitation accepted' : 'Invitation declined' },
    mutationFn: (inviteId: string) =>
      api.post<{ trip_id?: string }>(`/invitations/${inviteId}/${action}`, {}),
    onSuccess: () => {
      capture(action === 'accept' ? 'invitation_accepted' : 'invitation_declined')
      qc.invalidateQueries({ queryKey: ['invitations'] })
      qc.invalidateQueries({ queryKey: ['trips'] })
    },
  })
}

export const useAcceptInvitation = () => useInvitationAction('accept')
export const useDeclineInvitation = () => useInvitationAction('decline')

export function useAcceptInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      api.post<{ trip_id: string; role: string; already_member: boolean }>(
        `/invites/${token}/accept`,
        {}
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  })
}
