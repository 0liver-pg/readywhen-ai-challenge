// Elena's Friday: what is waiting for her decision, what she and others have
// promised, and each shoot's open loose ends. Server-rendered from the mail
// store and the promise ledger; the only writes are her own buttons.
import { notFound } from 'next/navigation'

import { MailboxId } from '@/mail/contract'
import { getMailbox, listDrafts, listHeld, listOutbox, NotFound } from '@/mail/store'
import { bucket, load, when, type Bucket, type Promise_ } from '@/lib/promises'

import { discard, sendAnyway, sendMine, undo } from './actions'
import { Ask } from './ui/Ask'
import { Countdown } from './ui/Countdown'
import { DraftButton } from './ui/DraftButton'

const BUCKETS: [Bucket, string][] = [
  ['slipping', 'Slipping: the date passed and nothing shows it happened'],
  ['today', 'Due today'],
  ['soon', 'Next seven days'],
  ['undated', 'Said this week, no date'],
]
const SIDES: [Promise_['side'], string][] = [
  ['elena', 'You promised'],
  ['team', 'Your team promised'],
  ['them', 'Others owe you'],
]

export default async function Page({ searchParams }: { searchParams: Promise<{ mb?: string; view?: string }> }) {
  const { mb = 'main', view = 'promises' } = await searchParams
  const parsed = MailboxId.safeParse(mb)
  if (!parsed.success) notFound()
  const mailbox = parsed.data
  const [box, held, drafts, outbox] = await Promise.all([getMailbox(mailbox), listHeld(mailbox), listDrafts(mailbox), listOutbox(mailbox)]).catch((e) => {
    if (e instanceof NotFound) notFound()
    throw e
  })
  const today = box.now.slice(0, 10)
  const { promises, shoots } = load()
  const live = promises.map((p) => ({ p, b: bucket(p, today) })).filter((x) => x.b)
  const mine = live.filter((x) => x.p.side === 'elena')
  const slippingMine = mine.filter((x) => x.b === 'slipping').length
  const date = new Date(box.now).toLocaleString('en-GB', { timeZone: box.timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

  return (
    <main>
      <header>
        <p className="date">{date}</p>
        <h1>
          {outbox.length ? `${outbox.length} email${outbox.length > 1 ? 's' : ''} about to go. ` : ''}
          {held.length ? `${held.length} email${held.length > 1 ? 's' : ''} waiting for your say. ` : ''}
          {slippingMine ? `${slippingMine} of your promises ${slippingMine > 1 ? 'have' : 'has'} slipped.` : 'Nothing you promised has slipped.'}
        </h1>
        <nav>
          <a href={`/?mb=${mb}&view=promises`} aria-current={view === 'promises' ? 'page' : undefined}>Promises</a>
          <a href={`/?mb=${mb}&view=shoots`} aria-current={view === 'shoots' ? 'page' : undefined}>Shoots</a>
        </nav>
      </header>

      <Ask mailbox={mb} />

      {outbox.length > 0 && (
        <section>
          <h2>Sending soon</h2>
          <p className="hint">These passed the send check and leave on their own. Undo puts one back in Drafts.</p>
          {outbox.map((o) => (
            <article key={o.id} className="outbox">
              <p className="who">To {[...o.to, ...o.cc].map((a) => a.name ?? a.email).join(', ')} · {o.subject}</p>
              <details>
                <summary>Read the email</summary>
                <pre>{o.body}</pre>
              </details>
              <div className="actions">
                <Countdown sendsAt={o.sendsAt} mailboxNow={box.now} />
                <form action={undo}>
                  <input type="hidden" name="mailbox" value={mb} />
                  <input type="hidden" name="messageId" value={o.id} />
                  <button className="quiet" aria-label={`Undo the email to ${o.to[0]?.name ?? o.to[0]?.email}`}>Undo</button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}

      {held.length > 0 && (
        <section>
          <h2>Held for you</h2>
          <p className="hint">The assistant tried to send these. They didn’t go: something you, or someone you work with, said earlier points the other way.</p>
          {held.map((h) => (
            <article key={h.id} className="held">
              <p className="who">To {[...h.to, ...h.cc].map((a) => a.name ?? a.email).join(', ')} · {h.subject}</p>
              <p className="why">{h.hold.reason}</p>
              {h.hold.evidence.length > 0 && <blockquote>{h.hold.evidence[0]}</blockquote>}
              <details>
                <summary>Read the email</summary>
                <pre>{h.body}</pre>
              </details>
              <div className="actions">
                <form action={sendAnyway}>
                  <input type="hidden" name="mailbox" value={mb} />
                  <input type="hidden" name="draftId" value={h.id} />
                  <input type="hidden" name="seen" value={h.contentHash} />
                  <button aria-label={`Send the email to ${h.to[0]?.name ?? h.to[0]?.email} anyway`}>Send it anyway</button>
                </form>
                <form action={discard}>
                  <input type="hidden" name="mailbox" value={mb} />
                  <input type="hidden" name="draftId" value={h.id} />
                  <button className="quiet" aria-label={`Discard the email to ${h.to[0]?.name ?? h.to[0]?.email}`}>Discard</button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}

      {drafts.length > 0 && (
        <section>
          <h2>Drafts for you</h2>
          <p className="hint">Written by the assistant, not sent. Edit if you like, then send or discard.</p>
          {drafts.map((d) => (
            <article key={d.id} className="draft">
              <p className="who">To {[...d.to, ...d.cc].map((a) => a.name ?? a.email).join(', ')} · {d.subject}</p>
              <form action={sendMine} id={`send-${d.id}`}>
                <input type="hidden" name="mailbox" value={mb} />
                <input type="hidden" name="draftId" value={d.id} />
                <input type="hidden" name="seen" value={d.contentHash} />
                <textarea name="body" defaultValue={d.body} rows={Math.min(14, d.body.split('\n').length + 1)} aria-label={`Draft to ${d.to[0]?.name ?? d.to[0]?.email}`} />
                {/\[[a-z ]{2,20}\]/i.test(d.body) && <p className="flag">Fill in the part in [brackets] first.</p>}
              </form>
              <div className="actions">
                <button form={`send-${d.id}`} aria-label={`Send the draft to ${d.to[0]?.name ?? d.to[0]?.email}`}>Send</button>
                <form action={discard}>
                  <input type="hidden" name="mailbox" value={mb} />
                  <input type="hidden" name="draftId" value={d.id} />
                  <button className="quiet" aria-label={`Discard the draft to ${d.to[0]?.name ?? d.to[0]?.email}`}>Discard</button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}

      {view === 'promises' &&
        SIDES.map(([side, title]) => {
          const xs = live.filter((x) => x.p.side === side)
          return (
            <section key={side}>
              <h2>{title}</h2>
              {BUCKETS.map(([b, label]) => {
                const ys = xs.filter((x) => x.b === b)
                if (!ys.length) return null
                return (
                  <div key={b} className={`bucket ${b}`}>
                    <h3>{label}</h3>
                    <ul>{ys.map(({ p }, i) => <Item key={`${p.messageId}-${p.toWhom}-${i}`} p={p} today={today} mb={mb} />)}</ul>
                  </div>
                )
              })}
              {!xs.length && <p className="hint">Nothing open.</p>}
            </section>
          )
        })}

      {view === 'shoots' && (
        <section>
          <h2>Coming up</h2>
          <div className="shoots">
            {shoots.map((s) => {
              const xs = live.filter((x) => x.p.shoot === s.client)
              const h = held.filter((m) => s.client && `${m.subject} ${m.body}`.includes(s.client.split(' ')[0]))
              return (
                <article key={s.date + s.title} className="shoot">
                  <p className="date">{when(s.date, today)}</p>
                  <h3>{s.title}</h3>
                  {h.length > 0 && <p className="flag">{h.length} email held for you</p>}
                  {xs.length ? (
                    <ul>{xs.slice(0, 6).map(({ p }, i) => <Item key={`${p.messageId}-${p.toWhom}-${i}`} p={p} today={today} compact />)}</ul>
                  ) : (
                    <p className="hint">No open promises.</p>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}
    </main>
  )
}

const DRAFT_LABEL = { elena: ['Draft an update', 'Draft an update to'], them: ['Draft a chase', 'Draft a chase to'], team: ['Draft a nudge', 'Draft a nudge to'] } as const

function Item({ p, today, compact = false, mb }: { p: Promise_; today: string; compact?: boolean; mb?: string }) {
  const [label, aria] = DRAFT_LABEL[p.side]
  return (
    <li>
      {!compact && mb && (
        <DraftButton
          fields={{ mailbox: mb, side: p.side, who: p.who, toWhom: p.toWhom, quote: p.quote, messageId: p.messageId, subject: p.subject, date: p.date.slice(0, 10) }}
          label={label}
          title={`${aria} ${p.side === 'elena' ? p.toWhom : p.who}: ${p.what}`}
        />
      )}
      <p>
        <span className="due">{when(p.due, today)}</span> {compact ? `${p.who}: ` : ''}
        {p.what} <span className="to">for {p.toWhom}</span>
      </p>
      {!compact && (
        <p className="quote">
          “{p.quote}” <span className="src">{p.who}, {new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, {p.messageId}</span>
        </p>
      )}
    </li>
  )
}
