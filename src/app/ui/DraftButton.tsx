'use client'
import { useActionState } from 'react'

import { draftFor } from '../actions'

// The "Draft it" button on a promise: asks the assistant for a follow-up
// draft and shows that it is writing.
export function DraftButton({ fields, label, title }: { fields: Record<string, string>; label: string; title: string }) {
  const [error, action, pending] = useActionState(async (_: string | null, form: FormData) => {
    try {
      await draftFor(form)
      return null
    } catch (e) {
      return (e as Error).message
    }
  }, null)
  return (
    <form action={action} className="draft-it">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className="small" disabled={pending} aria-label={title}>
        {pending ? 'Drafting…' : label}
      </button>
      {error && <span className="hint"> {error}</span>}
    </form>
  )
}
