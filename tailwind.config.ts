import type { Config } from 'tailwindcss'

// Palette + type matched to the Onward redesign (Onward Redesign Options.dc.html,
// options 1e/1f + 1g): rice-paper canvas, nori ink, tuna-coral accent.
//
// The display face is Bricolage Grotesque, as the redesign draws it. The
// previous build deliberately substituted Outfit — lighter headings, capped at
// bold (700) — but the redesign leans on Bricolage's extrabold (800) for the
// hero title and the countdown numerals, and Outfit has no 800 to give. The
// substitution went with it.
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
          // The deep end of the coral family, dark enough to carry white text
          // at 14px — the failure toast is the only thing that needs it.
          800: '#9E2B1E',
        },
        sun: '#F9873F',
        ocean: '#2bb6c4',
        // The one colour the prototype never needed: "this worked". Coral
        // already carries every warning in the app, so a confirmation cannot
        // borrow it. Kept herbal and slightly warm (matcha rather than mint)
        // so it sits on the rice-paper canvas next to the coral instead of
        // arguing with it.
        leaf: {
          DEFAULT: '#157A57',
          600: '#0C5B41',
        },
        // The redesign's warm neutral ramp, between `line` and `ink`. Named for
        // what they are rather than where they were first used, because each is
        // load-bearing in several places: `sand` is the countdown numeral tile
        // and every quiet pill, `blush` the coral wash behind a highlighted day
        // or an expanded chevron, `dust` the inactive timeline dot, `stone` the
        // ring on an unselected day chip, `faint` the small-caps label under it.
        sand: '#F1EDE6',
        blush: '#FDECE8',
        stone: '#E7E1D7',
        dust: '#DDD6CA',
        faint: '#A29C90',
        hush: '#C9C2B6',
        // Two body weights below `ink`: `slate` for a paragraph, `graphite` for
        // a numeral or a value that should still read as content, not chrome.
        slate: '#57534B',
        graphite: '#3D3931',
        // One colour pair per place category, replacing the stock Tailwind
        // violet/sky/amber/pink. `DEFAULT` is the map pin and the timeline dot;
        // `tint` is the tile behind the icon and the tag pill. Muted and warm so
        // four of them can sit in one 2×2 grid without competing with the coral,
        // which stays reserved for "now" and for actions.
        stay: { DEFAULT: '#4C6273', tint: '#EAEEF0' },
        // `do` would be a reserved word in the `do:` shorthand Tailwind
        // generates, so the attraction colour keeps the entity's own name.
        sight: { DEFAULT: '#6E8248', tint: '#EDF1E7' },
        table: { DEFAULT: '#B07A62', tint: '#F5EAE5' },
        market: { DEFAULT: '#C9A15A', tint: '#F3EEE3' },
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
      // A short segment falling down the hero's hairline cue — the quietest
      // way to say "downwards" without a bouncing arrow.
      keyframes: {
        trace: {
          '0%': { transform: 'translateY(-120%)' },
          '100%': { transform: 'translateY(320%)' },
        },
        // A toast arrives from the direction of the thumb that caused it.
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        // The bar under a toast is its remaining life, drawn rather than
        // guessed at — the duration is set per toast from lib/toast.
        'toast-timer': {
          '0%': { transform: 'scaleX(1)' },
          '100%': { transform: 'scaleX(0)' },
        },
      },
      animation: {
        trace: 'trace 2.4s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'toast-in': 'toast-in 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-timer': 'toast-timer linear forwards',
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
