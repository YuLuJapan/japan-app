// Chat's furniture, mounted once by `Layout` so it is on every trip screen.
//
// It was a pill on the trip home only, which meant the answer to "is this open
// tomorrow?" — asked while looking at the restaurant — was three taps away in
// the other direction. Chat is a thing you reach for *from* a screen, so the
// button belongs to the frame rather than to one page.
//
// **Open is a URL, not a piece of component state.** `?chat=1` on whatever
// page you are on is what makes the phone's Back gesture close the sheet, which
// is the one thing every Android user will try first, and it is what lets the
// old `/trips/:tripId/chat` bookmark keep working as a redirect into this
// (`router.tsx`) rather than needing a page of its own to survive.
//
// The two gates are the ones the route used to apply, unchanged: `chat-bot`
// (default off, so local dev and any deploy without PostHog have no button —
// the right state for a feature that costs money per use) and `useCanEdit`,
// because chat is owners and partners only. Neither is the spend control: with
// no `ANTHROPIC_API_KEY` every chat endpoint answers 404 whatever these say.
import { useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBooleanFlag } from '../../lib/flags'
import { useCanEdit } from '../../lib/session'
import { AskOrb } from './AskOrb'
import { ChatConversation } from './ChatConversation'
import { ChatSheet } from './ChatSheet'

/** The search param that means "the chat window is open". */
export const CHAT_PARAM = 'chat'

export function AskDock({ hidden = false }: { hidden?: boolean }) {
  const enabled = useBooleanFlag('chat-bot', false)
  const canEdit = useCanEdit()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const open = params.get(CHAT_PARAM) === '1'

  // Whether *this* dock pushed the history entry the sheet is sitting on. Set
  // when the button opens it, unset when it is closed — a ref rather than
  // state because nothing renders differently for it.
  const pushed = useRef(false)

  const openChat = useCallback(() => {
    const next = new URLSearchParams(params)
    next.set(CHAT_PARAM, '1')
    pushed.current = true
    // A push, not a replace: this is what the Back gesture pops.
    setParams(next)
  }, [params, setParams])

  const closeChat = useCallback(() => {
    if (pushed.current) {
      pushed.current = false
      // Pop the entry the button pushed, so closing leaves no dead Back press
      // behind it.
      navigate(-1)
      return
    }
    // Opened by a link or a bookmark instead, so there is nothing of ours to
    // pop — rewrite the URL in place.
    const next = new URLSearchParams(params)
    next.delete(CHAT_PARAM)
    setParams(next, { replace: true })
  }, [navigate, params, setParams])

  if (!enabled || !canEdit) return null
  return (
    <>
      {/* Hidden while the sheet is up — it would sit on top of the sheet's own
          composer — and on the one route that already floats controls of its
          own (see `Layout`). Above the tab bar (`z-20`) and clear of the right
          edge, where the old pill was. */}
      {!open && !hidden && <AskOrb onClick={openChat} className="fixed bottom-24 right-5 z-30" />}
      <ChatSheet open={open} onClose={closeChat}>
        <ChatConversation />
      </ChatSheet>
    </>
  )
}
