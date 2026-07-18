import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { getAccessCode } from './api/client'
import { Layout } from './components/Layout'
import AccessGate from './pages/AccessGate'
import CategoryList from './pages/CategoryList'
import Journey from './pages/Journey'
import JourneySteps from './pages/JourneySteps'
import NotFound from './pages/NotFound'
import PlaceDetail from './pages/PlaceDetail'
import PlaceForm from './pages/PlaceForm'
import Search from './pages/Search'
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
      { path: '/essentials', element: <TripEssentials /> },
      { path: '/files', element: <TripFiles /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
