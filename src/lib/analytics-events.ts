// The event catalogue: every event this app sends, and the properties it may
// carry. Two things live here, and neither talks to PostHog itself — this file
// is pure, so it can be unit-tested without a client.
//
// 1. `AnalyticsEventProperties` — the *names*. `capture` is typed against it,
//    so a typo in an event name, a missing property or a stray extra one is a
//    compile error rather than a chart that quietly never fills in. Analytics
//    fails silently by nature; the type checker is the only thing that notices.
// 2. `sanitizeProperties` — the *values*. Properties describe the shape of what
//    happened (a category, a count, a flag), never trip content. That rule is
//    easy to state and easy to break by reflex — `{ name: place.name }` looks
//    perfectly reasonable at the call site — so it is enforced here rather than
//    trusted, and the offending value never leaves the device.
import type { Category, ExportDetail, ExportFormat, ShoppingCategory, TripRole } from '../api/types'
import type { InstallOutcome, InstallPlatform } from './install'

/**
 * What a trip is, minus everything that identifies it.
 *
 * Attached to `trip_created`/`trip_updated` and registered as super properties
 * for as long as a trip is open, which is what makes "conversions per country"
 * or "how much editing happens mid-trip" answerable at all — an event on its
 * own says what happened but never which kind of trip it happened on.
 *
 * The country is deliberately included: it is the grouping the whole feature
 * exists for, and unlike the trip's name, its description or its travellers it
 * says nothing about *who* is travelling or what they booked.
 */
export type TripFacts = {
  /** Lower-cased and trimmed so 'Japan', 'japan ' and 'JAPAN' are one group. */
  trip_country: string | null
  /** The Essentials split, as a dimension: unknown is not Japan. */
  trip_destination: 'japan' | 'other' | 'unknown'
  trip_length_days: number
  trip_travellers: number
  trip_local_currency: string
  /** Where the trip is relative to today — planning, travelling, or done. */
  trip_phase: 'upcoming' | 'active' | 'past'
}

/**
 * `TripFacts` plus the bits that only make sense for the trip currently open.
 *
 * Both are type aliases rather than interfaces on purpose: only an alias has an
 * implicit index signature, and without one they cannot be handed to the
 * property guard as the `Record<string, unknown>` it works on.
 */
export type TripContextProperties = TripFacts & {
  trip_id: string
  trip_role: TripRole | null
}

/** The keys `setTripContext` registers, so clearing them is exhaustive. */
export const TRIP_CONTEXT_KEYS = [
  'trip_id',
  'trip_role',
  'trip_country',
  'trip_destination',
  'trip_length_days',
  'trip_travellers',
  'trip_local_currency',
  'trip_phase',
] as const satisfies readonly (keyof TripContextProperties)[]

/**
 * Every event, and what it carries. `undefined` means the event has no
 * properties of its own — it still arrives with the trip context registered
 * around it, which is usually the interesting half.
 *
 * Adding an event? Add it here first; `capture` will not accept a name that
 * isn't in this list.
 */
export interface AnalyticsEventProperties {
  // Places
  place_created: PlaceFacts
  place_updated: { category?: Category; fields: string[] }
  place_deleted: { category?: Category }
  zone_image_updated: { cleared: boolean }

  // Shopping
  shopping_item_created: {
    category: ShoppingCategory | 'unset'
    has_price: boolean
    has_link: boolean
    has_photo: boolean
    has_shop: boolean
  }
  shopping_item_updated: { fields: string[]; bought?: boolean }
  shopping_item_deleted: undefined

  // Documents
  file_uploaded: { parent_type: 'trip' | 'zone' | 'place'; mime_type: string; size_kb: number }
  file_renamed: { parent_type: 'trip' | 'zone' | 'place' }

  // The day plan and the journey
  itinerary_item_created: { has_place: boolean; has_time: boolean; highlight: boolean }
  itinerary_item_updated: { fields: string[] }
  itinerary_item_deleted: undefined
  journey_step_created: { nights: number; from_search: boolean }

  // Reminders and push
  reminder_created: { hours_ahead: number; has_url: boolean }
  notifications_enabled: { platform: InstallPlatform }
  notifications_disabled: { platform: InstallPlatform }
  test_notification_sent: { devices: number }

  // Trips
  trip_created: TripFacts & { has_flight: boolean; has_description: boolean }
  trip_updated: TripFacts & { fields: string[] }
  trip_deleted: undefined

  // Exporting the trip (feature 003). Five shapes and nothing else: two enums,
  // two counts and a flag. `included_stays` describes the exporter's view, not
  // any particular place. Declared here before the call site exists, because
  // `capture` is typed against this map and would not compile otherwise.
  trip_exported: {
    format: ExportFormat
    detail: ExportDetail
    place_count: number
    day_count: number
    included_stays: boolean
  }

