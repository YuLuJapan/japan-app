import { useEffect } from 'react'
import { Navigate, Outlet, createBrowserRouter, useParams } from 'react-router-dom'
import { getAccessCode } from './api/client'
import { useBooleanFlag } from './lib/flags'
import { setTripContext, tripContext } from './lib/posthog'
import { Layout } from './components/Layout'
import { useTrip } from './api/hooks'
import {
  SessionProvider,
  TripRoleContext,
  TripShowsContext,
  useCanEdit,
  useTripShows,
} from './lib/session'
import AcceptInvite from './pages/AcceptInvite'
import AccessGate from './pages/AccessGate'
import { Privacy, Terms } from './pages/Legal'
import { TermsGate } from './components/TermsGate'
import CategoryList from './pages/CategoryList'
import DocumentPreview from './pages/DocumentPreview'
import Journey from './pages/Journey'
import JourneySteps from './pages/JourneySteps'
import NotFound from './pages/NotFound'
import PlaceDetail from './pages/PlaceDetail'
import PlaceForm from './pages/PlaceForm'
import Reminders from './pages/Reminders'
import Search from './pages/Search'
import ShoppingCategoryPage from './pages/ShoppingCategory'
import ShoppingForm from './pages/ShoppingForm'
import ShoppingItemDetail from './pages/ShoppingItem'
import ShoppingList from './pages/ShoppingList'
import TripEssentials from './pages/TripEssentials'
import TripExport from './pages/TripExport'
import TripFiles from './pages/TripFiles'
import TripMembers from './pages/TripMembers'
import TripsList from './pages/TripsList'
import Zone from './pages/Zone'

/** Route guard: without a signed-in session, everything redirects to the gate. */
function RequireAccess() {
  if (!getAccessCode()) return <Navigate to="/gate" replace />
  return (
    <SessionProvider>
      <TermsGate>
        <Outlet />
      </TermsGate>
    </SessionProvider>
  )
}

/**
 * Everything inside a trip shares the tabbed layout, the caller's role on
 * *this* trip, and what it shows them. Both ride along on the bundle the
 * layout already fetches, so neither costs an extra request.
 */
function TripLayout() {
  const { tripId = '' } = useParams<{ tripId: string }>()
  const trip = useTrip(tripId)
  const bundle = trip.data

  // What kind of trip this is, on every event sent from inside it — including
  // the $pageviews PostHog sends itself, which no call site of ours could
  // annotate. Cleared on the way out, because a country left registered would
  // label the trips list, and the next trip, with the last one's.
  useEffect(() => {
    if (bundle) setTripContext(tripContext(bundle.trip, bundle.my_role))
    return () => setTripContext(null)
  }, [bundle])

  return (
    <TripRoleContext.Provider value={trip.data?.my_role ?? null}>
      <TripShowsContext.Provider
        value={trip.data?.shows ?? { stays: true, flight: true, documents: true, shopping: true }}
      >
        <Layout>
          <Outlet />
        </Layout>
      </TripShowsContext.Provider>
    </TripRoleContext.Provider>
  )
}

/**
 * Screens that only exist to change things, plus the documents section. A
 * viewer who lands on one (a shared link, a stale bookmark) goes to the
 * journey rather than to a form that could not save anyway.
 */
function RequireOwner() {
  const { tripId } = useParams<{ tripId: string }>()
  return useCanEdit() ? <Outlet /> : <Navigate to={`/trips/${tripId}`} replace />
}

/**
 * The export, while it is rolling out.
 *
 * `export-trip` defaults **off**, the same way `files-rename` does: a flag is
 * a rollout control, so the code carries it before PostHog does and deleting
 * it there can never take a screen down. It gates the *entry points* only —
 * the endpoint stays live, because gating a route would add a way for a
 * correctly-authorised request to fail without protecting anything.
 *
 * This catches the ways in that are not the button: a bookmark, a pasted link,
 * a back button into a session where the flag has since gone off.
 */
export function RequireExport() {
  const { tripId } = useParams<{ tripId: string }>()
  return useBooleanFlag('export-trip', false) ? (
    <Outlet />
  ) : (
    <Navigate to={`/trips/${tripId}`} replace />
  )
}

/**
 * The shopping section, when this trip shares it with you. The tab is already
 * gone from the nav; this catches the other ways in — a bookmark, a link
 * somebody pasted — so they land on the journey rather than on an error the
 * API is right to return but nobody needs to read.
 */
function RequireShopping() {
  const { tripId } = useParams<{ tripId: string }>()
  return useTripShows().shopping ? <Outlet /> : <Navigate to={`/trips/${tripId}`} replace />
}

export const router = createBrowserRouter([
  { path: '/gate', element: <AccessGate /> },
  // Outside RequireAccess on purpose: someone deciding whether to sign up has
  // to be able to read these first, and the acceptance screen links to them
  // while the account has not yet agreed.
  { path: '/terms', element: <Terms /> },
  { path: '/privacy', element: <Privacy /> },
  // The token is the authorization, so this sits outside RequireAccess — the
  // screen itself sends a signed-out visitor to the gate and back.
  { path: '/invite/:token', element: <AcceptInvite /> },
  {
    element: <RequireAccess />,
    children: [
      { path: '/', element: <Navigate to="/trips" replace /> },
      { path: '/trips', element: <TripsList /> },
      {
        path: '/trips/:tripId',
        element: <TripLayout />,
        children: [
          { index: true, element: <Journey /> },
          { path: 'zones/:zoneId', element: <Zone /> },
          { path: 'zones/:zoneId/c/:category', element: <CategoryList /> },
          { path: 'places/:placeId', element: <PlaceDetail /> },
          { path: 'search', element: <Search /> },
          {
            element: <RequireShopping />,
            children: [
              { path: 'shopping', element: <ShoppingList /> },
              { path: 'shopping/c/:category', element: <ShoppingCategoryPage /> },
              { path: 'shopping/:itemId', element: <ShoppingItemDetail /> },
            ],
          },
          { path: 'reminders', element: <Reminders /> },
          { path: 'essentials', element: <TripEssentials /> },
          // Every member may export, viewers included (FR-007) — the file is a
          // subset of what they already see, so this sits outside RequireOwner.
          { element: <RequireExport />, children: [{ path: 'export', element: <TripExport /> }] },

          // Everyone on the trip can see who else is on it; the screen itself
          // offers the owner-only controls only to an owner, and a viewer-only
          // invite button to a partner.
          { path: 'members', element: <TripMembers /> },
          {
            element: <RequireOwner />,
            children: [
              { path: 'journey/edit', element: <JourneySteps /> },
              { path: 'zones/:zoneId/places/new', element: <PlaceForm /> },
              { path: 'places/:placeId/edit', element: <PlaceForm /> },
              { path: 'shopping/new', element: <ShoppingForm /> },
              { path: 'shopping/:itemId/edit', element: <ShoppingForm /> },
              { path: 'files', element: <TripFiles /> },
              { path: 'files/:fileId', element: <DocumentPreview /> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
