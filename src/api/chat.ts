// Reading a streamed turn.
//
// This does not go through `api.post` because the response is not JSON — it is
// a sequence of events arriving over seconds, and the point of the whole
// feature is that the screen shows them as they land rather than after a
// silence (FR-012).
//
// **`EventSource` cannot be used**, which is worth stating because it is the
// obvious first thought. It issues a GET and cannot set an `Authorization`
// header, while every call in this app is bearer-authenticated and this one is
// a POST carrying the question. Putting the token in a query string to satisfy
// the API would put it in every access log along the way.
//
// So: `fetch` plus a `ReadableStream` reader, reusing `getAccessCode()` and the
// error-envelope normalisation from client.ts so a 401 here behaves exactly
// like a 401 anywhere else.

import { ApiError, clearAccessCode, getAccessCode } from './client'

/**
 * What a turn emits. The server's own union, not the model provider's — a
 * vendor change must not reach React (server/src/lib/ai/types.ts).
 */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'searching'; query?: string }
  | { type: 'usage'; usage: Record<string, number> }
  | { type: 'done'; complete: boolean }
  | { type: 'error'; code: string; message: string }

/**
 * Send a question and yield the turn's events as they arrive.
 *
 * Refusals — an empty question, the monthly cap, a turn already running — come
 * back as ordinary error envelopes before the stream opens, and are thrown as
 * `ApiError` so the screen can tell them apart by `status`. Once the stream is
 * open the status is already 200, and a failure arrives as an `error` event
 * instead: the caller keeps whatever text it has already drawn.
 */
export async function* streamChatTurn(
  tripId: string,
  content: string,
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const path = `/trips/${tripId}/chat/messages`
  const res = await postTurn(path, content, signal)
  if (!res) return // aborted before it began — the caller left the screen

  if (!res.ok) throw await apiErrorFrom(res, path)

  if (!res.body) {
    // No stream to read. Say so rather than appearing to succeed with an empty
    // answer.
    yield { type: 'error', code: 'INTERNAL', message: 'The answer did not arrive' }
    return
  }

  yield* readEvents(res.body)
}

/** The request itself. `null` when the caller aborted rather than when it failed. */
async function postTurn(
  path: string,
  content: string,
  signal?: AbortSignal
): Promise<Response | null> {
  const token = getAccessCode()
  try {
    return await fetch(`/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
      signal,
    })
  } catch (err) {
    if (isAbort(err)) return null
    throw new ApiError(
      0,
      'NETWORK',
      'No connection — check your internet and retry',
      undefined,
      'POST',
      path
    )
  }
}

/** A refused turn, normalised into the error every other call in the app throws. */
async function apiErrorFrom(res: Response, path: string): Promise<ApiError> {
  const envelope = (await res.json().catch(() => null))?.error ?? {}
  if (res.status === 401) {
    clearAccessCode()
    window.location.assign('/gate')
  }
  return new ApiError(
    res.status,
    envelope.code ?? 'INTERNAL',
    envelope.message ?? 'Request failed',
    envelope.details,
    'POST',
    path
  )
}

/** The body, read frame by frame. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader()
  const frames = frameBuffer()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      for (const frame of frames.push(value)) {
        const event = parseFrame(frame)
        if (event) yield event
      }
    }
  } catch (err) {
    if (isAbort(err)) return
    yield { type: 'error', code: 'NETWORK', message: 'The connection dropped mid-answer' }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Chunks in, whole frames out.
 *
 * Two boundaries have to be respected and neither lines up with a chunk. A
 * multi-byte character can be split across chunks, which is what `stream: true`
 * on the decoder is for — decoding each chunk alone would turn a Japanese place
 * name into replacement characters at random. And a frame ends at a blank line,
 * which may not have arrived yet, so a partial one waits here for the rest.
 */
function frameBuffer() {
  const decoder = new TextDecoder()
  let buffer = ''

  return {
    push(chunk: Uint8Array): string[] {
      buffer += decoder.decode(chunk, { stream: true })
      const frames: string[] = []
      for (let split = buffer.indexOf('\n\n'); split !== -1; split = buffer.indexOf('\n\n')) {
        frames.push(buffer.slice(0, split))
        buffer = buffer.slice(split + 2)
      }
      return frames
    },
  }
}

function parseFrame(frame: string): ChatEvent | null {
  const line = frame.split('\n').find((l) => l.startsWith('data: '))
  if (!line) return null
  try {
    return JSON.parse(line.slice(6)) as ChatEvent
  } catch {
    // A malformed frame is not worth taking the answer down for — the events
    // around it are still good, and the turn's own `done` still arrives.
    return null
  }
}

/** The caller left the screen. Not a failure worth reporting. */
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'
