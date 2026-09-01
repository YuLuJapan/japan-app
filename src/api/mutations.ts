// Mutations with cache invalidation so edits appear immediately locally and on
// the other traveler's phone via refetch-on-focus (FR-018).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { capture, tripFacts } from '../lib/posthog'
import { compareActivities, compareShopping, compareSteps } from '../lib/ordering'
import type { ActivityFacts } from '../lib/analytics-events'
import { useTripPath } from './tripPath'
import type {
  Category,
  ChatView,
  FileMeta,
  FileParent,
  FileUploadInput,
  Activity,
  ActivityDetail,
  ActivityInput,
  JourneyStepInput,
  Reminder,
  ReminderInput,
  ShoppingItem,
  ShoppingItemInput,
  StopResolution,
  StrandedResolution,
  Tip,
  Trip,
  TripBundle,
  TripDocument,
  TripInput,
  TripStep,
  TripInvite,
  TripMember,
  ZoneDetail,
} from './types'
import type { SubscriptionPayload } from '../lib/push'

/** The cached shapes the writes above reach into. */
type ShoppingList = { items: ShoppingItem[] }
type ActivityList = { activities: Activity[] }
type TripList = { trips: Trip[] }

/**
 * How long a write waits for its own refetch before it stops holding the UI.
 *
 * Long enough that a warm request lands inside it, short enough that nothing
 * reads as stuck: past roughly this, a person stops believing the tap worked.
 */
const REFRESH_GRACE_MS = 500

/**
 * The refetch a write triggers — awaited, but not indefinitely.
 *
 * The rare case now, not the rule: almost every write puts the server's answer
 * into the cache itself and calls `reconcile`. What is left here is the
 * handful where the screen genuinely cannot be right without a read — accepting
 * the terms (the gate opens on `['me']`), joining a trip (a trips row nothing
 * here can build), and a date change the server answered by moving stops.
 *
 * Every invalidation helper below returns this, and every `onSuccess` returns
 * that in turn, which is what holds the write "open" until the screen agrees
 * with it: the success toast fires from the MutationCache's `onSettled`, and
 * `isPending` — the disabled button, the "Saving…" label — stays true for as
 * long as this promise does. That ordering is worth having and worth *not*
 * paying an unbounded price for: on a cold serverless function or a train, a
 * refetch can take seconds, and a form that sits in "Saving…" for two of them
 * after the save has already succeeded is a worse lie than an early toast.
 *
 * So the two failure modes are traded off rather than one of them chosen. The
 * refetch is not cancelled when the grace runs out — it lands when it lands,
 * and the screen catches up then. What ends is the *waiting*.
 */
function refreshed(...work: Promise<unknown>[]): Promise<void> {
  return Promise.race([
    Promise.all(work).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, REFRESH_GRACE_MS)),
  ])
}

/**
 * The invalidation a write triggers when the screen is *already* right.
 *
 * Where a response tells us exactly what changed, the cache is written from it
 * (below) and there is nothing left to wait for: the row has already repainted
 * and the confirmation should not be held for a round trip that only confirms
 * what is on screen. The invalidation still goes out — to reconcile whatever
 * could not be computed here, like a list whose rows carry a summary the
 * server renders — but nothing waits on it.
 */
function reconcile(...work: Promise<unknown>[]): void {
  // Caught rather than trusted: `invalidateQueries` does not reject today, but
  // an unhandled rejection here would be captured and reported as an app error
  // (posthog.ts `capture_unhandled_rejections`) — a background refresh is not
  // worth a crash report.
  void Promise.all(work).catch(() => undefined)
}

/**
 * Cache writes: put the server's own answer where the screen reads it, so the
 * change is on screen before the refetch that would have brought it.
 *
 * The line these stop at: a row is patched when what is rendered follows from
 * the row's own fields — a name, a category, whether something is bought (the
 * shopping list *filters* on that, so a tick moves it between sections on the
 * spot). It is left to the refetch when the **server owns the order**, as with
 * the day plan, where an edit can move an item and a patched-in-place copy
 * would show the right words in the wrong sequence for a moment. Correcting
 * itself a beat later is the failure we are trying to stop, not a lesser one.
 */
