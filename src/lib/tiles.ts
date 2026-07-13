// Base map tile source shared by TripMap and ZoneMap.
//
// Default (no key configured): CARTO Voyager raster tiles — free, no API
// key, but labels render in the local language (Japanese for Japan).
//
// If VITE_MAPTILER_KEY is set: MapTiler's raster tiles with `language=en`,
// which render street/place labels in English where OpenStreetMap has an
// English name for them (small residential streets often don't). Get a free
// key (no credit card, generous free tier) at
// https://cloud.maptiler.com/account/keys/ and set it in `.env.local`.
export function tileLayer(): { url: string; attribution: string } {
  const key = import.meta.env.VITE_MAPTILER_KEY
  if (key) {
    return {
      url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${key}&language=en`,
      attribution:
        '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
    }
  }
  return {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '© <a href="https://carto.com/attributions" target="_blank">CARTO</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
  }
}
