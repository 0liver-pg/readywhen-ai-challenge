// The mailbox: Postgres behind a Gmail-shaped model. Every mailbox is an
// independent copy of data/inbox.json, so a test run can fork its own and
// never needs a reset.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import postgres from 'postgres'

import {
  type Address,
  type AttachmentId,
  type AttachmentMeta,
  type Compose,
  type DraftPatch,
  type Label,
  type Mailbox,
  type Message,
  type MessageId,
  type MessageSummary,
  type Modify,
  type SearchQuery,
  type ThreadId,
  EmailAddress,
  MailboxId,
  SYSTEM_LABELS,
} from './contract'
import { decide, type GateDecision, type Recipient, type Said } from './gate'

export const UNDO_SECONDS = Number(process.env.UNDO_SECONDS ?? 300)

export class NotFound extends Error {}
export class Invalid extends Error {}

// One pool per process: `next dev` re-evaluates this module on every edit, and
// a fresh pool each time runs Postgres out of connections.
const g = globalThis as typeof globalThis & { mailSql?: postgres.Sql }
const sql = (g.mailSql ??= postgres(process.env.DATABASE_URL ?? 'postgres://inbox:inbox@localhost:54320/inbox', { max: 10, onnotice: () => {} }))

const SCHEMA = `
  create schema if not exists mail;
  create table if not exists mail.mailbox (
    id text primary key,
    owner jsonb not null,
    time_zone text not null,
    clock timestamptz not null,
    created_at timestamptz not null default now()
  );
  create table if not exists mail.message (
    mailbox_id text not null references mail.mailbox(id) on delete cascade,
    id text not null,
    thread_id text not null,
    sender jsonb not null,
    to_addrs jsonb not null,
    cc jsonb not null,
    bcc jsonb not null,
    subject text not null,
    body text not null,
    sent_at timestamptz not null,
    labels text[] not null,
    in_reply_to text,
    attachments jsonb not null,
    primary key (mailbox_id, id)
  );
  create index if not exists message_by_date on mail.message (mailbox_id, sent_at desc);
  create index if not exists message_by_thread on mail.message (mailbox_id, thread_id);
  create table if not exists mail.gate_log (
    mailbox_id text not null references mail.mailbox(id) on delete cascade,
    message_id text not null,
    decision text not null,
    reason text not null,
    evidence jsonb not null,
    elena_said jsonb not null,
    said_hash text not null,
    model text not null,
    ms integer not null,
    error text,
    decided_at timestamptz not null default now()
  );
  create index if not exists gate_log_by_message on mail.gate_log (mailbox_id, message_id);
  alter table mail.gate_log add column if not exists topic text;
`

type StoredAttachment = AttachmentMeta & { content: string }
type Fixture = { owner: Address; timeZone: string; now: string; messages: (Omit<Message, 'attachments'> & { attachments: StoredAttachment[] })[] }

type Row = {
  id: string
  thread_id: string
  sender: Address
  to_addrs: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  body: string
  sent_at: Date
  labels: string[]
  in_reply_to: string | null
  attachments: StoredAttachment[]
}

let fixture: Fixture | undefined
function loadFixture(): Fixture {
  fixture ??= JSON.parse(readFileSync(path.join(process.cwd(), 'data/inbox.json'), 'utf8')) as Fixture
  return fixture
}

export async function boot() {
  await sql.unsafe(SCHEMA)
  await createMailbox(MailboxId.parse('main'))
}

export async function createMailbox(id = MailboxId.parse(`mbx_${randomBytes(5).toString('hex')}`)): Promise<Mailbox> {
  const { owner, timeZone, now, messages } = loadFixture()
  await sql.begin(async (tx) => {
    const created = await tx`
      insert into mail.mailbox (id, owner, time_zone, clock) values (${id}, ${tx.json(owner)}, ${timeZone}, ${now})
      on conflict do nothing returning id`
    if (created.length === 0) return
    const rows = messages.map((m) => ({
      mailbox_id: id,
      id: m.id,
      thread_id: m.threadId,
      sender: sql.json(m.from),
      to_addrs: sql.json(m.to),
      cc: sql.json(m.cc),
      bcc: sql.json(m.bcc),
      subject: m.subject,
      body: m.body,
      sent_at: m.date,
      labels: m.labels,
      in_reply_to: m.inReplyTo,
      attachments: sql.json(m.attachments),
    }))
    for (let i = 0; i < rows.length; i += 500) {
      await tx`insert into mail.message ${tx(rows.slice(i, i + 500))}`
    }
  })
  return getMailbox(id)
}