const replaceById = <T extends { id: string }>(rows: T[], next: { id: string }): T[] =>
  rows.map((row) => (row.id === next.id ? { ...row, ...next } : row))

const removeById = <T extends { id: string }>(rows: T[], id: string): T[] =>
  rows.filter((row) => row.id !== id)

/** Anything the API hands back with a `files` array: the trip's, a zone's, an activity's. */
const holdsFiles = (data: unknown): data is { files: FileMeta[] } =>
  !!data && typeof data === 'object' && Array.isArray((data as { files?: unknown }).files)

/**
 * A file is listed in three places — the trip's documents, its zone, its activity
 * — and which of them hold a copy is not knowable from here. So all three are
 * walked, including the ones sitting inactive in the cache: the zone page
 * opened later is then already right rather than right after a refetch.
 */
function patchCachedFiles(
  qc: ReturnType<typeof useQueryClient>,
  apply: (files: FileMeta[]) => FileMeta[]
) {
  for (const queryKey of [['trip-files'], ['zone'], ['activity']]) {
    qc.setQueriesData({ queryKey }, (data: unknown) =>
      holdsFiles(data) ? { ...data, files: apply(data.files) } : data
    )
  }
}

/** A zone's or an activity's detail payload, whichever a tip hangs off. */
function patchTips(
  qc: ReturnType<typeof useQueryClient>,
  parent: TipParent,
  apply: (tips: Tip[]) => Tip[]
) {
  const key = parent.zone_id
    ? ['zone', parent.zone_id]
    : parent.activity_id
      ? ['activity', parent.activity_id]
      : null
  if (!key) return
  qc.setQueryData(key, (cached: { tips: Tip[] } | undefined) =>
    cached ? { ...cached, tips: apply(cached.tips) } : cached
  )
}

/**
 * Soonest first — the order `listReminders` returns them in, reproduced here
 * because a reminder's time is editable and a re-timed one has to move. The
 * two must stay in step; the datastore's comparator is the definition.
 */
const bySoonest = (a: Reminder, b: Reminder) =>
  a.remind_at < b.remind_at ? -1 : a.remind_at > b.remind_at ? 1 : 0

function patchReminders(
  qc: ReturnType<typeof useQueryClient>,
  apply: (reminders: Reminder[]) => Reminder[]
) {
  qc.setQueriesData({ queryKey: ['reminders'] }, (cached: { reminders: Reminder[] } | undefined) =>
    cached ? { ...cached, reminders: apply(cached.reminders).sort(bySoonest) } : cached
  )
}

/**
 * The trip's activities, on whichever trip is cached. Re-sorted on the way in:
 * giving an activity a time, moving it to another day, or **scheduling one at
 * all** moves it — and the order is `compareActivities`, mirrored from the
 * datastore and pinned by `server/tests/ordering.test.ts`.
 *
 * One list now, where there used to be two caches to keep in step (the day
 * plan and a per-category zone list). That is the merge paying for itself: a
 * whole class of "right in one place, stale in the other" cannot arise.
 */
function patchActivities(
  qc: ReturnType<typeof useQueryClient>,
  apply: (rows: Activity[]) => Activity[]
) {
  qc.setQueriesData({ queryKey: ['activities'] }, (cached: ActivityList | undefined) =>
    cached ? { ...cached, activities: apply(cached.activities).sort(compareActivities) } : cached
  )
}

/** The journey's steps, on whichever trip bundle is cached. */
const holdsSteps = (data: unknown): data is { steps: TripStep[] } =>
  !!data && typeof data === 'object' && Array.isArray((data as { steps?: unknown }).steps)

function patchSteps(
  qc: ReturnType<typeof useQueryClient>,
  apply: (steps: TripStep[]) => TripStep[]
) {
  qc.setQueriesData({ queryKey: ['trip'] }, (data: unknown) =>
    holdsSteps(data) ? { ...data, steps: apply(data.steps) } : data
  )
}

