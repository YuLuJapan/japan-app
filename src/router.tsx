import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { getAccessCode } from './api/client'
import { Layout } from './components/Layout'
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
import Zone from './pages/Zone'

/** Route guard: without a stored access code, everything redirects to the gate. */
function RequireAccess() {
  if (!getAccessCode()) return <Navigate to="/gate" replace />
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

export const router = createBrowserRouter([
  { path: '/gate', element: <AccessGate /> },
  {
    element: <RequireAccess />,
    children: [
      { path: '/', element: <Journey /> },
      { path: '/journey/edit', element: <JourneySteps /> },
      { path: '/zones/:zoneId', element: <Zone /> },
      { path: '/zones/:zoneId/c/:category', element: <CategoryList /> },
      { path: '/zones/:zoneId/places/new', element: <PlaceForm /> },
      { path: '/places/:placeId', element: <PlaceDetail /> },
      { path: '/places/:placeId/edit', element: <PlaceForm /> },
      { path: '/search', element: <Search /> },
      { path: '/shopping', element: <ShoppingList /> },
      { path: '/shopping/new', element: <ShoppingForm /> },
      { path: '/shopping/c/:category', element: <ShoppingCategoryPage /> },
      { path: '/shopping/:itemId', element: <ShoppingItemDetail /> },
      { path: '/shopping/:itemId/edit', element: <ShoppingForm /> },
      { path: '/reminders', element: <Reminders /> },
      { path: '/essentials', element: <TripEssentials /> },
      { path: '/files', element: <TripFiles /> },
      { path: '/files/:fileId', element: <DocumentPreview /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
