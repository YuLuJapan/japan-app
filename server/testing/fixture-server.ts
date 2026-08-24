// A real HTTP server standing in for the web.
//
// The services here fetch things the app does not own: exchange rates, photo
// search, a shop's product page, a translation. Tests used to replace global
// `fetch` to answer those. That was never only a stand-in for the internet —
// supabase-js reaches for the same global, so a stubbed fetch silently
// unplugged the datastore too, which is why every one of those files failed
// the moment the store became real.
//
// So: a server, on a port, speaking HTTP. The service builds a URL, opens a
// socket, reads headers and a body, and handles a real 500 or a real dropped
// connection. Nothing about the code under test is replaced — only the address
// it is pointed at.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FixtureRequest {
  path: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
}

export type FixtureReply =
  | { json: unknown; status?: number }
  | { html: string; status?: number; contentType?: string }
  | { body: string; status?: number; contentType?: string }
  | { status: number; headers?: Record<string, string> }
  /** Drop the connection mid-flight — what a network failure looks like. */
  | { hangUp: true }

export type FixtureHandler = (req: FixtureRequest) => FixtureReply | Promise<FixtureReply>

/** Paths the server answers itself, for steering it from another process. */
export const CONTROL = { routes: '/__fixture__/routes', reset: '/__fixture__/reset' } as const

export interface FixtureServer {
  /** Origin, e.g. http://127.0.0.1:41235. */
  readonly url: string
  /** Absolute URL for a path on this server. */
  urlFor(path: string): string
  /** Answer every request for `path` with `handler`. Returns the absolute URL. */
  on(path: string, handler: FixtureHandler): string
  /** Serve a fixed HTML page. */
  html(path: string, body: string, opts?: { contentType?: string }): string
  /** Serve a fixed JSON body. */
  json(path: string, body: unknown): string
  /** Answer with a redirect, the way a shop's short link does. */
  redirect(path: string, location: string, status?: number): string
  /** Every request that arrived, in order — for "was this even called?". */
  readonly requests: FixtureRequest[]
  /** Forget all routes and recorded requests, then re-apply the defaults. */
  reset(): void
  /**
   * Routes to re-apply on every reset.
   *
   * The web suite steers this server from a worker over `CONTROL.routes`,
   * because the API it answers runs in the globalSetup process — so the
   * baseline it returns to has to live here rather than in the caller.
   */
  setDefaults(apply: (server: FixtureServer) => void): void
  close(): Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const routes = new Map<string, FixtureHandler>()
  const requests: FixtureRequest[] = []

  let applyDefaults: (server: FixtureServer) => void = () => {}
  // Assigned below; the control routes need to hand the server to the caller's
  // default-applying callback.
  let self: FixtureServer

  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid')

    // Control plane: not part of the world being served, so it is handled
    // before anything is recorded as a request.
    if (req.method === 'POST' && url.pathname === CONTROL.routes) {
      const { path, reply } = (await readJson(req)) as { path: string; reply: FixtureReply }
      routes.set(path, () => reply)
      res.writeHead(204).end()
      return
    }
    if (req.method === 'POST' && url.pathname === CONTROL.reset) {
      routes.clear()
      requests.length = 0
      applyDefaults(self)
      res.writeHead(204).end()
      return
    }
    const record: FixtureRequest = {
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
    }
    requests.push(record)

    const handler = routes.get(url.pathname)
    if (!handler) {
      // An unregistered path is a 404, not a hang: a service asking for
      // something the test never set up should fail visibly and fast.
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end(`no fixture route for ${url.pathname}`)
      return
    }

    let reply: FixtureReply
    try {
      reply = await handler(record)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(`fixture handler threw: ${(err as Error).message}`)
      return
    }

    if ('hangUp' in reply) {
      req.destroy()
      return
    }
    if ('json' in reply) {
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply.json))
      return
    }
    if ('html' in reply) {
      res.writeHead(reply.status ?? 200, {
        'content-type': reply.contentType ?? 'text/html; charset=utf-8',
      })
      res.end(reply.html)
      return
    }
    if ('body' in reply) {
      res.writeHead(reply.status ?? 200, {
        'content-type': reply.contentType ?? 'text/plain; charset=utf-8',
      })
      res.end(reply.body)
      return
    }
    res.writeHead(reply.status, reply.headers)
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`

  const register = (path: string, handler: FixtureHandler): string => {
    routes.set(path, handler)
    return `${url}${path}`
  }

  self = {
    url,
    requests,
    urlFor: (path) => `${url}${path}`,
    on: register,
    html: (path, body, opts) => register(path, () => ({ html: body, ...opts })),
    json: (path, body) => register(path, () => ({ json: body })),
    redirect: (path, location, status = 302) =>
      register(path, () => ({ status, headers: { location } })),
    reset: () => {
      routes.clear()
      requests.length = 0
      applyDefaults(self)
    },
    setDefaults: (apply) => {
      applyDefaults = apply
      apply(self)
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  }
  return self
}
