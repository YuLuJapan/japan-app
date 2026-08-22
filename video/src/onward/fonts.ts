// The app's two typefaces, as local files.
//
// Loaded from `public/` rather than Google Fonts on purpose: the render
// browser has no route to fonts.gstatic.com, and a video that silently falls
// back to a system font is not the product's typography. Local files also make
// a render reproducible offline.
import { loadFont } from '@remotion/fonts'
import { staticFile } from 'remotion'

/** Headlines and captions. */
export const DISPLAY = 'Outfit'
/** Labels and supporting copy. */
export const BODY = 'Plus Jakarta Sans'

loadFont({ family: DISPLAY, url: staticFile('fonts/Outfit.woff2'), weight: '700' })
loadFont({ family: BODY, url: staticFile('fonts/PlusJakartaSans.woff2'), weight: '700' })
