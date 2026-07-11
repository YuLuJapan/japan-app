// Mirrors contracts/api.md response shapes.
export const CATEGORIES = ['hotel', 'attraction', 'food', 'shopping', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_META: Record<
  Category,
  { label: string; singular: string; icon: string; color: string }
> = {
  hotel: { label: 'Stays', singular: 'Stay', icon: '🛏️', color: 'bg-violet-100 text-violet-700' },
  attraction: { label: 'Things to do', singular: 'Attraction', icon: '📸', color: 'bg-sky-100 text-sky-700' },
  food: { label: 'Food & Cafés', singular: 'Food spot', icon: '🍜', color: 'bg-amber-100 text-amber-700' },
  shopping: { label: 'Shopping', singular: 'Shop', icon: '🛍️', color: 'bg-pink-100 text-pink-700' },
  other: { label: 'More', singular: 'Place', icon: '📍', color: 'bg-emerald-100 text-emerald-700' },
}

export interface Trip {
  id: string
  name: string
  start_date: string
  end_date: string
  description: string | null
}

export interface ZoneSummary {
  id: string
  name: string
  name_ja: string | null
  summary: string | null
  image_url?: string | null
  lat?: number | null
  lng?: number | null
  place_counts: Record<Category, number>
}

export interface TripStep {
  id: string
  position: number
  start_date: string
  end_date: string
  zone: ZoneSummary | null
}

export interface FlightLeg {
  flight_no: string
  from: string
  to: string
}

export interface FlightInfo {
  airline: string
  booking_ref: string
  depart_at: string // ISO instant of first departure
  legs: FlightLeg[]
}

export interface TripBundle {
  trip: Trip
  steps: TripStep[]
  trip_files_count: number
  flight?: FlightInfo
}

export interface Tip {
  id: string
  zone_id?: string | null
  place_id?: string | null
  body: string
}

export interface FileMeta {
  id: string
  display_name: string
  mime_type: string
  size_bytes: number
}

export type FileParent =
  | { kind: 'trip' }
  | { kind: 'zone'; id: string }
  | { kind: 'place'; id: string }

export interface TripDocument extends FileMeta {
  attached_to: { kind: 'trip' | 'zone' | 'place'; id: string; name: string }
}

export interface FileUploadInput {
  parent: FileParent
  display_name: string
  mime_type: string
  data_base64: string
}

export interface ZoneDetail {
  zone: {
    id: string
    name: string
    name_ja: string | null
    summary: string | null
    image_url?: string | null
    lat?: number | null
    lng?: number | null
  }
  tips: Tip[]
  files: FileMeta[]
  place_counts: Record<Category, number>
}

export interface PlaceListItem {
  id: string
  name: string
  name_ja: string | null
  category: Category
  summary_line: string
  image_url?: string | null
}

export interface PlaceLink {
  label: string
  url: string
}

export interface Place {
  id: string
  zone_id: string
  category: Category
  name: string
  name_ja: string | null
  description: string | null
  address: string | null
  links: PlaceLink[]
  image_url?: string | null
}

export interface PlaceDetail {
  place: Place
  tips: Tip[]
  files: FileMeta[]
}

export interface PlaceInput {
  zone_id: string
  category: Category
  name: string
  name_ja?: string | null
  description?: string | null
  address?: string | null
  links?: PlaceLink[]
  image_url?: string | null
}

export interface ItineraryItem {
  id: string
  trip_id: string
  zone_id: string | null
  place_id: string | null
  day: string // YYYY-MM-DD
  start_time: string | null // HH:MM (24h) or null
  title: string
  note: string | null
  position: number
}

export interface ItineraryItemInput {
  zone_id?: string | null
  place_id?: string | null
  day: string
  start_time?: string | null
  title: string
  note?: string | null
  position?: number
}

export interface Rates {
  base: 'JPY'
  date: string
  usd: number // 1 JPY in USD
  ils: number // 1 JPY in ILS
}

export interface SearchResult {
  type: 'place' | 'zone' | 'tip'
  id: string
  title: string
  subtitle: string
  href: string
}
