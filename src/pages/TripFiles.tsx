import { useTripFiles } from '../api/hooks'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { Loading } from '../components/Loading'

export default function TripFiles() {
  const { data, isPending, isError, refetch } = useTripFiles()

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load documents." onRetry={() => refetch()} />

  return (
    <div>
      <p className="section-title text-brand">Documents</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold">Trip documents</h1>
      <p className="mt-1 text-sm text-muted">Bookings, tickets and files collected before the trip.</p>
      <div className="mt-5">
        {data.files.length === 0 ? (
          <EmptyState message="No trip-level documents yet." />
        ) : (
          <FileList files={data.files} />
        )}
      </div>
    </div>
  )
}