// The fixture is frozen at a fixed "now"; a mailbox's clock starts there and
// runs at real speed, so dates in a run stay deterministic.
export async function getMailbox(id: MailboxId): Promise<Mailbox> {
  const [row] = await sql<{ owner: Address; time_zone: string; now: Date }[]>`
    select owner, time_zone, clock + (now() - created_at) as now from mail.mailbox where id = ${id}`
  if (!row) throw new NotFound(`no mailbox ${id}`)
  return { id, owner: row.owner, timeZone: row.time_zone, now: row.now.toISOString() }
}

export async function search(id: MailboxId, q: SearchQuery): Promise<{ messages: MessageSummary[]; nextPageToken: string | null }> {
  await getMailbox(id)
  await releaseDue(id)
  const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`
  const where = [sql`mailbox_id = ${id}`]
  if (q.text) where.push(sql`(subject ilike ${like(q.text)} or body ilike ${like(q.text)} or sender::text ilike ${like(q.text)})`)
  if (q.from) where.push(sql`sender::text ilike ${like(q.from)}`)
  if (q.to) where.push(sql`(to_addrs::text ilike ${like(q.to)} or cc::text ilike ${like(q.to)})`)
  if (q.subject) where.push(sql`subject ilike ${like(q.subject)}`)
  if (q.threadId) where.push(sql`thread_id = ${q.threadId}`)
  if (q.label) where.push(sql`${q.label} = any(labels)`)
  if (q.label !== 'TRASH') where.push(sql`not ('TRASH' = any(labels))`)
  if (q.unread !== undefined) where.push(q.unread ? sql`'UNREAD' = any(labels)` : sql`not ('UNREAD' = any(labels))`)
  if (q.hasAttachments !== undefined) where.push(q.hasAttachments ? sql`jsonb_array_length(attachments) > 0` : sql`jsonb_array_length(attachments) = 0`)
  if (q.after) where.push(sql`sent_at >= ${q.after}::date`)
  if (q.before) where.push(sql`sent_at < ${q.before}::date`)
  const conditions = where.reduce((all, next) => sql`${all} and ${next}`)

  // ponytail: offset paging over an ILIKE scan; fine for a few thousand rows, keyset + tsvector past ~50k
  const offset = Number(q.pageToken ?? 0)
  const rows = await sql<Row[]>`
    select * from mail.message where ${conditions}
    order by sent_at desc, id desc limit ${q.limit + 1} offset ${offset}`
  const page = rows.slice(0, q.limit)
  return {
    messages: page.map((row) => {
      const { body, ...rest } = toMessage(row)
      return { ...rest, snippet: body.replace(/\s+/g, ' ').slice(0, 160) }
    }),
    nextPageToken: rows.length > q.limit ? String(offset + q.limit) : null,
  }
}

export async function getMessage(id: MailboxId, messageId: MessageId): Promise<Message> {
  return toMessage(await getRow(id, messageId))
}

export async function getThread(id: MailboxId, threadId: ThreadId): Promise<Message[]> {
  await releaseDue(id)
  const rows = await sql<Row[]>`
    select * from mail.message where mailbox_id = ${id} and thread_id = ${threadId} order by sent_at, id`
  if (rows.length === 0) throw new NotFound(`no thread ${threadId}`)
  return rows.map(toMessage)
}

export async function getAttachment(id: MailboxId, messageId: MessageId, attachmentId: AttachmentId): Promise<StoredAttachment> {
  const attachment = (await getRow(id, messageId)).attachments.find((a) => a.id === attachmentId)
  if (!attachment) throw new NotFound(`no attachment ${attachmentId} on ${messageId}`)
  return attachment
}

// ---- sending, through the gate ----------------------------------------------
// Every email leaves through sendDraft, and sendDraft asks the gate first, so
// there is one checkpoint below the assistant and it sees the email exactly as
// it will go. `elenaSaid` is Elena's own chat turns, passed by the caller (the
// UI or the eval) in a header the model never touches.
export type SendContext = { elenaSaid?: string[] }
export type Held = { status: 'held'; draftId: MessageId; reason: string; evidence: string[] }
export type SendResult = (Message & { status: 'sent' | 'queued'; sendsAt?: string }) | Held

export async function send(id: MailboxId, compose: Compose, ctx: SendContext = {}): Promise<SendResult> {
  const draft = await insertAuthored(id, compose, 'DRAFT')
  return sendDraft(id, draft.id, ctx)
}

export async function createDraft(id: MailboxId, compose: Compose): Promise<Message> {
  return insertAuthored(id, compose, 'DRAFT')
}

export async function updateDraft(id: MailboxId, draftId: MessageId, patch: DraftPatch): Promise<Message> {
  const draft = await getDraftRow(id, draftId)
  // A held draft is waiting for Elena: changing it would let her approve
  // words she never read, so only she (sending or discarding it) can act on it.
  if (draft.labels.includes('HELD')) throw new Invalid(`${draftId} is held for Elena to review and can't be changed`)
  const [row] = await sql<Row[]>`
    update mail.message set
      to_addrs = ${sql.json(patch.to ? patch.to.map(toAddress) : draft.to_addrs)},
      cc = ${sql.json(patch.cc ? patch.cc.map(toAddress) : draft.cc)},
      bcc = ${sql.json(patch.bcc ? patch.bcc.map(toAddress) : draft.bcc)},
      subject = ${patch.subject ?? draft.subject},
      body = ${patch.body ?? draft.body}
    where mailbox_id = ${id} and id = ${draftId} returning *`
  return toMessage(row)
}

