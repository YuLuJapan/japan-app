// Chat: ask about the trip.
//
// Read-only in this phase — it answers questions and changes nothing, which is
// why there is no confirmation step anywhere on this screen. When 006 adds
// writes, the approval gate lands here.
//
// Two states are load-bearing and easy to get wrong:
//
//  - **Streaming.** The answer is appended fragment by fragment, never
//    replaced. A slow turn has to read as working rather than as stuck, which
//    is the whole reason the endpoint streams at all.
//  - **Offline.** The transcript stays readable and the composer says chat
//    needs a signal. It does not spin: a spinner on a train is a lie that lasts
//    for hours.

import { useCallback, useEffect, useRef, useState } from 'react'
import { streamChatTurn, type ChatEvent } from '../api/chat'
import { ApiError } from '../api/client'
import { useChat } from '../api/hooks'
import type { ChatMessageView } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { capture } from '../lib/posthog'
import { useTripId } from '../lib/trip'

/** What the composer is allowed to do right now, and why. */
type Composer =
  | { state: 'ready' }
  | { state: 'sending' }
  | { state: 'offline' }
  | { state: 'blocked'; resumesOn: string | null }
  | { state: 'busy' }

export default function TripChat() {
  const tripId = useTripId()
  const chat = useChat(tripId)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [incomplete, setIncomplete] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  // The partner may have asked something since this tab was last looked at.
  // Focus is the moment that matters — coming back to the phone — and after a
  // send, which is when the transcript is known to have changed. Deliberately
  // not a realtime subscription: more moving parts than two people need.
  useEffect(() => {
    const refresh = () => void chat.refetch()
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [chat])

  // Leaving mid-turn should stop the read, not leave it running against an
  // unmounted screen. The answer is already being persisted server-side, so
  // nothing is lost — it is there on the next visit.
  useEffect(() => () => abort.current?.abort(), [])

  const messages = chat.data?.messages ?? []
  const budget = chat.data?.budget

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, answer])

  const send = useCallback(async () => {
    const question = draft.trim()
    if (!question || sending) return

    setDraft('')
    setAnswer('')
    setError(null)
    setIncomplete(false)
    setSearching(false)
    setSending(true)
    capture('chat_turn_started', { has_history: messages.length > 0 })

    const started = Date.now()
    let iterations = 1
    let usedWeb = false
    let outcome: 'ok' | 'capped' | 'error' = 'ok'
    const controller = new AbortController()
    abort.current = controller

    try {
      for await (const event of streamChatTurn(tripId, question, controller.signal)) {
        applyEvent(event)
        if (event.type === 'searching') {
          usedWeb = true
          iterations += 1
        }
        if (event.type === 'done' && !event.complete) outcome = 'capped'
        if (event.type === 'error') outcome = 'error'
      }
    } catch (err) {
      outcome = 'error'
      setError(
        err instanceof ApiError ? (err.details?.join(' · ') ?? err.message) : 'Something went wrong'
      )
      // The question never reached the server, so put it back in the box rather
      // than making them retype it.
      setDraft(question)
    } finally {
      setSending(false)
      abort.current = null
      capture('chat_turn_completed', {
        outcome,
        iterations,
        duration_ms: Date.now() - started,
        used_web: usedWeb,
      })
      // The transcript now holds both messages, so the locally streamed copy
      // can go — and the budget comes back with the turn already counted.
      await chat.refetch()
      setAnswer(null)
    }

    function applyEvent(event: ChatEvent) {
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
  }, [chat, draft, messages.length, sending, tripId])

  if (chat.isLoading) return <Loading />
  if (chat.error) return <ChatUnavailable error={chat.error} />

  const composer = composerState({ online, sending, budget, chat: chat.data ?? null })

  return (
    <div className="flex min-h-[70vh] flex-col">
      <header>
        <p className="section-title text-brand">Ask</p>
        <h1 className="mt-1 font-display text-[34px] font-bold leading-[1.05] tracking-tight">
          About this trip
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          It knows your plan, your places and your bookings. It can’t change anything yet.
        </p>
      </header>

      {budget && <BudgetNotice budget={budget} />}

      <div className="mt-5 flex-1 space-y-3">
        {messages.length === 0 && !answer && <Suggestions onPick={setDraft} />}
        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}
        {answer !== null && <StreamingBubble text={answer} searching={searching} />}
        {incomplete && (
          <p className="text-xs text-muted">
            That answer is unfinished — it ran out of room before it was done. Try asking for one
            part of it.
          </p>
        )}
        {error && <p className="text-sm text-brand-700">{error}</p>}
        <div ref={bottom} />
      </div>

      <Composer draft={draft} onDraft={setDraft} onSend={() => void send()} composer={composer} />
    </div>
  )
}

