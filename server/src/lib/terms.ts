// Which version of the terms is in force.
//
// Bump this whenever the text in src/pages/Terms.tsx or src/pages/Privacy.tsx
// changes in a way people should see. Every account whose stored version is not
// this one is asked again on its next visit — that is the whole mechanism, and
// it is why the version is stored alongside the timestamp.
//
// A date, not a number: "what did I agree to?" is answered by looking at the
// documents as they stood on that date, and the git history makes that
// answerable. Server-side only — the client never sends a version, it is told
// whether the account is current, so there is one source of truth.
export const CURRENT_TERMS_VERSION = '2026-08-24'