export async function deleteDraft(id: MailboxId, draftId: MessageId): Promise<void> {
  await getDraftRow(id, draftId)
  await sql`delete from mail.message where mailbox_id = ${id} and id = ${draftId}`
}

export async function sendDraft(id: MailboxId, draftId: MessageId, ctx: SendContext = {}): Promise<SendResult> {
  const draft = await getDraftRow(id, draftId)
  if (draft.to_addrs.length === 0) throw new Invalid('the draft has no recipients')
  if (process.env.SEND_GATE !== 'off') {
    const held = await gate(id, draft, ctx.elenaSaid ?? [])
    if (held) return held
  }
  // Only the exact email the gate checked may leave: if the draft was edited
  // while the check ran, nothing is sent.
  const m = await markSent(id, draft)
  return m.labels.includes('OUTBOX' as Label) ? { ...m, status: 'queued', sendsAt: m.date } : { ...m, status: 'sent' }
}

// Turns every due OUTBOX message into SENT. Mailbox time = clock + (now() - created_at).
export async function releaseDue(id?: MailboxId): Promise<number> {
  const rows = await sql`
    update mail.message m set labels = '{SENT}'
    from mail.mailbox b
    where b.id = m.mailbox_id and 'OUTBOX' = any(m.labels) and not ('TRASH' = any(m.labels))
      and m.sent_at <= b.clock + (now() - b.created_at)
      and (${id ?? null}::text is null or m.mailbox_id = ${id ?? null})
    returning m.id`
  return rows.length
}

export async function listOutbox(id: MailboxId): Promise<(Message & { sendsAt: string })[]> {
  await releaseDue(id)
  const rows = await sql<Row[]>`
    select * from mail.message where mailbox_id = ${id} and 'OUTBOX' = any(labels) order by sent_at`
  return rows.map((r) => ({ ...toMessage(r), sendsAt: new Date(r.sent_at).toISOString() }))
}

// Elena takes a queued email back into Drafts. Not an HTTP route.
export async function undoSend(id: MailboxId, messageId: MessageId): Promise<Message> {
  await releaseDue(id)
  const { now } = await getMailbox(id)
  const [row] = await sql<Row[]>`
    update mail.message set labels = '{DRAFT}', sent_at = ${now}
    where mailbox_id = ${id} and id = ${messageId} and 'OUTBOX' = any(labels) returning *`
  if (!row) throw new Invalid('Too late: it has already gone.')
  return toMessage(row)
}

// Elena's own "send it" on a held draft, from her screen. Deliberately not an
// HTTP route: the assistant's tools can only reach the mail API, so they
// cannot call this.
export async function approveHeld(id: MailboxId, draftId: MessageId, seenHash: string): Promise<Message> {
  const draft = await getDraftRow(id, draftId)
  if (!draft.labels.includes('HELD')) throw new Invalid(`${draftId} is not held; only held drafts can be approved here`)
  if (contentHash(draft) !== seenHash) throw new Invalid(`${draftId} changed since it was shown; reload the page`)
  return markSent(id, draft)
}

