import { Navigate, Outlet, createBrowserRouter, useParams } from 'react-router-dom'
import { getAccessCode } from './api/client'
import { Layout } from './components/Layout'
import { Loading } from './components/Loading'
import { RoleProvider, useCanEdit } from './lib/session'
import AccessGate from './pages/AccessGate'
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
import TripsList from './pages/TripsList'
import Zone from './pages/Zone'

/** Route guard: without a stored access code, everything redirects to the gate. */
function RequireAccess() {
  if (!getAccessCode()) return <Navigate to="/gate" replace />
  return (
    <RoleProvider fallback={<Loading />}>
      <Outlet />
    </RoleProvider>
  )
}

/** Everything inside a trip shares the tabbed layout (Journey/Shopping/Reminders/Essentials/Docs). */
function TripLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

/**
 * Screens that only exist to change things, plus the documents section. A guest
 * who lands on one (a shared link, a stale bookmark) goes to the journey rather
 * than to a form that could not save anyway.
 */
function RequireOwner() {
  const { tripId } = useParams<{ tripId: string }>()
  return useCanEdit() ? <Outlet /> : <Navigate to={`/trips/${tripId}`} replace />
}

export const router = createBrowserRouter([
  { path: '/gate', element: <AccessGate /> },
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
          { path: 'shopping', element: <ShoppingList /> },
          { path: 'shopping/c/:category', element: <ShoppingCategoryPage /> },
          { path: 'shopping/:itemId', element: <ShoppingItemDetail /> },
          { path: 'reminders', element: <Reminders /> },
          { path: 'essentials', element: <TripEssentials /> },
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