// The zone tally used to be patched here, row by row, as activities were
// created, recategorised, scheduled and deleted. Explore now counts the
// `['activities']` cache these mutations already patch, so the grid follows
// from the same write that moves the row — there is no second number left to
// keep in step, and no way for one to lag the other.

function useActivityInvalidation() {
  const qc = useQueryClient()
  return (zoneId?: string | null, activityId?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['trip'] }),
      qc.invalidateQueries({ queryKey: ['activities'] }),
      ...(zoneId ? [qc.invalidateQueries({ queryKey: ['zone', zoneId] })] : []),
      ...(activityId ? [qc.invalidateQueries({ queryKey: ['activity', activityId] })] : []),
    ])
}

/**
 * What an activity is, with nothing it says. `name`, `description` and the link
 * URLs are the reservation on a `hotel` — see lib/trip-view.ts — so only their
 * presence travels.
 */
const activityFacts = (input: ActivityInput): ActivityFacts => ({
  category: input.category ?? null,
  scheduled: Boolean(input.day),
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

export function useCreateActivity() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useActivityInvalidation()
  return useMutation({
    meta: { success: 'Activity added' },
    mutationFn: (input: ActivityInput) =>
      api.post<{ activity: Activity }>(path('/activities'), input),
    onSuccess: (data, input) => {
      capture('activity_created', activityFacts(input))
      patchActivities(qc, (rows) => [...rows, data.activity])
      reconcile(invalidate(data.activity.zone_id, data.activity.id))
    },
  })
}

export function useUpdateActivity() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useActivityInvalidation()
  return useMutation({
    meta: { success: 'Activity saved' },
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ActivityInput> }) =>
      api.patch<{ activity: Activity }>(path(`/activities/${id}`), patch),
    onSuccess: (data, { id, patch }) => {
      capture('activity_updated', {
        category: data.activity.category,
        scheduled: data.activity.day !== null,
        fields: changedFields(patch),
      })
      qc.setQueryData(['activity', id], (cached: ActivityDetail | undefined) =>
        cached ? { ...cached, activity: data.activity } : cached
      )
      // Scheduling, un-scheduling and recategorising all move the row between
      // lists; replacing it in the one list every screen reads is the whole
      // move now, tallies included.
      patchActivities(qc, (rows) => replaceById(rows, data.activity))
      reconcile(invalidate(data.activity.zone_id, id))
    },
  })
}

/** `zoneId` is what to refetch and `category` what to report; the request needs the id. */
export function useDeleteActivity(zoneId?: string | null, category?: Category | null) {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useActivityInvalidation()
  return useMutation({
    meta: { success: 'Activity deleted' },
    mutationFn: (activityId: string) => api.delete<void>(path(`/activities/${activityId}`)),
    onSuccess: (_data, activityId) => {
      capture('activity_deleted', { category: category ?? null })
      qc.removeQueries({ queryKey: ['activity', activityId] })
      patchActivities(qc, (rows) => removeById(rows, activityId))
      reconcile(
        invalidate(zoneId),
        // the deleted activity's files re-parent to the trip — rows this
        // cannot build, on a screen the delete did not change
        qc.invalidateQueries({ queryKey: ['trip-files'] })
      )
    },
  })
}

/**
 * The shopping list, re-sorted on the way in: ticking something off sinks it
 * below the still-to-buy, which is the list's whole shape (`compareShopping`).
 */
