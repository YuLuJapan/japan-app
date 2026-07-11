import type { Config } from 'tailwindcss'

// Modern, vibrant travel-app palette: warm coral primary, sunset gradient,
// clean off-white canvas, near-black ink. (Redesigned 2026-07-11.)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f6f7f9',
        ink: '#161a22',
        muted: '#6b7280',
        line: '#e7e9ee',
        brand: {
          DEFAULT: '#ff5a4d',
          600: '#f0392a',
          700: '#d92c1e',
        },
        sun: '#ff9d3c',
        ocean: '#2bb6c4',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
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