// What a person or the gate actually looked at: recipients, subject and body.
export function contentHash(m: Pick<Row, 'to_addrs' | 'cc' | 'bcc' | 'subject' | 'body'>): string {
  return createHash('sha256').update(JSON.stringify([m.to_addrs, m.cc, m.bcc, m.subject, m.body])).digest('hex')
}

// What the gate would say, without saving or sending anything (for evals).
export async function checkSend(id: MailboxId, compose: Compose, elenaSaid: string[], model?: string): Promise<GateDecision> {
  const { owner } = await getMailbox(id)
  const parent = compose.replyToMessageId ? await getRow(id, compose.replyToMessageId) : null
  const to = compose.to.length > 0 ? compose.to.map(toAddress) : replyRecipients(parent!, owner)
  const draftLike = {
    id: 'msg_dryrun', thread_id: parent?.thread_id ?? 'thr_new', to_addrs: to, cc: compose.cc.map(toAddress), bcc: compose.bcc.map(toAddress),
    subject: compose.subject ?? (parent ? withReplyPrefix(parent.subject) : '(no subject)'), body: compose.body,
  }
  return (await askGate(id, draftLike, elenaSaid, model)).decision
}

// Drafts the assistant wrote in this session that aren't held: waiting for
// Elena to send or discard. (Fixture drafts from before the session are hers.)
export async function listDrafts(id: MailboxId): Promise<(Message & { contentHash: string })[]> {
  const rows = await sql<Row[]>`
    select m.* from mail.message m join mail.mailbox b on b.id = m.mailbox_id
    where m.mailbox_id = ${id} and 'DRAFT' = any(m.labels) and not ('HELD' = any(m.labels))
      and not ('TRASH' = any(m.labels)) and m.sent_at >= b.clock
    order by m.sent_at desc`
  return rows.map((r) => ({ ...toMessage(r), contentHash: contentHash(r) }))
}

// Elena sends a draft from her page after reading it: her decision, so no
// gate, but only the exact content she saw, and only a draft from this session.
export async function sendAsElena(id: MailboxId, draftId: MessageId, seenHash: string, body?: string): Promise<Message> {
  let draft = await getDraftRow(id, draftId)
  if (contentHash(draft) !== seenHash) throw new Invalid(`${draftId} changed since it was shown; reload the page`)
  if (body !== undefined && body.trim() && body !== draft.body) {
    const [row] = await sql<Row[]>`update mail.message set body = ${body} where mailbox_id = ${id} and id = ${draftId} returning *`
    draft = row
  }
  // A placeholder the assistant left for her ("[when]") must not go out.
  if (/\[[a-z ]{2,20}\]/i.test(draft.body)) throw new Invalid('Fill in the part in [brackets] before sending.')
  return markSent(id, draft)
}

export type HeldItem = Message & { hold: { reason: string; evidence: string[]; decidedAt: string }; contentHash: string }
export async function listHeld(id: MailboxId): Promise<HeldItem[]> {
  const rows = await sql<(Row & { reason: string; evidence: string[]; decided_at: Date })[]>`
    select m.*, g.reason, g.evidence, g.decided_at from mail.message m
    join lateral (select * from mail.gate_log g where g.mailbox_id = m.mailbox_id and g.message_id = m.id order by decided_at desc limit 1) g on true
    where m.mailbox_id = ${id} and 'HELD' = any(m.labels) and 'DRAFT' = any(m.labels)
    order by g.decided_at desc`
  return rows.map((r) => ({ ...toMessage(r), hold: { reason: r.reason, evidence: r.evidence, decidedAt: r.decided_at.toISOString() }, contentHash: contentHash(r) }))
}

type DraftLike = Pick<Row, 'id' | 'thread_id' | 'to_addrs' | 'cc' | 'bcc' | 'subject' | 'body'>

const MAX_HOLDS_PER_TOPIC = 2