function patchShopping(
  qc: ReturnType<typeof useQueryClient>,
  apply: (items: ShoppingItem[]) => ShoppingItem[]
) {
  qc.setQueriesData({ queryKey: ['shopping'] }, (cached: ShoppingList | undefined) =>
    cached ? { ...cached, items: apply(cached.items).sort(compareShopping) } : cached
  )
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
    onSuccess: (data, patch) => {
      capture('zone_image_updated', { cleared: patch.image_url === null })
      qc.setQueryData(['zone', zoneId], (cached: ZoneDetail | undefined) =>
        cached ? { ...cached, zone: data.zone } : cached
      )
      // The same photo fronts this zone's card on the journey.
      patchSteps(qc, (steps) =>
        steps.map((step) =>
          step.zone?.id === zoneId
            ? { ...step, zone: { ...step.zone, image_url: data.zone.image_url ?? null } }
            : step
        )
      )
      reconcile(
        qc.invalidateQueries({ queryKey: ['zone', zoneId] }),
        // The photo is on the journey cards too, so the bundle is now stale.
        qc.invalidateQueries({ queryKey: ['trip'] })
      )
    },
  })
}

export function useCreateShoppingItem(tripId: string) {
  const qc = useQueryClient()
  const invalidate = useShoppingInvalidation()
  return useMutation({
    meta: { success: 'Added to the list' },
    mutationFn: (input: ShoppingItemInput) =>
      api.post<{ item: ShoppingItem }>(`/trips/${tripId}/shopping`, input),
    onSuccess: (data, input) => {
      capture('shopping_item_created', {
        category: input.category ?? 'unset',
        has_price: input.price_yen != null,
        has_link: Boolean(input.url),
        has_photo: Boolean(input.image_url),
        has_shop: Boolean(input.shop),
      })
      patchShopping(qc, (items) => [...items, data.item])
      reconcile(invalidate())
    },
  })
}

export function useUpdateShoppingItem() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useShoppingInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ShoppingItemInput> }) =>
      api.patch<{ item: ShoppingItem }>(path(`/shopping/${id}`), patch),
    onSuccess: (data, { patch }) => {
      // Ticking something off is the list's main verb and worth telling apart
      // from editing it, so the flag rides along with the field names.
      capture('shopping_item_updated', { fields: changedFields(patch), bought: patch.bought })
      // The list filters on `bought`, so writing the row back moves it between
      // "to buy" and "bought" on the spot — the one write here done constantly,
      // often mid-shop on a bad connection.
      patchShopping(qc, (items) => replaceById(items, data.item))
      reconcile(invalidate())
    },
  })
}

export function useDeleteShoppingItem() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useShoppingInvalidation()
  return useMutation({
    meta: { success: 'Removed from the list' },
    mutationFn: (id: string) => api.delete<void>(path(`/shopping/${id}`)),
    onSuccess: (_data, id) => {
      capture('shopping_item_deleted')
      patchShopping(qc, (items) => removeById(items, id))
      reconcile(invalidate())
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
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['trip-files'] }),
    qc.invalidateQueries({ queryKey: ['zone'] }),
    qc.invalidateQueries({ queryKey: ['activity'] }),
    qc.invalidateQueries({ queryKey: ['trip'] }),
  ])
}

export function useUploadFile(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Document uploaded' },
    mutationFn: (input: FileUploadInput) =>
      api.post<{ file: TripDocument }>(`/trips/${tripId}/files`, input),
    onSuccess: (data, input) => {
      capture('file_uploaded', {
        parent_type: input.parent.kind,
        mime_type: input.mime_type,
        // base64 runs about 4 characters to every 3 bytes.
        size_kb: Math.round((input.data_base64.length * 3) / 4 / 1024),
      })
      // The upload answers with the row the Documents tab renders — where it
      // hangs, and the name of what it hangs on — so it can simply be added.
      patchCachedFiles(qc, (files) => [...files, data.file])
      reconcile(invalidateFileCaches(qc))
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
      api.patch<{ file: TripDocument }>(path(`/files/${fileId}`), { display_name }),
    onSuccess: (data) => {
      capture('file_renamed', { parent_type: parent?.kind ?? 'trip' })
      patchCachedFiles(qc, (files) => replaceById(files, data.file))
      reconcile(invalidateFileCaches(qc))
    },
  })
}

export function useDeleteFile() {
  const path = useTripPath()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Document deleted' },
    mutationFn: (fileId: string) => api.delete<void>(path(`/files/${fileId}`)),
    onSuccess: (_data, fileId) => {
      patchCachedFiles(qc, (files) => removeById(files, fileId))
      reconcile(invalidateFileCaches(qc))
    },
  })
}

function useStepInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['trip'] })
}

export function useCreateStep(tripId: string) {
  const qc = useQueryClient()
  const invalidate = useStepInvalidation()
  return useMutation({
    meta: { success: 'Destination added' },
    mutationFn: (input: JourneyStepInput) =>
      api.post<{ step: TripStep }>(`/trips/${tripId}/steps`, input),
    onSuccess: (data, input) => {
      capture('journey_step_created', {
        nights: nightsBetween(input.start_date, input.end_date),
        // A step is either an existing zone or somewhere just searched for.
        from_search: !input.zone_id,
      })
      // The card shape, zone and counts included, so the journey can show the
      // stop straight away — sorted in, since the journey runs by date.
      patchSteps(qc, (steps) => [...steps, data.step].sort(compareSteps))
      reconcile(invalidate())
    },
  })
}

export function useUpdateStep() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useStepInvalidation()
  return useMutation({
    meta: { success: 'Journey updated' },
    mutationFn: ({ id, patch }: { id: string; patch: Partial<JourneyStepInput> }) =>
      api.patch<{ step: TripStep }>(path(`/steps/${id}`), patch),
    onSuccess: (data) => {
      // Re-dating a stop moves it: the journey runs in date order.
      patchSteps(qc, (steps) => replaceById(steps, data.step).sort(compareSteps))
      reconcile(invalidate())
    },
  })
}

export function useDeleteStep() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useStepInvalidation()
  return useMutation({
    meta: { success: 'Destination removed' },
    mutationFn: (id: string) => api.delete<void>(path(`/steps/${id}`)),
    onSuccess: (_data, id) => {
      patchSteps(qc, (steps) => removeById(steps, id))
      reconcile(invalidate())
    },
  })
}

interface TipParent {
  zone_id?: string
  activity_id?: string
}

function useTipInvalidation(parent: TipParent) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      ...(parent.zone_id ? [qc.invalidateQueries({ queryKey: ['zone', parent.zone_id] })] : []),
      ...(parent.activity_id
        ? [qc.invalidateQueries({ queryKey: ['activity', parent.activity_id] })]
        : []),
    ])
}

export function useCreateTip(parent: TipParent) {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    meta: { success: 'Tip added' },
    mutationFn: (body: string) => api.post<{ tip: Tip }>(path('/tips'), { body, ...parent }),
    onSuccess: (data) => {
      // Appended, because tips come back in the order they were written.
      patchTips(qc, parent, (tips) => [...tips, data.tip])
      reconcile(invalidate())
    },
  })
}

export function useUpdateTip(parent: TipParent) {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    meta: { success: 'Tip saved' },
    mutationFn: ({ tipId, body }: { tipId: string; body: string }) =>
      api.patch<{ tip: Tip }>(path(`/tips/${tipId}`), { body }),
    onSuccess: (data) => {
      patchTips(qc, parent, (tips) => replaceById(tips, data.tip))
      reconcile(invalidate())
    },
  })
}

export function useDeleteTip(parent: TipParent) {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useTipInvalidation(parent)
  return useMutation({
    meta: { success: 'Tip removed' },
    mutationFn: (tipId: string) => api.delete<void>(path(`/tips/${tipId}`)),
    onSuccess: (_data, tipId) => {
      patchTips(qc, parent, (tips) => removeById(tips, tipId))
      reconcile(invalidate())
    },
  })
}

function useReminderInvalidation() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['reminders'] })
}

export function useCreateReminder(tripId: string) {
  const qc = useQueryClient()
  const invalidate = useReminderInvalidation()
  return useMutation({
    meta: { success: 'Reminder set' },
    mutationFn: (input: ReminderInput) =>
      api.post<{ reminder: Reminder }>(`/trips/${tripId}/reminders`, input),
    onSuccess: (data, input) => {
      capture('reminder_created', {
        hours_ahead: hoursFromNow(input.remind_at),
        has_url: Boolean(input.url),
      })
      patchReminders(qc, (reminders) => [...reminders, data.reminder])
      reconcile(invalidate())
    },
  })
}

