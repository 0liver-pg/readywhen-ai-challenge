// Extracts the promises in Elena's mail: who said they would do what, for
// whom, by when, in their exact words, and whether a later message shows it
// done. One model call per conversation; the result is saved to
// data/promises.json so the UI is free to load and the same for everyone.
//   node --env-file=.env scripts/promises.ts
import { readFileSync, writeFileSync } from 'node:fs'

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

const MODEL = 'claude-sonnet-5-5'
type Addr = { name: string | null; email: string }
type Msg = { id: string; threadId: string; date: string; from: Addr; to: Addr[]; cc: Addr[]; subject: string; body: string; labels: string[] }
const { messages, now } = JSON.parse(readFileSync('data/inbox.json', 'utf8')) as { messages: Msg[]; now: string }
const owner = readFileSync('data/owner.md', 'utf8')

const Promise_ = z.object({
  who: z.string().describe('Who made the promise: "Elena", a Lume teammate\'s first name, or the outside person\'s name'),
  side: z.enum(['elena', 'team', 'them']).describe('elena = Elena promised; team = someone at Lume (not Elena); them = a client, venue, supplier or adviser'),
  toWhom: z.string().describe('Who it is owed to (name)'),
  what: z.string().describe('What was promised, in at most 12 plain words, starting with a verb ("Send the revised quote")'),
  due: z.string().nullable().describe('Due date as YYYY-MM-DD if stated or clearly implied ("Monday" from a Friday 11 Sept message = 2026-09-14); null if none'),
  quote: z.string().describe('The exact words of the promise from the message, at most 25 words'),
  messageId: z.string().describe('Id of the message containing the promise'),
  status: z.enum(['open', 'done', 'dropped']).describe('done only if a later message in this conversation shows it was done'),
  doneBy: z.string().nullable().describe('Id of the message that shows it done, or null'),
  shoot: z.string().nullable().describe('Which job it belongs to, as the client name used in the owner notes (e.g. "Vandermeer Outdoor"), or null'),
})
const Out = z.object({ promises: z.array(Promise_) })

const SYSTEM = `You read one email conversation from the mailbox of Elena Conti, owner of Lume Locations (a location and production agency in Milan), and list the promises in it: a person committing to do something specific for someone else ("I will send you the deck on Wednesday", "we'll confirm by Friday", "I'll come back to you on Monday"). Not requests, not wishes, not marketing, not automated notices. Include promises by Elena, by her team and by the people they deal with. Be precise and quote exactly. Return an empty list when there are none.

Who's who:
${owner}`

const ownDomain = '@lumelocations.it'
const automated = /noreply|no-reply|newsletter|news@|promo@|digest@|avvisi|notifications?@|@cloudfiles|venuedesk|shootplanner|taxi|parcelgo|contoprima|fotomercato|noleggioluce-news/i
const threads = new Map<string, Msg[]>()
for (const m of messages) threads.set(m.threadId, [...(threads.get(m.threadId) ?? []), m])
const relevant = [...threads.values()].filter((t) => t.some((m) => !automated.test(m.from.email)) && t.some((m) => m.from.email.endsWith(ownDomain) || m.to.some((a) => a.email.endsWith(ownDomain))))

const client = new Anthropic()
const fmt = (m: Msg) => `[${m.id}] ${m.date.slice(0, 16).replace('T', ' ')} UTC  From: ${m.from.name ?? ''} <${m.from.email}>  To: ${m.to.map((a) => a.name ?? a.email).join(', ')}\nSubject: ${m.subject}\n${m.body.slice(0, 4000)}`

let usd = 0
const out: (z.infer<typeof Promise_> & { threadId: string; subject: string; date: string })[] = []
let i = 0
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (i < relevant.length) {
      const t = relevant[i++].sort((a, b) => a.date.localeCompare(b.date))
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(Out) },
        messages: [{ role: 'user', content: `Today is ${now.slice(0, 10)} (Friday). Conversation, oldest first:\n\n${t.map(fmt).join('\n\n---\n\n')}` }],
      })
      usd += (res.usage.input_tokens * 2 + res.usage.output_tokens * 10) / 1e6
      for (const p of res.parsed_output?.promises ?? []) {
        const src = t.find((m) => m.id === p.messageId)
        if (!src) continue // a promise must point at a real message in this conversation
        out.push({ ...p, threadId: t[0].threadId, subject: t[0].subject, date: src.date })
      }
      process.stdout.write(`\r  ${i}/${relevant.length} conversations, ${out.length} promises, $${usd.toFixed(2)}`)
    }
  }),
)
out.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.date.localeCompare(a.date))
writeFileSync('data/promises.json', JSON.stringify({ model: MODEL, extractedAt: new Date().toISOString(), conversations: relevant.length, usd, promises: out }, null, 1))
console.log(`\nwrote data/promises.json: ${out.length} promises from ${relevant.length} conversations, $${usd.toFixed(2)}`)

// Pass 2: a promise made in one conversation is often kept in another. For
// each open one, show the model the later mail between the same people,
// anywhere in the mailbox, and ask whether it was kept.
const Check = z.object({
  status: z.enum(['open', 'done', 'dropped']).describe('done: a later message shows it happened; dropped: superseded or no longer needed; open: no evidence either way'),
  doneBy: z.string().nullable().describe('Id of the message that shows it, or null'),
})
const tokens = (s: string) => s.toLowerCase().split(/[^a-zà-ú]+/).filter((w) => w.length >= 3 && !['and', 'the', 'elena', 'lume', 'team'].includes(w))
const open = out.filter((p) => p.status === 'open')
let j = 0
let changed = 0
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (j < open.length) {
      const p = open[j++]
      const people = [...tokens(p.toWhom), ...tokens(p.who)]
      const later = messages
        .filter((m) => m.date > p.date && m.id !== p.messageId)
        .filter((m) => people.some((w) => `${m.from.name ?? ''} ${m.from.email} ${m.to.map((a) => `${a.name ?? ''} ${a.email}`).join(' ')}`.toLowerCase().includes(w)))
        .slice(0, 10)
      if (!later.length) continue
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 2000,
        system: 'You check whether a promise made in email was kept. Answer only from the messages shown.',
        output_config: { effort: 'low', format: zodOutputFormat(Check) },
        messages: [{ role: 'user', content: `Today is ${now.slice(0, 10)}.\nPROMISE (${p.date.slice(0, 10)}, ${p.who} to ${p.toWhom}): ${p.what}\nTheir words: "${p.quote}"\n\nLATER MESSAGES:\n\n${later.map((m) => fmt({ ...m, body: m.body.slice(0, 1500) })).join('\n\n---\n\n')}` }],
      })
      usd += (res.usage.input_tokens * 2 + res.usage.output_tokens * 10) / 1e6
      const c = res.parsed_output
      if (c && c.status !== 'open' && later.some((m) => m.id === c.doneBy)) {
        p.status = c.status
        p.doneBy = c.doneBy
        changed++
      }
      process.stdout.write(`\r  checked ${j}/${open.length} open promises, ${changed} kept or dropped elsewhere, $${usd.toFixed(2)}`)
    }
  }),
)
writeFileSync('data/promises.json', JSON.stringify({ model: MODEL, extractedAt: new Date().toISOString(), conversations: relevant.length, usd, promises: out }, null, 1))
console.log(`\nupdated data/promises.json: ${out.filter((p) => p.status === 'open').length} still open of ${out.length}, $${usd.toFixed(2)} in total`)
