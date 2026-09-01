import { Link } from 'react-router-dom'
import { useTripFiles } from '../api/hooks'
import type { FileParent, TripDocument } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { FileUploader } from '../components/FileUploader'
import { Loading } from '../components/Loading'
import { useTripId } from '../lib/trip'

interface Group {
  key: string
  kind: 'trip' | 'zone' | 'activity'
  id: string
  name: string
  files: TripDocument[]
}

/** Trip docs first, then one group per activity/city that has attached files. */
function groupDocuments(files: TripDocument[]): Group[] {
  const groups = new Map<string, Group>()
  for (const f of files) {
    const { kind, id, name } = f.attached_to
    const key = `${kind}:${id}`
    if (!groups.has(key)) groups.set(key, { key, kind, id, name, files: [] })
    groups.get(key)!.files.push(f)
  }
  const order = (g: Group) => (g.kind === 'trip' ? 0 : g.kind === 'zone' ? 1 : 2)
  return [...groups.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
}

const parentFor = (g: Group): FileParent =>
  g.kind === 'trip' ? { kind: 'trip' } : { kind: g.kind, id: g.id }

const groupHref = (g: Group, tripId: string) =>
  g.kind === 'activity'
    ? `/trips/${tripId}/activities/${g.id}`
    : g.kind === 'zone'
      ? `/trips/${tripId}/zones/${g.id}`
      : null

export default function TripFiles() {
  const tripId = useTripId()
  const { data, isPending, isError, refetch } = useTripFiles(tripId)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load documents." onRetry={() => refetch()} />

  const groups = groupDocuments(data.files)

  return (
    <div>
      <p className="section-title text-brand">Documents</p>
      <h1 className="mt-1 font-display text-2xl font-bold">Trip documents</h1>
      <p className="mt-1 text-sm text-muted">
        Bookings, tickets and files. Attach files to a place from its page — they show up here too.
      </p>

      <div className="mt-5">
        <FileUploader parent={{ kind: 'trip' }} label="Upload a document" />
      </div>

      <div className="mt-6 space-y-6">
        {groups.length === 0 ? (
          <EmptyState message="No documents yet — upload your first one above." />
        ) : (
          groups.map((g) => {
            const href = groupHref(g, tripId)
            return (
              <section key={g.key}>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
                  {g.kind === 'trip' ? (
                    'Trip'
                  ) : (
                    <>
                      <span>{g.kind === 'activity' ? '📍' : '🏙️'}</span>
                      {href ? (
                        <Link to={href} className="text-brand">
                          {g.name}
                        </Link>
                      ) : (
                        g.name
                      )}
                    </>
                  )}
                </h2>
                <FileList files={g.files} deletable={parentFor(g)} />
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
