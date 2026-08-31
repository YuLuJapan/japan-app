// Server-sent events, as a small wrapper over one response.
//
// HTTP mechanics rather than anything about chat, so it lives here and the route
// that uses it reads as business logic. Anything else that needs to stream gets
// it for free.

import type { Response } from 'express'

export interface EventStream {
  /** Whether anything has been sent — i.e. whether the status is already spent. */
  readonly opened: boolean
  /** Send one event, opening the stream if this is the first. */
  send(event: unknown): void
  end(): void
}

/**
 * Wrap a response as a stream of events.
 *
 * **Headers are flushed on the first event, not up front**, and that is the
 * whole reason this is lazy. Until something is sent the response still has an
 * unspent status code, so a failure can be thrown and answered by the error
 * middleware with a real status and the envelope every other route produces.
 * After the first event the status is 200 and a failure has to travel as an
 * event instead — `opened` is how a caller tells which world it is in.
 */
export function eventStream(res: Response): EventStream {
  let opened = false

  const open = () => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    // `no-transform` above and this header together stop a proxy buffering the
    // stream into one response at the end — which would leave the reader
    // watching a blank screen and then the whole answer at once, exactly what
    // streaming is here to avoid.
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    opened = true
  }

  return {
    get opened() {
      return opened
    },
    send(event: unknown) {
      if (!opened) open()
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    },
    end() {
      res.end()
    },
  }
}