export function useUpdateReminder() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useReminderInvalidation()
  return useMutation({
    meta: { success: 'Reminder saved' },
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ReminderInput> }) =>
      api.patch<{ reminder: Reminder }>(path(`/reminders/${id}`), patch),
    onSuccess: (data) => {
      // Re-timing one moves it: the list is soonest first, and `patchReminders`
      // re-sorts on the way in.
      patchReminders(qc, (reminders) => replaceById(reminders, data.reminder))
      reconcile(invalidate())
    },
  })
}

export function useDeleteReminder() {
  const path = useTripPath()
  const qc = useQueryClient()
  const invalidate = useReminderInvalidation()
  return useMutation({
    meta: { success: 'Reminder deleted' },
    mutationFn: (id: string) => api.delete<void>(path(`/reminders/${id}`)),
    onSuccess: (_data, id) => {
      patchReminders(qc, (reminders) => removeById(reminders, id))
      reconcile(invalidate())
    },
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
      return refreshed(qc.invalidateQueries({ queryKey: ['me'] }))
    },
  })
}

export function useCreateTrip() {
  const qc = useQueryClient()
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
      // Appending is not a guess about order: the list is ordered by
      // `created_at` ascending (datastore.supabase.ts `listTripsForUser`), so
      // the trip made a moment ago belongs at the end.
      qc.setQueryData(['trips'], (cached: TripList | undefined) =>
        cached ? { ...cached, trips: [...cached.trips, data.trip] } : cached
      )
      reconcile(invalidate())
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

      // The row in the list is the trip's own fields, `display_title` included
      // — the server computes that and hands it back, so this is its answer
      // rather than a guess. Editing never reorders the list, which is by
      // `created_at`.
      qc.setQueryData(['trips'], (cached: TripList | undefined) =>
        cached ? { ...cached, trips: replaceById(cached.trips, data.trip) } : cached
      )

      // New dates can move journey steps and move or delete activities, and
      // the response says so only when it happened. When it did, the bundle's
      // `steps` and the day plan are no longer what this new `trip` implies,
      // and patching the trip alone would show a range its own stops fall
      // outside of — stale but self-consistent beats half-new. When it didn't,
      // the trip *is* the whole change.
      const rewroteMore = Boolean(data.moved_stops || data.moved || data.deleted)
      const work = [
        invalidate(),
        qc.invalidateQueries({ queryKey: ['trip', tripId] }),
        qc.invalidateQueries({ queryKey: ['itinerary', tripId] }),
      ]
      if (rewroteMore) return refreshed(...work)
      qc.setQueryData(['trip', tripId], (cached: TripBundle | undefined) =>
        cached ? { ...cached, trip: data.trip } : cached
      )
      reconcile(...work)
    },
  })
}

export function useDeleteTrip() {
  const qc = useQueryClient()
  const invalidate = useTripsInvalidation()
  return useMutation({
    meta: { success: 'Trip deleted' },
    mutationFn: (tripId: string) => api.delete<void>(`/trips/${tripId}`),
    onSuccess: (_data, tripId) => {
      capture('trip_deleted')
      // Always safe, as with the other deletes: taking a row out cannot
      // disturb the order of the rows that remain.
      qc.setQueryData(['trips'], (cached: TripList | undefined) =>
        cached ? { ...cached, trips: removeById(cached.trips, tripId) } : cached
      )
      reconcile(invalidate())
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
    onSuccess: (data, input) => {
      capture('trip_member_invited', {
        role: input.role,
        has_email: Boolean(input.email),
        shares_stays: input.can_see_stays,
        shares_flight: input.can_see_flight,
        shares_documents: input.can_see_documents,
        shares_shopping: input.can_see_shopping,
      })
      qc.setQueryData(['invites', tripId], (cached: { invites: TripInvite[] } | undefined) =>
        cached ? { ...cached, invites: [...cached.invites, data.invite] } : cached
      )
      reconcile(qc.invalidateQueries({ queryKey: ['invites', tripId] }))
    },
  })
}

export function useRevokeInvite(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Invitation revoked' },
    mutationFn: (inviteId: string) => api.delete<void>(`/trips/${tripId}/invites/${inviteId}`),
    onSuccess: (_data, inviteId) => {
      capture('trip_invitation_revoked')
      qc.setQueryData(['invites', tripId], (cached: { invites: TripInvite[] } | undefined) =>
        cached ? { ...cached, invites: removeById(cached.invites, inviteId) } : cached
      )
      reconcile(qc.invalidateQueries({ queryKey: ['invites', tripId] }))
    },
  })
}