async function gate(id: MailboxId, draft: Row, elenaSaid: string[]): Promise<Held | null> {
  const saidHash = createHash('sha256').update(JSON.stringify([elenaSaid, contentHash(draft)])).digest('hex')
  // The topic: what Elena said, and who it goes to. Rewording the email or
  // making a new draft doesn't change it.
  const people = [...draft.to_addrs, ...draft.cc, ...draft.bcc].map((a) => a.email).sort()
  const topic = createHash('sha256').update(JSON.stringify([elenaSaid, people])).digest('hex')
  const hold = async (reason: string, evidence: string[], model: string) => {
    await sql`insert into mail.gate_log ${sql({
      mailbox_id: id, message_id: draft.id, decision: 'hold', reason, evidence: sql.json(evidence),
      elena_said: sql.json(elenaSaid), said_hash: saidHash, topic, model, ms: 0, error: null,
    })}`
    await sql`update mail.message set labels = array_append(labels, 'HELD')
              where mailbox_id = ${id} and id = ${draft.id} and not ('HELD' = any(labels))`
    return { status: 'held' as const, draftId: draft.id as MessageId, reason, evidence }
  }

  // 1. The same email, with nothing new from Elena, gets the answer it got
  //    before (by content, not by draft id, so a fresh draft doesn't re-roll).
  //    Errors are not remembered: a timeout must not become a permanent hold.
  const [prev] = await sql<{ message_id: string; reason: string; evidence: string[] }[]>`
    select message_id, reason, evidence from mail.gate_log
    where mailbox_id = ${id} and said_hash = ${saidHash} and decision = 'hold' and error is null
    order by decided_at desc limit 1`
  if (prev) {
    // A copy of an email that is already waiting for Elena: drop the copy.
    if (prev.message_id !== draft.id) {
      const [still] = await sql`select 1 from mail.message where mailbox_id = ${id} and id = ${prev.message_id} and 'HELD' = any(labels) and 'DRAFT' = any(labels)`
      if (still) {
        await sql`delete from mail.message where mailbox_id = ${id} and id = ${draft.id} and not ('HELD' = any(labels))`
        return { status: 'held', draftId: prev.message_id as MessageId, reason: prev.reason, evidence: prev.evidence }
      }
    }
    return hold(prev.reason, prev.evidence, 'cache')
  }

  // 3. Reworded retries to the same people, with nothing new from Elena, get
  //    at most two looks; after that the hold stands until she says something.
  // 2. No words from Elena in this conversation: nothing goes, decided by
  //    code, not left to the model.
  if (elenaSaid.length === 0) return hold("You haven't asked for anything in this conversation, so the assistant doesn't send on its own.", [], 'no-words')

  // 3. Reworded retries to the same people, with nothing new from Elena, get
  //    at most two real checks; after that this one is held too, with the
  //    evidence from the last real check, until she says something new.
  const looks = await sql<{ reason: string; evidence: string[] }[]>`
    select reason, evidence from mail.gate_log
    where mailbox_id = ${id} and topic = ${topic} and decision = 'hold' and error is null and model not in ('cache', 'cap', 'no-words')
    order by decided_at desc`
  if (looks.length >= MAX_HOLDS_PER_TOPIC) {
    return hold(`Held twice already for the same people with nothing new from you, so this waits for you too. Last time: ${looks[0].reason}`, looks[0].evidence, 'cap')
  }

  const { decision: d } = await askGate(id, draft, elenaSaid)
  await sql`insert into mail.gate_log ${sql({
    mailbox_id: id, message_id: draft.id, decision: d.decision, reason: d.reason, evidence: sql.json(d.evidence),
    elena_said: sql.json(elenaSaid), said_hash: saidHash, topic, model: d.model, ms: d.ms, error: d.error ?? null,
  })}`
  if (d.decision === 'send') return null
  await sql`update mail.message set labels = array_append(labels, 'HELD')
            where mailbox_id = ${id} and id = ${draft.id} and not ('HELD' = any(labels))`
  return { status: 'held', draftId: draft.id as MessageId, reason: d.reason, evidence: d.evidence }
}

