// What the bottom tabs are called, as a function of how many there are.
//
// The bar is fixed, cannot scroll, and already carries up to five (`Shopping`
// and `Documents` are conditional). A sixth gives each tab about 57px at 375px
// and less at 320px, where the current words stop being readable — so at six,
// three of them shorten.
//
// **Shortening is a consequence of the count, not a separate change** (research
// R8). That is what makes `show-map` a total rollback: with the flag off there
// are at most five tabs, so today's labels return on their own, with no second
// thing to remember to undo. It also means a member whose view already drops
// Documents keeps the long labels even with the map on — they only have five.
//
// `Journey`, `Shopping` and `Map` are short enough already and never change;
// renaming them at six would be a change nobody asked for.

export interface NavLabels {
  journey: string
  shopping: string
  reminders: string
  essentials: string
  docs: string
  map: string
}

const ROOMY: NavLabels = {
  journey: 'Journey',
  shopping: 'Shopping',
  reminders: 'Reminders',
  essentials: 'Essentials',
  docs: 'Documents',
  map: 'Map',
}

const TIGHT: NavLabels = { ...ROOMY, reminders: 'Alerts', essentials: 'Info', docs: 'Docs' }

/** Where the bar stops fitting the long words on a 320px phone. */
const CROWDED_AT = 6

/** Build the tab list first, then ask it how many there are. */
export const navLabels = (tabCount: number): NavLabels => (tabCount >= CROWDED_AT ? TIGHT : ROOMY)
