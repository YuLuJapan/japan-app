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
      // A chevron that dips and comes back — enough to read as "there is more
      // below" without the jitter of `animate-bounce`.
      keyframes: {
        nudge: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(5px)' },
        },
      },
      animation: {
        nudge: 'nudge 1.8s ease-in-out infinite',
      },
      // Tailwind v3's default scale stops offering halves after 3.5, so the
      // `px-4.5` the card padding wants silently generates nothing (v4 has it
      // built in). Defining it keeps 18px available as a real token instead of
      // a dead class that quietly collapses padding to zero.
      spacing: {
        4.5: '1.125rem',
      },
    },
  },
  plugins: [],
} satisfies Config
