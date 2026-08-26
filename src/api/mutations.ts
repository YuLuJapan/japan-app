// Mutations with cache invalidation so edits appear immediately locally and on
// the other traveler's phone via refetch-on-focus (FR-018).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { capture, tripFacts } from '../lib/posthog'
import type { PlaceFacts } from '../lib/analytics-events'
import { useTripPath } from './tripPath'
import type {
  Category,
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

/**
 * What a place is, with nothing it says. `name`, `description` and the link
 * URLs are the reservation on a `hotel` — see lib/trip-view.ts — so only their
 * presence travels.
 */
const placeFacts = (input: PlaceInput): PlaceFacts => ({
  category: input.category,
  has_address: Boolean(input.address),
  has_coords: input.lat != null && input.lng != null,
  has_photo: Boolean(input.image_url),
  links: input.links?.length ?? 0,
})

/**
 * Which fields an edit touched, by name.
 *
 * A PATCH body is entirely content, but its *keys* are the API's own field
 * names — that is what answers "is anyone using the map, or just the notes?"
 * without carrying a single word anybody typed.
 */
const changedFields = (patch: object): string[] => Object.keys(patch).sort()

const MS_PER_HOUR = 60 * 60 * 1000

/** Nights a stop covers — the gap between its two dates, 0 if either is junk. */
const nightsBetween = (start: string, end: string): number => {
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, Math.round((to - from) / (24 * MS_PER_HOUR)))
}

/** How far ahead a reminder was set, to the hour. Negative means in the past. */
const hoursFromNow = (instant: string): number => {
  const at = Date.parse(instant)
  return Number.isNaN(at) ? 0 : Math.round((at - Date.now()) / MS_PER_HOUR)
}

export function useCreatePlace() {
  const path = useTripPath()
  const invalidate = usePlaceInvalidation()
  return useMutation({
    meta: { success: 'Place added' },
    mutationFn: (input: PlaceInput) => api.post<{ place: Place }>(path('/places'), input),
    onSuccess: (data, input) => {
      capture('place_created', placeFacts(input))
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
    onSuccess: (data, patch) => {
      capture('place_updated', { category: data.place.category, fields: changedFields(patch) })
      invalidate(data.place.zone_id, placeId)
    },
  })
}

/** `category` is only for the event — the request needs the id alone. */
export function useDeletePlace(zoneId: string | undefined, category?: Category) {
  const path = useTripPath()
  const invalidate = usePlaceInvalidation()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Place deleted' },
    mutationFn: (placeId: string) => api.delete<void>(path(`/places/${placeId}`)),
    onSuccess: (_data, placeId) => {
      capture('place_deleted', { category })
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
    onSuccess: (_data, patch) => {
      capture('zone_image_updated', { cleared: patch.image_url === null })
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
    onSuccess: (_data, input) => {
      capture('shopping_item_created', {
        category: input.category ?? 'unset',
        has_price: input.price_yen != null,
        has_link: Boolean(input.url),
        has_photo: Boolean(input.image_url),
        has_shop: Boolean(input.shop),
      })
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
    onSuccess: (_data, { patch }) => {
      // Ticking something off is the list's main verb and worth telling apart
      // from editing it, so the flag rides along with the field names.
      capture('shopping_item_updated', { fields: changedFields(patch), bought: patch.bought })
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

/**
 * Every cache that can hold a file's name or count, after any write to one.
 *
 * Deliberately blunt. This used to invalidate only the parent it was handed —
 * `['zone', thatZone]` and nothing else — which is correct exactly as long as
 * every call site passes the file's true parent, and silently wrong the moment
 * one doesn't: the document list refreshes, the zone page keeps the old name,
 * and the only way back is a manual reload. That failure is invisible in
 * review and days late in use, which is a bad trade for a saved refetch.
 *
 * The cost is small and deferred: these are inactive queries, so nothing is
 * fetched now — each screen refetches once, the next time it is opened.
 * `['trip']` is in the list because the trip home shows `trip_files_count`,
 * which an upload or a delete moves.
 */
function invalidateFileCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['trip-files'] })
  qc.invalidateQueries({ queryKey: ['zone'] })
  qc.invalidateQueries({ queryKey: ['place'] })
  qc.invalidateQueries({ queryKey: ['trip'] })
}

export function useUploadFile(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Document uploaded' },
    mutationFn: (input: FileUploadInput) =>
      api.post<{ file: FileMeta }>(`/trips/${tripId}/files`, input),
    onSuccess: (_data, input) => {
      capture('file_uploaded', {
        parent_type: input.parent.kind,
        mime_type: input.mime_type,
        // base64 runs about 4 characters to every 3 bytes.
        size_kb: Math.round((input.data_base64.length * 3) / 4 / 1024),
      })
      invalidateFileCaches(qc)
    },
  })
}

/**
 * Rename a file. The blob is untouched — only what it is called.
 *
 * `parent` is here for the event, not the cache: where the file hangs is worth
 * knowing about ("does anyone rename the ones attached to places?"), while the
 * refresh deliberately does not depend on it — see `invalidateFileCaches`.
 */
export function useRenameFile(parent?: FileParent) {
  const path = useTripPath()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Name updated' },
    mutationFn: ({ fileId, display_name }: { fileId: string; display_name: string }) =>
      api.patch<{ file: FileMeta }>(path(`/files/${fileId}`), { display_name }),
    onSuccess: (_data, _input) => {
      capture('file_renamed', { parent_type: parent?.kind ?? 'trip' })
      invalidateFileCaches(qc)
    },
  })
}

export function useDeleteFile() {
  const path = useTripPath()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Document deleted' },
    mutationFn: (fileId: string) => api.delete<void>(path(`/files/${fileId}`)),
    onSuccess: () => invalidateFileCaches(qc),
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
    onSuccess: (_data, input) => {
      capture('itinerary_item_created', {
        has_place: Boolean(input.place_id),
        has_time: Boolean(input.start_time),
        highlight: Boolean(input.highlight),
      })
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
    onSuccess: (_data, { patch }) => {
      capture('itinerary_item_updated', { fields: changedFields(patch) })
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
    onSuccess: (_data, input) => {
      capture('journey_step_created', {
        nights: nightsBetween(input.start_date, input.end_date),
        // A step is either an existing zone or somewhere just searched for.
        from_search: !input.zone_id,
      })
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
    onSuccess: (_data, input) => {
      capture('reminder_created', {
        hours_ahead: hoursFromNow(input.remind_at),
        has_url: Boolean(input.url),
      })
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
    onSuccess: (data, input) => {
      capture('trip_created', {
        ...tripFacts(data.trip),
        has_flight: Boolean(input.flight),
        has_description: Boolean(input.description),
      })
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
    onSuccess: (data, patch) => {
      capture('trip_updated', { ...tripFacts(data.trip), fields: changedFields(patch) })
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
    onSuccess: (_data, input) => {
      capture('trip_member_invited', {
        role: input.role,
        has_email: Boolean(input.email),
        shares_stays: input.can_see_stays,
        shares_flight: input.can_see_flight,
        shares_documents: input.can_see_documents,
        shares_shopping: input.can_see_shopping,
      })
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
