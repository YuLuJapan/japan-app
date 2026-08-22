# The Onward product video

A 1080×1080 film for LinkedIn and Facebook feeds. Every screen in it is the
**real app**, captured from the production build — not a mockup. Re-run the
capture and the video updates itself, which is the whole reason for doing it
that way.

Kept out of the app's dependency tree on purpose: nothing in here ships.

## Rendering it

```bash
cd video && npm install

# 1. Screens. Needs the app built and the capture rig running:
#      (repo root) npm run build && npx tsx scripts/demo-server.ts
npm run capture

# 2. The voiceover (optional — the video renders silent without it)
ELEVENLABS_API_KEY=... node --experimental-strip-types scripts/voiceover.ts

# 3. The master
./render.sh render OnwardPromo out/onward-promo.mp4 --codec=h264 --crf=18
```

`./render.sh` wraps `npx remotion` with the Chromium flags this container
needs — Remotion's own browser download host is off the network allowlist, and
the bundled Chromium wants the newer headless mode. On a normal machine
`npx remotion render` is enough.

## What's where

| | |
| --- | --- |
| `src/onward/script.ts` | **The script.** One source for the voiceover *and* the burned-in captions, so the two cannot drift — which is the usual way a "works muted" video stops working muted. Retiming the film means editing this table. |
| `src/onward/theme.ts` | The app's colour tokens, mirrored from `tailwind.config.ts`. |
| `src/onward/fonts.ts` | Outfit and Plus Jakarta Sans as local files, so a render never falls back to a system font. |
| `src/onward/PhoneFrame.tsx` | The device, and the `focus` rule that picks which part of a tall screenshot is in view. |
| `src/OnwardPromo.tsx` | The film. |
| `scripts/capture.mjs` | Drives the real app with Playwright. Refuses to save a frame showing an error card. |
| `scripts/voiceover.ts` | ElevenLabs TTS, one clip per line. Reads the key from the environment and never writes it anywhere. |

## Music

There is none, deliberately — a licensed track is yours to choose. Drop one in
and add an `<Audio>` next to the voiceover in `OnwardPromo.tsx`, or lay it over
the exported file in any editor.
