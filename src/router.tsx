import { Navigate, Outlet, createBrowserRouter, useParams } from 'react-router-dom'
import { getAccessCode } from './api/client'
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
