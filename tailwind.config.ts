import type { Config } from 'tailwindcss'

// Palette + type matched to the Onward design prototype (design/Onward Trip
// App.dc.html): rice-paper canvas, nori ink, tuna-coral accent. (Matched to
// the prototype 2026-08-08 — see chat1.md for the design reasoning.)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FAF8F5',
        ink: '#17150F',
        muted: '#7A756B',
        line: '#EFEAE2',
        brand: {
          DEFAULT: '#F1543F',
          400: '#F9873F',
          600: '#E3402F',
          700: '#C0392B',
        },
        sun: '#F9873F',
        ocean: '#2bb6c4',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 6px 20px -8px rgba(22,26,34,0.18)',
        pop: '0 12px 32px -10px rgba(22,26,34,0.28)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      maxWidth: {
        app: '30rem',
      },
    },
  },
  plugins: [],
} satisfies Config
