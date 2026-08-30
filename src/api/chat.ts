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
  const token = getAccessCode()
  const path = `/trips/${tripId}/chat/messages`

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
      signal,
    })
  } catch (err) {
    // An abort is the caller leaving the screen, not a failure worth reporting.
    if (err instanceof DOMException && err.name === 'AbortError') return
    throw new ApiError(
      0,
      'NETWORK',
      'No connection — check your internet and retry',
      undefined,
      'POST',
      path
    )
  }

  if (!res.ok) {
    const envelope = (await res.json().catch(() => null))?.error ?? {}
    if (res.status === 401) {
      clearAccessCode()
      window.location.assign('/gate')
    }
    throw new ApiError(
      res.status,
      envelope.code ?? 'INTERNAL',
      envelope.message ?? 'Request failed',
      envelope.details,
      'POST',
      path
    )
  }

  if (!res.body) {
    // No stream to read. Nothing was said, so say that rather than appearing to
    // succeed with an empty answer.
    yield { type: 'error', code: 'INTERNAL', message: 'The answer did not arrive' }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // `stream: true` matters: a chunk boundary can fall inside a multi-byte
      // character, and decoding each chunk independently would turn a Japanese
      // place name into replacement characters at random.
      buffer += decoder.decode(value, { stream: true })

      // Frames are separated by a blank line. A partial frame stays in the
      // buffer until the rest of it arrives.
      let split = buffer.indexOf('\n\n')
      while (split !== -1) {
        const frame = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const event = parseFrame(frame)
        if (event) yield event
        split = buffer.indexOf('\n\n')
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    yield { type: 'error', code: 'NETWORK', message: 'The connection dropped mid-answer' }
  } finally {
    reader.releaseLock()
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
