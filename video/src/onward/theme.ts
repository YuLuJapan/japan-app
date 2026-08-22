// The app's own tokens, so the video and the product cannot drift apart.
// Mirrors tailwind.config.ts — if those change, change these.
export const COLORS = {
  canvas: '#FAF8F5',
  ink: '#17150F',
  muted: '#7A756B',
  line: '#EFEAE2',
  brand: '#F1543F',
  brand600: '#E3402F',
  sun: '#F9873F',
} as const

export const FPS = 30
/** Square: LinkedIn and Facebook both give a 1:1 post full feed width. */
export const SIZE = 1080
