// One turn, as state a screen can render.
//
// Extracted from the chat page so the page is composition and this is the state
// machine: what is being drawn, whether it is still arriving, and what to say if
// it stopped early. Testable on its own, and the page no longer juggles six
// pieces of state inside one callback.

import { useCallback, useEffect, useRef, useState } from 'react'
import { streamChatTurn, type ChatEvent } from '../api/chat'
import { ApiError } from '../api/client'
import { capture } from './posthog'

export interface ChatTurn {
  /**
   * The question being asked right now, or null when no turn is in flight.
   *
   * The screen draws it immediately. The server does persist it before calling
   * the model, but the transcript is not re-read until the turn is over — so
   * without this, what you typed disappears from the moment you send it until
   * the answer has finished arriving, which is the whole time you are waiting.
   */
  question: string | null
  /** The answer being drawn, or null when no turn is in flight. */
  answer: string | null
  /** The model is on the web. Ends the moment the first text arrives. */
  searching: boolean
  /** The turn stopped at its bound with more to say. */
  incomplete: boolean
  error: string | null
  sending: boolean
  /**
   * Ask, and draw the answer as it arrives.
   *
   * Resolves `false` when the question never reached the server — the caller
   * still has it, and can put it back in the box rather than making somebody
   * retype it.
   */
  ask(question: string): Promise<boolean>
}

interface Options {
  /** Reported as a shape on `chat_turn_started`; never the history itself. */
  hasHistory: boolean
  /**
   * Re-read the conversation once the turn is over.
   *
   * Awaited before the locally streamed answer is dropped, so the transcript has
   * already replaced it and the screen never blinks empty between the two.
   */
  refresh: () => Promise<unknown>
}

export function useChatTurn(tripId: string, { hasHistory, refresh }: Options): ChatTurn {
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [incomplete, setIncomplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // Leaving mid-turn stops the read rather than leaving it running against an
  // unmounted screen. Nothing is lost: the answer is being persisted server-side
  // and is there on the next visit.
  useEffect(() => () => abort.current?.abort(), [])

  const ask = useCallback(
    async (asked: string): Promise<boolean> => {
      setQuestion(asked)
      setAnswer('')
      setError(null)
      setIncomplete(false)
      setSearching(false)
      setSending(true)
      capture('chat_turn_started', { has_history: hasHistory })

      const report = turnReport()
      const controller = new AbortController()
      abort.current = controller
      let delivered = true

      const apply = (event: ChatEvent) => {
        if (event.type === 'text') {
          // Append, never replace: the answer arrives in fragments.
          setAnswer((prev) => (prev ?? '') + event.text)
          setSearching(false)
        } else if (event.type === 'searching') {
          setSearching(true)
        } else if (event.type === 'done') {
          setIncomplete(!event.complete)
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }

      try {
        for await (const event of streamChatTurn(tripId, asked, controller.signal)) {
          report.saw(event)
          apply(event)
        }
      } catch (err) {
        delivered = false
        report.failed()
        setError(messageFor(err))
      } finally {
        setSending(false)
        abort.current = null
        capture('chat_turn_completed', report.finish())
        // Both are dropped together, and only once the transcript holding the
        // real pair has arrived — dropping either one earlier is a gap in the
        // conversation where a message used to be.
        await refresh()
        setQuestion(null)
        setAnswer(null)
      }

      return delivered
    },
    [hasHistory, refresh, tripId]
  )

  return { question, answer, searching, incomplete, error, sending, ask }
}

/**
 * What the turn is worth reporting, collected in one place.
 *
 * Shapes only — no question, no answer, no search query. A transcript is trip
 * content, and more of it than anything else this app measures.
 */
function turnReport() {
  const started = Date.now()
  let iterations = 1
  let usedWeb = false
  let outcome: 'ok' | 'capped' | 'error' = 'ok'

  return {
    saw(event: ChatEvent) {
      if (event.type === 'searching') {
        usedWeb = true
        iterations += 1
      }
      if (event.type === 'done' && !event.complete) outcome = 'capped'
      if (event.type === 'error') outcome = 'error'
    },
    failed() {
      outcome = 'error'
    },
    finish() {
      return { outcome, iterations, duration_ms: Date.now() - started, used_web: usedWeb }
    },
  }
}

const messageFor = (err: unknown) =>
  err instanceof ApiError ? (err.details?.join(' · ') ?? err.message) : 'Something went wrong'
