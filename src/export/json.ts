// The machine-readable backup. The cheapest writer of the four, and the only
// one that carries identifiers.
//
// It does *not* render the outline: the whole point of this version is to be
// read back, so it writes the payload exactly as the server projected it, ids
// and all. That is also why the readable writers cannot leak an identifier
// even though they share this payload — the outline they render has nowhere to
// put one. At share detail this still carries exactly the share fields: the
// machine-readable form is not a way around the projection (US4 acceptance 2).
import type { ExportPayload } from '../api/types'

export async function renderJson(payload: ExportPayload): Promise<Blob> {
  return new Blob([JSON.stringify({ export: payload }, null, 2)], {
    type: 'application/json',
  })
}

/** The same flattening the readable writers expose, for comparing formats. */
export function contentStrings(payload: ExportPayload): string[] {
  return (
    JSON.stringify(payload)
      .match(/"[^"]*"/g)
      ?.map((s) => s.slice(1, -1)) ?? []
  )
}
