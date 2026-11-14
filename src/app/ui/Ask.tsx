'use client'
import { useActionState } from 'react'

import { ask, type AskState } from '../actions'
import { Text } from './Text'

export function Ask({ mailbox }: { mailbox: string }) {
  const [state, action, pending] = useActionState<AskState, FormData>(ask, { said: [], reply: null, thread: null })
  return (
    <section className="ask">
      <form action={action}>
        <input type="hidden" name="mailbox" value={mailbox} />
        <input name="text" placeholder="Tell the assistant what to do, e.g. “Tell Domenico 42 and 13:00”" autoComplete="off" disabled={pending} aria-label="Message to the assistant" />
        <button disabled={pending}>{pending ? 'Working…' : 'Go'}</button>
      </form>
      {state.said.length > 0 && <p className="you">{state.said.at(-1)}</p>}
      {state.reply && <div className="reply"><Text text={state.reply} /></div>}
      {state.error && <p className="reply error">{state.error}</p>}
    </section>
  )
}