export function useUpdateMember(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Sharing updated' },
    mutationFn: ({ userId, ...patch }: { userId: string } & Record<string, unknown>) =>
      api.patch<{ member: TripMember }>(`/trips/${tripId}/members/${userId}`, patch),
    onSuccess: (data) => {
      // A member row is keyed by `user_id`, not `id`, so this one cannot use
      // `replaceById` — the switch you just flipped is the whole render.
      qc.setQueryData(['members', tripId], (cached: { members: TripMember[] } | undefined) =>
        cached
          ? {
              ...cached,
              members: cached.members.map((m) =>
                m.user_id === data.member.user_id ? { ...m, ...data.member } : m
              ),
            }
          : cached
      )
      reconcile(qc.invalidateQueries({ queryKey: ['members', tripId] }))
    },
  })
}

export function useRemoveMember(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Removed from the trip' },
    mutationFn: (userId: string) => api.delete<void>(`/trips/${tripId}/members/${userId}`),
    onSuccess: (_data, userId) => {
      capture('trip_member_removed')
      qc.setQueryData(['members', tripId], (cached: { members: TripMember[] } | undefined) =>
        cached ? { ...cached, members: cached.members.filter((m) => m.user_id !== userId) } : cached
      )
      return refreshed(
        qc.invalidateQueries({ queryKey: ['members', tripId] }),
        // Leaving a trip removes it from your list, so that has to refetch too.
        qc.invalidateQueries({ queryKey: ['trips'] })
      )
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
      return refreshed(
        qc.invalidateQueries({ queryKey: ['invitations'] }),
        qc.invalidateQueries({ queryKey: ['trips'] })
      )
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
    onSuccess: () => refreshed(qc.invalidateQueries({ queryKey: ['trips'] })),
  })
}

/**
 * Finish with this conversation; the next question opens a new one.
 *
 * A POST, not a DELETE, and the naming here follows the server's: the old
 * conversation is archived rather than thrown away, and its messages stay in
 * the database against the day something reads them back.
 *
 * The emptied state is **written into the cache** rather than waited for. The
 * server answers `204`, which carries nothing, but what the screen should now
 * show follows entirely from the fact that it succeeded — no live thread, no
 * messages. So the transcript empties on the tap and `reconcile` catches up
 * whatever could not be computed here.
 *
 * **The budget is carried over untouched**, and that is the point rather than
 * an optimisation: `ai_usage` belongs to the account, not to the thread, so
 * putting a conversation away does not give anybody their allowance back.
 * Dropping it to `0` here would put a lie on screen for the second it took the
 * refetch to correct it — and on a train, for a good deal longer than that.
 */
export function useStartNewChat(tripId: string) {
  const path = useTripPath()
  const qc = useQueryClient()
  return useMutation({
    meta: { success: 'Started a new conversation' },
    mutationFn: () => api.post<void>(path('/chat/archive'), {}),
    onSuccess: () => {
      const cached = qc.getQueryData<ChatView>(['chat', tripId])
      capture('chat_thread_started', { previous_message_count: cached?.messages.length ?? 0 })
      if (cached) {
        qc.setQueryData<ChatView>(['chat', tripId], {
          ...cached,
          thread: null,
          messages: [],
        })
      }
      reconcile(qc.invalidateQueries({ queryKey: ['chat', tripId] }))
    },
  })
}
