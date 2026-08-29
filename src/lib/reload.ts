// Reloading the page, as one function nobody has to fight jsdom to replace.
//
// `window.location.reload` cannot be spied on in a jsdom test — `Location` is
// not configurable — so the one place the app restarts itself goes through
// here instead. Same idiom as `setDataStore` and `setTokenVerifier` on the
// server: a seam exists because the thing behind it cannot be reached from a
// test, not because the indirection is worth anything on its own.
export function reloadPage() {
  window.location.reload()
}
