'use server'
// Elena's own actions. These run in the web app, not through the mail API, so
// the assistant's tools (which only reach the mail API) can't call them. A real
// deployment would check her session here: Server Functions are reachable by
// direct POST.
import { randomUUID } from 'node:crypto'

import { refresh } from 'next/cache'

import { MailboxId, MessageId } from '@/mail/contract'
import { approveHeld, deleteDraft, sendAsElena, undoSend } from '@/mail/store'

const AGENT = process.env.AGENT_URL ?? 'http://localhost:4111'

export async function sendAnyway(formData: FormData) {
  await approveHeld(MailboxId.parse(formData.get('mailbox')), MessageId.parse(formData.get('draftId')), String(formData.get('seen') ?? ''))
  refresh()
}

export async function sendMine(formData: FormData) {
  await sendAsElena(MailboxId.parse(formData.get('mailbox')), MessageId.parse(formData.get('draftId')), String(formData.get('seen') ?? ''), String(formData.get('body') ?? ''))
  refresh()
}

// One click on a promise: the assistant writes a follow-up and saves it as a
// draft (it is told not to send, and her words say so, so the gate would hold
// a send anyway). The draft appears under "Drafts for you".
export async function draftFor(formData: FormData) {
  const mailbox = MailboxId.parse(formData.get('mailbox'))
  const f = (k: string) => String(formData.get(k) ?? '')
  const ref = `"${f('quote')}" (${f('messageId')}, ${f('date')}, conversation "${f('subject')}")`
  const asks: Record<string, string> = {
    elena: `Draft, but don't send, a short email from me to ${f('toWhom')} about what I promised them: ${ref}. Nothing in my mail shows I did it. Say honestly where it stands and when they'll have it; if you can't tell when from my mail, write [when] for me to fill in. Reply in that conversation, in my voice. Only save the draft.`,
    them: `Draft, but don't send, a short, friendly chase from me to ${f('who')} about what they promised me: ${ref}. Nothing in my mail shows it happened. Ask for it, with a date if one makes sense. Reply in that conversation, in my voice. Only save the draft.`,
    team: `Draft, but don't send, a short note from me to ${f('who')} (my team) checking on this: ${ref}. Nothing in my mail shows it happened. Reply in that conversation, signed E. Only save the draft.`,
  }
  const text = asks[f('side')] ?? asks.elena
  const res = await fetch(`${AGENT}/api/agents/inbox/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
      requestContext: { mailboxId: mailbox, elenaSaid: [text] },
      memory: { thread: `ui-draft-${randomUUID()}`, resource: 'elena' },
    }),
  })
  if (!res.ok) throw new Error(`The assistant didn't answer (${res.status}). Is it running on ${AGENT}?`)
  refresh()
}

export async function discard(formData: FormData) {
  await deleteDraft(MailboxId.parse(formData.get('mailbox')), MessageId.parse(formData.get('draftId')))
  refresh()
}

// Undo on an email waiting in the outbox: it goes back to Drafts. If it has
// already left, the store says so and nothing is changed.
export async function undo(formData: FormData) {
  await undoSend(MailboxId.parse(formData.get('mailbox')), MessageId.parse(formData.get('messageId')))
  refresh()
}

export type AskState = { said: string[]; reply: string | null; thread: string | null; error?: string }

// Talk to the assistant. The UI, not the model, passes Elena's exact words
// (every turn of this conversation) as `elenaSaid`; the send gate decides from
// those, so nothing the assistant writes can stand in for her.
export async function ask(prev: AskState, formData: FormData): Promise<AskState> {
  const text = String(formData.get('text') ?? '').trim()
  const mailbox = MailboxId.parse(formData.get('mailbox'))
  if (!text) return prev
  const thread = prev.thread ?? `ui-${randomUUID()}`
  const said = [...prev.said, text]
  try {
    const res = await fetch(`${AGENT}/api/agents/inbox/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        messages: [{ role: 'user', content: text }],
        requestContext: { mailboxId: mailbox, elenaSaid: said },
        memory: { thread, resource: 'elena' },
      }),
    })
    if (!res.ok) throw new Error(`assistant answered ${res.status}`)
    const data = await res.json()
    refresh()
    return { said, reply: data.text ?? '', thread }
  } catch (e) {
    return { ...prev, error: `The assistant didn't answer (${(e as Error).message}). Is it running on ${AGENT}?` }
  }
}
