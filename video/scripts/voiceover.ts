// Generates the voiceover, one clip per line of the script.
//
//   ELEVENLABS_API_KEY=... node --experimental-strip-types scripts/voiceover.ts
//
// Per line rather than one long read, for two reasons: each clip can sit
// exactly on the scene it belongs to, and the script's timings can then be
// derived from the audio that actually exists instead of from a guess. The
// script prints the measured durations so `src/onward/script.ts` can be
// retimed to them.
//
// The key is read from the environment and never written anywhere.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCRIPT } from '../src/onward/script.ts'

const KEY = process.env.ELEVENLABS_API_KEY
const OUT = fileURLToPath(new URL('../public/voiceover/', import.meta.url))

/** Calm, unhurried, mid-pace — a product video, not an advert. */
const SETTINGS = { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true }
const MODEL = 'eleven_multilingual_v2'

async function pickVoice(): Promise<{ id: string; name: string }> {
  if (process.env.ELEVENLABS_VOICE_ID) {
    return { id: process.env.ELEVENLABS_VOICE_ID, name: '(from ELEVENLABS_VOICE_ID)' }
  }
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': KEY! },
  })
  if (!res.ok) throw new Error(`listing voices failed: ${res.status} ${await res.text()}`)
  const { voices } = (await res.json()) as { voices: { voice_id: string; name: string }[] }
  if (!voices?.length) throw new Error('this account has no voices')
  return { id: voices[0].voice_id, name: voices[0].name }
}

async function speak(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
  })
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  if (!KEY) {
    console.error('ELEVENLABS_API_KEY is not set — nothing to do.')
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })
  const voice = await pickVoice()
  console.log(`voice: ${voice.name} (${voice.id})\n`)

  for (const [i, line] of SCRIPT.entries()) {
    const id = String(i).padStart(2, '0')
    const audio = await speak(voice.id, line.text)
    writeFileSync(path.join(OUT, `${id}.mp3`), audio)
    console.log(`${id}  ${(audio.length / 1024).toFixed(0).padStart(4)} KB  ${line.text}`)
  }

  console.log(`\n${SCRIPT.length} clips → public/voiceover/`)
  console.log('Next: npm run retime, then re-render.')
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
