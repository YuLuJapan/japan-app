// What a place looks like to a list, in one place.
//
// The zone's category lists render a `summary_line` the server derives from
// the description. It used to be computed inline while building that list,
// which made it invisible to everything else — including the client, which
// then could not put an edited place back into the list it came from without
// inventing the same rule and hoping the two stayed in step. It is a shared
// function now, and every place the API hands back carries its result.
import type { Place } from './datastore.js'

const SUMMARY_MAX = 100

/** The one-line gist a list shows under a place's name. */
export const summaryLine = (description: string | null | undefined) =>
  description ? description.slice(0, SUMMARY_MAX) : ''

/** A place as any response returns it: its own columns plus what a list needs. */
export const placeView = (place: Place) => ({
  ...place,
  summary_line: summaryLine(place.description),
})
