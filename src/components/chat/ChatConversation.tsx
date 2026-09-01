// The conversation itself: transcript, composer, and the one thing that can be
// done to it — putting it away.
//
// Read-only in this phase — it answers questions and changes nothing. The one
// confirmation here is not about a *write to the trip*: it guards putting the
// conversation away, which is shared, and which nothing in the app can
// re-open. When writes arrive, the approval gate lands here beside it.
//
// This is composition. The turn's state machine is `useChatTurn`, the
// connection signal is `useOnlineStatus`, and what is left here is which of
// those to show.
//
// **It fills its container and scrolls inside it.** The screen chrome — the
// title, the way out — belongs to `ChatSheet`, which floats this over whatever
// page you were reading; this component only assumes it has been given a
// column with a height. That is what replaced the old page's sticky composer
// and its bleed margins: inside a sheet the composer is simply the last row of
// a flex column, and the transcript is the row that scrolls.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { useChat, useMe } from '../../api/hooks'
import { useStartNewChat } from '../../api/mutations'
import type { ChatBudget, ChatMessageView, ChatView } from '../../api/types'
import { ConfirmDialog } from '../ConfirmDialog'
import { ErrorState } from '../ErrorState'
import { Loading } from '../Loading'
import { useChatTurn, type TurnActivity } from '../../lib/chat-turn'
import { useOnlineStatus } from '../../lib/online'
import { useTripId } from '../../lib/trip'

/** What the composer is allowed to do right now, and why. */
type Composer =
  | { state: 'ready' }
  | { state: 'sending' }
  | { state: 'offline' }
  | { state: 'blocked'; resumesOn: string | null }
  | { state: 'busy' }

export function ChatConversation() {
  const tripId = useTripId()
  const chat = useChat(tripId)
  const me = useMe()
  const online = useOnlineStatus()
  const [draft, setDraft] = useState('')

  const messages = chat.data?.messages ?? []
  const refresh = useCallback(() => chat.refetch(), [chat])
  const turn = useChatTurn(tripId, { hasHistory: messages.length > 0, refresh })
  const startNew = useStartNewChat(tripId)
  const [confirmingNew, setConfirmingNew] = useState(false)

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

  if (chat.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loading />
      </div>
    )
  }
  if (chat.error) {
    return (
      <div className="flex flex-1 items-center justify-center px-5">
        <ChatUnavailable error={chat.error} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConfirmDialog
        open={confirmingNew}
        title="Start a new conversation?"
        // Said plainly, because all three are surprising: the transcript is
        // shared, so this clears the screen for the other traveller too; there
        // is no way back to it in the app, even though it is kept; and the
        // month's spending is not a transcript, so it does not come back.
        message="This one is put away for both of you and can’t be re-opened here. What you have spent this month stays as it is."
        confirmLabel="Start a new one"
        onCancel={() => setConfirmingNew(false)}
        onConfirm={() => {
          setConfirmingNew(false)
          startNew.mutate()
        }}
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-2 pt-1">
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
        {turn.answer !== null && <StreamingBubble text={turn.answer} activity={turn.activity} />}
        {turn.incomplete && <IncompleteNotice />}
        {turn.error && <p className="text-sm text-brand-700">{turn.error}</p>}
        <div ref={bottom} />
      </div>

      <Composer
        draft={draft}
        onDraft={setDraft}
        onSend={() => void send()}
        composer={composerState({ online, sending: turn.sending, chat: chat.data ?? null })}
        budget={chat.data?.budget ?? null}
        // Two different questions, deliberately kept apart. *Presence* is "is
        // there a conversation to throw away" — with none, the button is not
        // rendered at all, because a greyed-out "Start over" on an empty screen
        // invites a tap that could never do anything. *Enabled* is "may it
        // happen right now", which a running turn answers no to: the server
        // refuses with a 409 while the model is mid-answer, and a button that
        // sat there tappable would only produce that refusal as a toast.
        hasConversation={messages.length > 0}
        canClear={!turn.sending && !startNew.isPending}
        onClear={() => setConfirmingNew(true)}
      />
    </div>
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

/**
 * What a turn is doing while it has nothing to show yet.
 *
 * Specific rather than a spinner, because the two are genuinely different waits
 * and one of them is much longer: a web search takes seconds, opening a file
 * takes a moment. "Thinking…" for both would make the short one feel broken and
 * the long one feel stuck.
 */
const ACTIVITY_LINES: Record<TurnActivity, string> = {
  searching: 'Searching the web…',
  reading: 'Reading your trip…',
}

/** The answer being drawn right now. */
function StreamingBubble({ text, activity }: { text: string; activity: TurnActivity | null }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-[20px] rounded-bl-md bg-white px-4 py-2.5 text-sm shadow-card">
        {activity && <p className="mb-1 text-xs text-muted">{ACTIVITY_LINES[activity]}</p>}
        {text ? (
          <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
        ) : (
          !activity && <p className="text-muted">Thinking…</p>
        )}
      </div>
    </div>
  )
}

/**
 * The 80% notice and the 100% stop.
 *
 * Below 80% nothing about money is mentioned at all — a running total on a
 * screen nobody is worried about is just noise. It sits with the composer
 * rather than at the top of the transcript: the one thing it changes is
 * whether you can type, so it belongs where the typing happens instead of
 * scrolled off the top of a long conversation.
 */
function BudgetNotice({ budget }: { budget: ChatBudget }) {
  if (budget.blocked) {
    return (
      <p className="rounded-2xl bg-blush px-4 py-3 text-sm text-brand-700">
        Chat is paused until {formatResumeDate(budget.resumes_on)} — this month’s budget is used up.
        Everything you’ve asked is still here.
      </p>
    )
  }
  if (budget.pct >= 80) {
    return (
      <p className="rounded-2xl bg-sand px-4 py-3 text-sm text-slate">
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

/**
 * Everything that lives under the transcript: the budget line, why the box is
 * disabled when it is, the box itself, and the way to put the conversation
 * away.
 *
 * "Start over" is *here*, at the bottom, rather than in a header — the header
 * scrolls out of reach of a thumb the moment a conversation is long enough to
 * be worth clearing, which is exactly when it is wanted. It sits under the box
 * rather than over it so it can never be the thing a thumb lands on when it
 * was reaching for Ask.
 */
function Composer({
  draft,
  onDraft,
  onSend,
  composer,
  budget,
  hasConversation,
  canClear,
  onClear,
}: {
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  composer: Composer
  budget: ChatBudget | null
  hasConversation: boolean
  canClear: boolean
  onClear: () => void
}) {
  const disabled = composer.state !== 'ready'
  return (
    <div className="space-y-2 border-t border-line bg-canvas px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {budget && <BudgetNotice budget={budget} />}
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
      {hasConversation && (
        <div className="flex justify-center">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-muted disabled:opacity-40"
            disabled={!canClear}
            onClick={onClear}
          >
            <span aria-hidden>↺</span> Start over
          </button>
        </div>
      )}
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
