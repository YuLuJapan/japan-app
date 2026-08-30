// What happens when a screen's own code will not arrive.
//
// The map is the only route behind a dynamic `import()`, and every asset is
// named by its content hash with only the current deployment's served — so a
// page open across a deploy asks for a file that now 404s. Uncaught, React
// hands that to the router, which paints "Unexpected Application Error" and
// the browser's own wording over the whole app. This is the boundary that
// stops it, and the one reload that fixes the thing it is actually about.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ChunkBoundary } from '../components/ChunkBoundary'
import { isChunkLoadError } from '../lib/chunks'

const reload = vi.hoisted(() => vi.fn())
vi.mock('../lib/reload', () => ({ reloadPage: reload }))

const Throws = ({ error }: { error: unknown }) => {
  throw error
}

const boundary = (error: unknown) =>
  render(
    <MemoryRouter>
      <ChunkBoundary>
        <Throws error={error} />
      </ChunkBoundary>
    </MemoryRouter>
  )

// React logs every caught error; the boundary is the point of these tests.
let noise: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  reload.mockReset()
  sessionStorage.clear()
  noise = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => noise.mockRestore())

describe('recognising a chunk that would not load', () => {
  // Each engine words it differently and none of them uses a distinct error
  // type — a failed dynamic import is a plain TypeError — so the message is
  // all there is to go on.
  it.each([
    'Importing a module script failed.',
    'Failed to fetch dynamically imported module: https://x/assets/TripMap-a1b2.js',
    'error loading dynamically imported module',
    'Unable to preload CSS for /assets/engine-1234.css',
  ])('knows %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
  })

  it('does not mistake an ordinary bug for one', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('a screen whose code is missing', () => {
  it('reloads once, so the page comes back on the build that is actually deployed', () => {
    boundary(new Error('Importing a module script failed.'))
    expect(reload).toHaveBeenCalledTimes(1)
    // Nothing is shown on the way out: the page is already going.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('does not reload again when the fresh page fails the same way', () => {
    // A boundary that reloads on every failure is an infinite loop wearing a
    // recovery strategy's clothes. The mark survives the reload; this is the
    // page that came back.
    boundary(new Error('Importing a module script failed.'))
    expect(reload).toHaveBeenCalledTimes(1)
    boundary(new Error('Importing a module script failed.'))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
  })

  it('offers the way on rather than a stack trace', async () => {
    sessionStorage.setItem('onward:chunk-reload', String(Date.now()))
    boundary(new Error('Importing a module script failed.'))
    expect(screen.getByRole('link', { name: /back to your trips/i })).toHaveAttribute(
      'href',
      '/trips'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads again for a later deploy in the same tab', () => {
    // The mark is a timestamp, not a flag: an hour-old reload is not a reason
    // to refuse this one, and nothing has to remember to clear it.
    sessionStorage.setItem('onward:chunk-reload', String(Date.now() - 60 * 60 * 1000))
    boundary(new Error('Importing a module script failed.'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('an ordinary error on the same screen', () => {
  it('is caught and said plainly, and never reloaded into', () => {
    // Reloading would only repeat it, and the router's own error page is a
    // stack trace on a phone.
    boundary(new Error('Cannot read properties of undefined'))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('Something went wrong on this screen.')).toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/i)).toBeNull()
  })
})