/** A message from a person or from the assistant. */
function Bubble({ message }: { message: ChatMessageView }) {
  const mine = message.role === 'user'
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          mine
            ? 'max-w-[85%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-sm text-canvas'
            : 'max-w-[85%] rounded-[20px] rounded-bl-md bg-white px-4 py-2.5 text-sm shadow-card'
        }
      >
        {/* Attribution on every question, because two people share this thread —
            and "someone" when the author's account is gone, which is honest
            rather than inventing a name. */}
        {mine && (
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-canvas/60">
            {message.author?.display_name ?? 'Someone'}
          </p>
        )}
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  )
}

/** The answer being drawn right now. */
function StreamingBubble({ text, searching }: { text: string; searching: boolean }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-[20px] rounded-bl-md bg-white px-4 py-2.5 text-sm shadow-card">
        {searching && <p className="mb-1 text-xs text-muted">Searching the web…</p>}
        {text ? (
          <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
        ) : (
          !searching && <p className="text-muted">Thinking…</p>
        )}
      </div>
    </div>
  )
}

/**
 * The 80% notice and the 100% stop.
 *
 * Below 80% nothing about money is mentioned at all — a running total on a
 * screen nobody is worried about is just noise.
 */
function BudgetNotice({
  budget,
}: {
  budget: NonNullable<ReturnType<typeof useChat>['data']>['budget']
}) {
  if (budget.blocked) {
    return (
      <p className="mt-4 rounded-2xl bg-blush px-4 py-3 text-sm text-brand-700">
        Chat is paused until {formatResumeDate(budget.resumes_on)} — this month’s budget is used up.
        Everything you’ve asked is still here.
      </p>
    )
  }
  if (budget.pct >= 80) {
    return (
      <p className="mt-4 rounded-2xl bg-sand px-4 py-3 text-sm text-slate">
        You’ve used {budget.pct}% of this month’s chat budget.
      </p>
    )
  }
  return null
}

/** Openers, so an empty screen is not a blank box with a cursor in it. */
function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  const examples = [
    'What’s the plan for tomorrow?',
    'Which restaurants did we save?',
    'What time is our flight?',
    'What’s still on the shopping list?',
  ]
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Try asking:</p>
      {examples.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onPick(example)}
          className="block w-full rounded-2xl bg-white px-4 py-2.5 text-left text-sm shadow-card"
        >
          {example}
        </button>
      ))}
    </div>
  )
}

function Composer({
  draft,
  onDraft,
  onSend,
  composer,
}: {
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  composer: Composer
}) {
  const disabled = composer.state !== 'ready'
  return (
    <div className="sticky bottom-24 mt-4 space-y-1.5">
      {composer.state === 'offline' && (
        <p className="text-xs text-muted">Chat needs a signal. Everything above is still here.</p>
      )}
      {composer.state === 'busy' && (
        <p className="text-xs text-muted">Someone else on this trip is asking something.</p>
      )}
      <div className="flex items-end gap-2 rounded-[22px] bg-white p-2 shadow-card">
        <textarea
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+enter breaks the line — the convention every
            // messaging app on the phone already taught them.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (!disabled) onSend()
            }
          }}
          rows={1}
          disabled={composer.state === 'blocked' || composer.state === 'offline'}
          placeholder={placeholderFor(composer)}
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none disabled:text-muted"
          aria-label="Ask about this trip"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !draft.trim()}
          className="btn-primary shrink-0 px-4 py-2 text-sm disabled:opacity-40"
        >
          {composer.state === 'sending' ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

function placeholderFor(composer: Composer): string {
  if (composer.state === 'blocked') {
    return `Paused until ${formatResumeDate(composer.resumesOn)}`
  }
  if (composer.state === 'offline') return 'No connection'
  return 'Ask about this trip…'
}

function composerState({
  online,
  sending,
  budget,
  chat,
}: {
  online: boolean
  sending: boolean
  budget: { blocked: boolean; resumes_on: string | null } | undefined
  chat: { thread: { turn_running: boolean } | null } | null
}): Composer {
  if (sending) return { state: 'sending' }
  if (!online) return { state: 'offline' }
  if (budget?.blocked) return { state: 'blocked', resumesOn: budget.resumes_on }
  if (chat?.thread?.turn_running) return { state: 'busy' }
  return { state: 'ready' }
}

/**
 * A 404 here means chat is not configured on this deployment, which is a
 * different thing from an error and deserves a different sentence.
 */
function ChatUnavailable({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) {
    return <ErrorState message="Chat isn’t set up on this deployment yet." />
  }
  return <ErrorState message="Something went wrong opening the chat." />
}

/** `2026-10-01` → `1 October`. */
function formatResumeDate(iso: string | null): string {
  if (!iso) return 'next month'
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'next month'
  return `${date.getUTCDate()} ${date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`
}
