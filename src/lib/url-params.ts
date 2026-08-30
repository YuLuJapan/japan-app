// Both halves of a URL's parameters, flattened into one bag.
//
// Supabase answers a redirect in the fragment (implicit flow) or the query
// (PKCE), and the same names can appear in either, so reading one and not the
// other means missing a sign-in depending on how the project is configured.
// The precedence — query wins — is the rule supabase-js itself applies, so this
// and the client always read a given URL the same way.

/** Every parameter in `href`, from the hash and the query alike. */
export function parseParametersFromUrl(href: string): Record<string, string> {
  const result: Record<string, string> = {}
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return result
  }
  if (url.hash.startsWith('#')) {
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
      result[key] = value
    })
  }
  url.searchParams.forEach((value, key) => {
    result[key] = value
  })
  return result
}