// The gate's evidence is found by code, never chosen by the assistant: Elena's
// own messages from before the session started (so nothing the assistant sent
// can pose as her) that are in this thread or name any recipient.
async function askGate(id: MailboxId, draft: DraftLike, elenaSaid: string[], model?: string) {
  const [{ owner, clock }] = await sql<{ owner: Address; clock: Date }[]>`select owner, clock from mail.mailbox where id = ${id}`
  const people = [...draft.to_addrs, ...draft.cc, ...draft.bcc]
  const words = new Set<string>()
  for (const a of people) {
    const [local, domain] = a.email.toLowerCase().split('@')
    for (const w of [...local.split(/[._-]+/), domain.split('.')[0], ...domain.split('.')[0].split('-'), ...(a.name ?? '').toLowerCase().split(/\s+/)])
      if (/^[a-z]{3,}$/.test(w) && !STOP.has(w)) words.add(w)
  }
  const re = words.size ? `\\m(${[...words].join('|')})\\M` : '^$'
  const standing = await sql<Row[]>`
    select * from mail.message
    where mailbox_id = ${id} and sender->>'email' = ${owner.email} and sent_at < ${clock} and id <> ${draft.id}
      and (thread_id = ${draft.thread_id} or subject ~* ${re} or body ~* ${re})
    order by sent_at desc limit 15`
  const thread = await sql<Row[]>`
    select * from mail.message where mailbox_id = ${id} and thread_id = ${draft.thread_id} and sent_at < ${clock}
    order by sent_at desc limit 6`
  const context = await sql<Row[]>`
    select * from mail.message
    where mailbox_id = ${id} and sender->>'email' <> ${owner.email} and sent_at < ${clock} and sent_at > ${clock}::timestamptz - interval '10 days'
      and thread_id <> ${draft.thread_id} and (subject ~* ${re} or body ~* ${re})
    order by sent_at desc limit 6`
  // Has anyone at Lume written to this address before? And if not, does it
  // look like one they have (same person, different domain)?
  const ownDomain = owner.email.split('@')[1]
  const recipients: Recipient[] = []
  for (const a of people) {
    const [k] = await sql<{ n: number }[]>`
      select count(*)::int as n from mail.message
      where mailbox_id = ${id} and sender->>'email' like ${'%@' + ownDomain} and sent_at < ${clock}
        and (to_addrs @> ${sql.json([{ email: a.email }])} or cc @> ${sql.json([{ email: a.email }])})`
    let similar: string[] = []
    if (k.n === 0 && !a.email.endsWith('@' + ownDomain)) {
      const [local, domain] = a.email.split('@')
      const stem = domain.split(/[.-]/)[0]
      const rows = await sql<{ email: string }[]>`
        select distinct x->>'email' as email from mail.message, jsonb_array_elements(to_addrs || cc) x
        where mailbox_id = ${id} and sender->>'email' like ${'%@' + ownDomain} and sent_at < ${clock}
          and x->>'email' <> ${a.email} and (x->>'email' like ${local + '@%'} or x->>'email' like ${'%@' + stem + '%'})
        limit 5`
      similar = rows.map((r) => r.email)
    }
    recipients.push({ email: a.email, known: k.n > 0 || a.email.endsWith('@' + ownDomain), similar })
  }
  // Attachments included: offers and quotes often live in a PDF, and the
  // assistant may quote them, so the gate has to be able to check them too.
  const withFiles = (r: Row) => r.body + r.attachments.map((a) => `\n[attached ${a.filename}]\n${a.content.slice(0, 2500)}`).join('')
  const said = (r: Row): Said => ({ id: r.id, date: r.sent_at.toISOString(), to: r.to_addrs.map((x) => x.email), subject: r.subject, body: withFiles(r) })
  const decision = await decide({
    email: { to: draft.to_addrs.map((x) => x.email), cc: draft.cc.map((x) => x.email), bcc: draft.bcc.map((x) => x.email), subject: draft.subject, body: draft.body },
    elenaSaid,
    standing: standing.map(said),
    thread: thread.reverse().map(said),
    context: context.map((r) => ({ ...said(r), body: withFiles(r).slice(0, 3000) })),
    recipients,
  }, undefined, model)
  return { decision }
}
const STOP = new Set(['info', 'hello', 'admin', 'accounts', 'office', 'mail', 'team', 'booking', 'bookings', 'noreply', 'reply', 'example', 'lumelocations', 'the', 'and'])

async function markSent(id: MailboxId, checked: Row): Promise<Message> {
  const { now } = await getMailbox(id)
  const queued = UNDO_SECONDS > 0
  const at = queued ? new Date(new Date(now).getTime() + UNDO_SECONDS * 1000).toISOString() : now
  const [row] = await sql<Row[]>`
    update mail.message set labels = ${queued ? '{OUTBOX}' : '{SENT}'}, sent_at = ${at}
    where mailbox_id = ${id} and id = ${checked.id} and 'DRAFT' = any(labels)
      and to_addrs = ${sql.json(checked.to_addrs)} and cc = ${sql.json(checked.cc)} and bcc = ${sql.json(checked.bcc)}
      and subject = ${checked.subject} and body = ${checked.body}
    returning *`
  if (!row) throw new Invalid(`${checked.id} changed while it was being checked, so it was not sent; send it again`)
  return toMessage(row)
}

