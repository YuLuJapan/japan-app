import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <span className="text-5xl">🧭</span>
      <p className="text-sm text-muted">
        This page doesn't exist — lost like tourists in Shinjuku station.
      </p>
      <Link to="/trips" className="btn-primary">
        Back to your trips
      </Link>
    </div>
  )
}
