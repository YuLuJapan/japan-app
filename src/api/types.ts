// Mirrors contracts/api.md response shapes.
export const CATEGORIES = ['hotel', 'attraction', 'food', 'shopping', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, { en: string; ja: string }> = {
  hotel: { en: 'Hotels', ja: '宿泊' },
  attraction: { en: 'Attractions', ja: '観光' },
  food: { en: 'Food & Cafes', ja: '食事' },
  shopping: { en: 'Shopping', ja: '買い物' },
  other: { en: 'More places', ja: 'その他' },
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
  place_counts: Record<Category, number>
}

export interface TripStep {
  id: string
  position: number
  start_date: string
  end_date: string
  zone: ZoneSummary | null
}

export interface TripBundle {
  trip: Trip
  steps: TripStep[]
  trip_files_count: number
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

export interface ZoneDetail {
  zone: {
    id: string
    name: string
    name_ja: string | null
    summary: string | null
    image_url?: string | null
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
