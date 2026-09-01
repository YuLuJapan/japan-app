// Tips list with inline add/edit/delete (FR-016), deletes confirmed (FR-017).
// Guests read the same tips without the add/edit/delete affordances.
import { useState } from 'react'
import { useCreateTip, useDeleteTip, useUpdateTip } from '../api/mutations'
import type { Tip } from '../api/types'
import { useCanEdit } from '../lib/session'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  tips: Tip[]
  parent: { zone_id: string } | { activity_id: string }
  title?: string
}

export function TipEditor({ tips, parent, title = 'Tips' }: Props) {
  const canEdit = useCanEdit()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const createTip = useCreateTip(parent)
  const updateTip = useUpdateTip(parent)
  const deleteTip = useDeleteTip(parent)

  const saveNew = () => {
    if (!draft.trim()) return
    createTip.mutate(draft.trim(), {
      onSuccess: () => {
        setDraft('')
        setAdding(false)
      },
    })
  }

  const saveEdit = () => {
    if (!editingId || !editDraft.trim()) return
    updateTip.mutate(
      { tipId: editingId, body: editDraft.trim() },
      { onSuccess: () => setEditingId(null) }
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
        {canEdit && !adding && (
          <button
            type="button"
            className="text-sm font-bold text-brand"
            onClick={() => setAdding(true)}
          >
            + Add tip
          </button>
        )}
      </div>

      {tips.length === 0 && !adding && <p className="mt-2 text-sm text-muted">No tips yet.</p>}

      <ul className="mt-3 space-y-2">
        {tips.map((tip) => (
          <li key={tip.id} className="rounded-[14px] bg-white px-3.5 py-3 shadow-card">
            {editingId === tip.id ? (
              <div className="space-y-2">
                <textarea
                  className="field min-h-20"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  aria-label="Edit tip"
                />
                {updateTip.isError && (
                  <p className="text-sm text-brand">Save failed — your text is kept, try again.</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    onClick={saveEdit}
                    disabled={updateTip.isPending}
                  >
                    {updateTip.isPending ? 'Saving…' : updateTip.isError ? 'Retry' : 'Save'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                {/* The redesign marks a tip with a coral bullet rather than a
                    border — the card is already a card, and the dot is what
                    makes a stack of them read as a list. */}
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-graphite">{tip.body}</p>
                {canEdit && (
                  <span className="flex shrink-0 gap-3 text-[11px] font-semibold">
                    <button
                      type="button"
                      className="text-muted"
                      onClick={() => {
                        setEditingId(tip.id)
                        setEditDraft(tip.body)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-brand"
                      onClick={() => setDeletingId(tip.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-2 space-y-2">
          <textarea
            className="field min-h-20"
            placeholder="e.g. Cash only — bring yen"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="New tip"
          />
          {createTip.isError && (
            <p className="text-sm text-brand">Save failed — your text is kept, try again.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={saveNew}
              disabled={createTip.isPending}
            >
              {createTip.isPending ? 'Saving…' : createTip.isError ? 'Retry' : 'Save tip'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setAdding(false)
                setDraft('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete this tip?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deletingId) deleteTip.mutate(deletingId)
          setDeletingId(null)
        }}
        onCancel={() => setDeletingId(null)}
      />
    </section>
  )
}