  // The map (feature 004). Two enums and two counts, and nothing else: which
  // scale was open, how much was on it, and how much could not be. Declared
  // here before either call site exists, for the same reason `trip_exported`
  // was — `capture` is typed against this map and would not compile otherwise.
  //
  // **A coordinate is content and is never sent.** A latitude/longitude pair
  // names a hotel more precisely than the hotel's name does, and the questions
  // these two exist to answer — is the map used, at which scale, how much is
  // missing — are answered by counts (research R9).
  map_opened: { scope: 'zone' | 'trip'; pin_count: number; missing_coords: number }
  map_pin_opened: { category: Category }

  // Explore, connected to the plan (feature 010). Which category was opened,
  // from which end of the connection, and how much was planned under it — the
  // only question worth asking of this feature is whether the connection is
  // used and from which direction.
  //
  // **An activity's title is content and is never sent**, nor is a place name,
  // a day or a city. `sanitizeProperties` would drop a title anyway; the point
  // is not to compose one. `planned_count` is the shape of the answer — how
  // much the traveller found there — and says nothing about what was found.
  explore_planned_opened: {
    category: Category
    /** 'tag' is the pill on the day plan; 'card' is a row in the category list. */
    source: 'tag' | 'card'
    /**
     * How much was planned under that category in that city. Absent from a
     * `tag` — the day plan knows the activity in front of it and not the city's
     * whole plan, and a made-up number is worse than a missing one.
     */
    planned_count?: number
  }

  // Sharing
  trip_member_invited: {
    role: 'partner' | 'viewer'
    has_email: boolean
    shares_stays: boolean
    shares_flight: boolean
    shares_documents: boolean
    shares_shopping: boolean
  }
  trip_invitation_revoked: undefined
  trip_member_removed: undefined
  invitation_accepted: undefined
  invitation_declined: undefined

  // Account
  user_signed_in: { method: string }
  /** Only the account's creation; the session that follows is a sign-in. */
  user_signed_up: { method: string }
  user_signed_out: undefined
  terms_accepted: undefined

  // Installing to the Home Screen
  install_hint_shown: { platform: InstallPlatform }
  install_hint_dismissed: { platform: InstallPlatform }
  install_help_opened: { platform: InstallPlatform; source: 'banner' | 'essentials' }
  install_prompt_answered: {
    platform: InstallPlatform
    outcome: InstallOutcome
    source: 'banner' | 'help'
  }
}

export type PlaceFacts = {
  category: Category
  has_address: boolean
  has_coords: boolean
  has_photo: boolean
  links: number
}

export type AnalyticsEvent = keyof AnalyticsEventProperties

// --- the value guard ---------------------------------------------------------

/**
 * Keys whose value is free text somewhere in this app, and would therefore be
 * trip content: a hotel's name, the note on a shopping item, a traveller's
 * email. Dropped outright rather than truncated — half a reservation is still
 * a reservation. `has_note`/`shop_id`-style keys are unaffected: the match is
 * exact, and a boolean or an id is never the secret.
 */
const CONTENT_KEYS = new Set([
  'name',
  'name_ja',
  'title',
  'body',
  'note',
  'description',
  'summary',
  'address',
  'email',
  'shop',
  'url',
  'link',
  'query',
  'text',
  'display_name',
  'display_title',
  'booking_ref',
])

/**
 * Anything longer than this is free text by accident — every legitimate
 * property here is a category, a code, a country or a field name.
 */
const MAX_STRING_LENGTH = 64

/** What a value may be once it reaches PostHog. */
type Scalar = string | number | boolean | null

const isScalar = (value: unknown): value is Scalar =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value))

export interface SanitizedProperties {
  properties: Record<string, Scalar | Scalar[]>
  /** One line per rejected value, for the DEV warning. Empty when all is well. */
  problems: string[]
}

/**
 * Strip anything a property must never be, and say what was stripped.
 *
 * Never throws and never drops the event: an analytics call that breaks a save
 * would be far worse than a missing property. In DEV the problems are printed;
 * in production the value is simply gone.
 */
export function sanitizeProperties(properties: Record<string, unknown>): SanitizedProperties {
  const clean: Record<string, Scalar | Scalar[]> = {}
  const problems: string[] = []

  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue // an absent property, not a null one
    if (CONTENT_KEYS.has(key)) {
      problems.push(`dropped "${key}": that key names trip content, which never leaves the device`)
      continue
    }
    if (Array.isArray(value)) {
      if (!value.every(isScalar)) {
        problems.push(`dropped "${key}": arrays may only hold strings, numbers or booleans`)
        continue
      }
      const long = value.find((item) => typeof item === 'string' && item.length > MAX_STRING_LENGTH)
      if (long !== undefined) {
        problems.push(`dropped "${key}": an item is over ${MAX_STRING_LENGTH} chars — free text?`)
        continue
      }
      clean[key] = value as Scalar[]
      continue
    }
    if (!isScalar(value)) {
      problems.push(`dropped "${key}": ${typeof value} is not a property value`)
      continue
    }
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      problems.push(`dropped "${key}": over ${MAX_STRING_LENGTH} chars — free text, not a shape`)
      continue
    }
    clean[key] = value
  }

  return { properties: clean, problems }
}