// Idempotent: adding a label a message already has, or removing one it
// lacks, is not an error. Unknown ids come back in `notFound`.
export async function modify(id: MailboxId, { ids, add, remove }: Modify): Promise<{ modified: MessageId[]; notFound: MessageId[] }> {
  const locked = [...add, ...remove].filter((l) => l === 'SENT' || l === 'DRAFT' || l === 'HELD' || (l as string) === 'OUTBOX')
  if (locked.length > 0) throw new Invalid(`${locked.join(', ')} can't be added or removed; send a draft instead (HELD is set by the send gate and cleared by Elena)`)
  await getMailbox(id)
  const rows = await sql<{ id: MessageId }[]>`
    update mail.message set labels = array(
      select distinct l from unnest(labels || ${add}::text[]) as l where l <> all(${remove}::text[])
    )
    where mailbox_id = ${id} and id = any(${ids}::text[]) returning id`
  const modified = rows.map((r) => r.id)
  return { modified, notFound: ids.filter((i) => !modified.includes(i)) }
}

export async function labels(id: MailboxId): Promise<{ name: string; system: boolean; total: number; unread: number }[]> {
  await getMailbox(id)
  const rows = await sql<{ name: string; total: number; unread: number }[]>`
    select l as name, count(*)::int as total, count(*) filter (where 'UNREAD' = any(labels))::int as unread
    from mail.message, unnest(labels) as l where mailbox_id = ${id} group by l order by l`
  const system = SYSTEM_LABELS.map((name) => ({ name, system: true, total: 0, unread: 0, ...rows.find((r) => r.name === name) }))
  const custom = rows.filter((r) => !system.some((s) => s.name === r.name)).map((r) => ({ ...r, system: false }))
  return [...system, ...custom]
}

// ---- internals -------------------------------------------------------------

async function insertAuthored(id: MailboxId, compose: Compose, label: 'SENT' | 'DRAFT'): Promise<Message> {
  const { owner, now } = await getMailbox(id)
  const parent = compose.replyToMessageId ? await getRow(id, compose.replyToMessageId) : null
  const to = compose.to.length > 0 ? compose.to.map(toAddress) : replyRecipients(parent!, owner)
  const subject = compose.subject ?? (parent ? withReplyPrefix(parent.subject) : '(no subject)')
  const [row] = await sql<Row[]>`
    insert into mail.message ${sql({
      mailbox_id: id,
      id: `msg_${randomBytes(6).toString('hex')}`,
      thread_id: parent?.thread_id ?? `thr_${randomBytes(6).toString('hex')}`,
      sender: sql.json(owner),
      to_addrs: sql.json(to),
      cc: sql.json(compose.cc.map(toAddress)),
      bcc: sql.json(compose.bcc.map(toAddress)),
      subject,
      body: compose.body,
      sent_at: now,
      labels: [label],
      in_reply_to: parent?.id ?? null,
      attachments: sql.json([]),
    })} returning *`
  return toMessage(row)
}

// A reply goes back to the other side: the sender, or the original
// recipients when the owner wrote the message being replied to.
function replyRecipients(parent: Row, owner: Address): Address[] {
  return parent.sender.email === owner.email ? parent.to_addrs : [parent.sender]
}

function withReplyPrefix(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`
}

function toAddress(email: EmailAddress): Address {
  return { name: null, email }
}

async function getRow(id: MailboxId, messageId: MessageId): Promise<Row> {
  const [row] = await sql<Row[]>`select * from mail.message where mailbox_id = ${id} and id = ${messageId}`
  if (!row) throw new NotFound(`no message ${messageId}`)
  return row
}

async function getDraftRow(id: MailboxId, draftId: MessageId): Promise<Row> {
  const row = await getRow(id, draftId)
  if (!row.labels.includes('DRAFT')) throw new NotFound(`${draftId} is not a draft`)
  return row
}

function toMessage(row: Row): Message {
  return {
    id: row.id as MessageId,
    threadId: row.thread_id as ThreadId,
    from: row.sender,
    to: row.to_addrs,
    cc: row.cc,
    bcc: row.bcc,
    subject: row.subject,
    body: row.body,
    date: new Date(row.sent_at).toISOString(),
    labels: row.labels as Label[],
    inReplyTo: row.in_reply_to as MessageId | null,
    attachments: row.attachments.map(({ content: _content, ...meta }) => meta),
  }
}
