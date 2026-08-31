// Chat: ask about the trip.
//
// Read-only in this phase — it answers questions and changes nothing, which is
// why there is no confirmation step anywhere on this screen. When 006 adds
// writes, the approval gate lands here.
//
// The page is composition. The turn's state machine is `useChatTurn`, the
// connection signal is `useOnlineStatus`, and what is left here is which of
// those to show.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useChat, useMe } from '../api/hooks'
import type { ChatBudget, ChatMessageView, ChatView } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { useChatTurn } from '../lib/chat-turn'
import { useOnlineStatus } from '../lib/online'
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
  const me = useMe()
  const online = useOnlineStatus()
  const [draft, setDraft] = useState('')

  const messages = chat.data?.messages ?? []
  const refresh = useCallback(() => chat.refetch(), [chat])
  const turn = useChatTurn(tripId, { hasHistory: messages.length > 0, refresh })

  const bottom = useRef<HTMLDivElement>(null)
  useRefreshOnFocus(refresh)

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, turn.question, turn.answer])

  const send = async () => {
    const question = draft.trim()
    if (!question || turn.sending) return
    setDraft('')
    // It never reached the server, so put it back rather than making them
    // retype it.
    if (!(await turn.ask(question))) setDraft(question)
  }

  if (chat.isLoading) return <Loading />
  if (chat.error) return <ChatUnavailable error={chat.error} />

  return (
    <div className="flex min-h-[70vh] flex-col">
      <ChatHeader />
      {chat.data && <BudgetNotice budget={chat.data.budget} />}

      <div className="mt-5 flex-1 space-y-3">
        {messages.length === 0 && turn.question === null && <Suggestions onPick={setDraft} />}
        {messages.map((message) => (
          <Bubble
            key={message.id}
            role={message.role}
            author={message.author?.display_name ?? null}
            content={message.content}
          />
        ))}
        {/* The question, drawn from the moment it is sent — the transcript that
            will hold it is not re-read until the answer is finished. */}
        {turn.question !== null && (
          <Bubble
            role="user"
            author={me.data?.user.display_name ?? 'You'}
            content={turn.question}
          />
        )}
        {turn.answer !== null && <StreamingBubble text={turn.answer} searching={turn.searching} />}
        {turn.incomplete && <IncompleteNotice />}
        {turn.error && <p className="text-sm text-brand-700">{turn.error}</p>}
        {/* `scroll-mb` is what keeps "scroll to the newest message" from
            scrolling it to where the composer is. Without it the browser puts
            this marker at the bottom of the viewport, which is precisely the
            strip the composer bar is pinned over, so the newest message lands
            underneath it. */}
        <div ref={bottom} className="scroll-mb-48" />
      </div>

      <Composer
        draft={draft}
        onDraft={setDraft}
        onSend={() => void send()}
        composer={composerState({ online, sending: turn.sending, chat: chat.data ?? null })}
      />
    </div>
  )
}

function ChatHeader() {
  return (
    <header>
      <p className="section-title text-brand">Ask</p>
      <h1 className="mt-1 font-display text-[34px] font-bold leading-[1.05] tracking-tight">
        About this trip
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        It knows your plan, your places and your bookings. It can’t change anything yet.
      </p>
    </header>
  )
}

function IncompleteNotice() {
  return (
    <p className="text-xs text-muted">
      That answer is unfinished — it ran out of room before it was done. Try asking for one part of
      it.
    </p>
  )
}

/**
 * The partner may have asked something since this tab was last looked at.
 *
 * Focus is the moment that matters — coming back to the phone. Deliberately not
 * a realtime subscription: more moving parts than two people need.
 */
function useRefreshOnFocus(refresh: () => void) {
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    const onFocus = () => latest.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

/** What the composer may do, from the three things that can stop it. */
function composerState({
  online,
  sending,
  chat,
}: {
  online: boolean
  sending: boolean
  chat: ChatView | null
}): Composer {
  if (sending) return { state: 'sending' }
  if (!online) return { state: 'offline' }
  if (chat?.budget.blocked) return { state: 'blocked', resumesOn: chat.budget.resumes_on }
  if (chat?.thread?.turn_running) return { state: 'busy' }
  return { state: 'ready' }
}

/** A message from a person or from the assistant. */
function Bubble({
  role,
  author,
  content,
}: {
  role: ChatMessageView['role']
  /** Null when the author's account is gone — never for a message being sent. */
  author: string | null
  content: string
}) {
  const mine = role === 'user'
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
            {author ?? 'Someone'}
          </p>
        )}
        <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
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
function BudgetNotice({ budget }: { budget: ChatBudget }) {
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
    /* A bar, not a floating card. It is pinned over the conversation, so it
       needs a ground of its own: transparent, the messages scrolled through the
       page padding either side of it and through the strip between it and the
       tab bar. Hence the full-width bleed (`-mx-5 px-5`, the same idiom
       PhotoHero uses to cancel `<main>`'s padding) and an opaque `bg-canvas`
       reaching from the rule at its top to the bottom of the screen.

       `bottom-0` with `pb-24` rather than `bottom-24`: the two put the box in
       the same place, but this way the box *extends* to the screen's edge
       instead of stopping short of it and leaving a live strip of conversation
       showing beneath. `-mb-28` gives that padding back to `<main>`'s own
       `pb-28`, so the page does not grow a screenful of dead space at the end.
       The rule and `mt-6` are the separation between the conversation and the
       box you type in. */
    <div className="sticky bottom-0 -mx-5 -mb-28 mt-6 border-t border-line bg-canvas px-5 pb-24 pt-3 space-y-1.5">
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
          /* 16px, not 14: Safari on iOS zooms the whole page in when a field
             smaller than that takes focus, and then leaves it zoomed. Every
             other field in the app is `text-base` for the same reason (the
             `.input` class in styles/index.css) — this one was the exception. */
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none disabled:text-muted"
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
