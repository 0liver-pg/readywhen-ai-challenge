// npm run eval -- [--variant live|original|never-send|<name>] [--n 3] [--split all|dev|test]
//                 [--only id,id] [--concurrency 6] [--no-judge] [--label name]
//                 [--compare file|none] [--save-baseline]
//
// Every case runs on its own fresh copy of Elena's mailbox and its own memory
// thread, so nothing leaks between cases or repeats. Send / no-send is read
// from the mailbox after every turn, never from what the assistant says.
// Ends with one verdict against the baseline and exits 1 if false sends rose.
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { chatRules, emailRules, lint } from './lib/lint.ts'
import { chat, dollars, getMessage, idsWithLabel, newMailbox, type Message, type Turn } from './lib/mail.ts'
import { judge, JUDGE_MODEL, type JudgeOut } from './lib/judge.ts'
import { verdict } from './lib/verdict.ts'

const AGENT_MODEL = 'claude-sonnet-5-5'

type Match = { to: string; bodyMatches?: string | string[]; why?: string }
type Case = {
  id: string
  kind: 'hold' | 'send' | 'ask' | 'voice'
  split: 'dev' | 'test'
  turns: string[]
  forbid?: Match[]
  require?: Match[]
  orAsk?: boolean
  onlyTo?: string[]
  forbidAfterTurn?: (Match & { turn: number })[]
  requireDraft?: Match[]
  archivedMin?: number
  keepInInbox?: string[]
  evidence: string
}

const { values: opt } = parseArgs({
  options: {
    variant: { type: 'string', default: 'live' },
    n: { type: 'string', default: '3' },
    split: { type: 'string', default: 'all' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
    'no-judge': { type: 'boolean', default: false },
    label: { type: 'string' },
    compare: { type: 'string', default: 'evals/results/baseline.json' },
    'save-baseline': { type: 'boolean', default: false },
  },
})

const all: Case[] = JSON.parse(readFileSync('evals/cases.json', 'utf8')).cases
const cases = all.filter((c) => (opt.split === 'all' || c.split === opt.split) && (!opt.only || opt.only.split(',').includes(c.id)))
const N = Number(opt.n)
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8)
const promptText = readFileSync(opt.variant === 'live' ? 'src/mastra/agents/inbox.md' : `evals/prompts/${opt.variant}.md`, 'utf8')
// What the scores mean: if any of these change, old results are not comparable.
// The send gate is part of the system under test, not of the scoring, so its
// mode is recorded but not hashed: gate on/off runs stay comparable.
const gateInfo = await fetch(`${process.env.MAIL_API_URL ?? 'http://localhost:3000'}/api/mailboxes/main/gate-mode`).then((r) => r.json()).catch(() => ({ mode: 'unknown' }))
const gateMode: string = gateInfo.mode
// A gate without a key fails closed and holds everything: the run would only
// measure the missing key, so refuse instead of reporting nonsense.
if (gateMode === 'on' && gateInfo.keyPresent === false) {
  console.error('The mail API has the send gate on but no ANTHROPIC_API_KEY, so every send would be held. Give the web service the key (see docker-compose.yml) or set SEND_GATE=off.')
  process.exit(2)
}
const harness = sha(['evals/cases.json', 'evals/lib/lint.ts', 'evals/lib/judge.ts'].map((f) => readFileSync(f, 'utf8')).join('\n'))

const recipients = (m: Message) => [...m.to, ...m.cc, ...m.bcc].map((a) => a.email.toLowerCase())
const bodyOk = (m: Message, b?: string | string[]) => [b ?? []].flat().every((re) => new RegExp(re, 'i').test(m.body))
const hits = (ms: Message[], f: Match) => ms.filter((m) => recipients(m).some((e) => e.includes(f.to)) && bodyOk(m, f.bodyMatches))
const brief = (m: Message) => `to ${recipients(m).join(',')}: ${m.body.slice(0, 160).replace(/\s+/g, ' ')}`
const full = (m: Message) => `To: ${recipients(m).join(', ')}\nSubject: ${m.subject}\n\n${m.body}`

type Shaped = { to: string[]; cc?: string[]; bcc?: string[]; primaryTo?: string[]; subject: string; body: string; inReplyTo?: string | null }
type RunResult = {
  case: string
  kind: Case['kind']
  split: Case['split']
  rep: number
  pass: boolean
  failures: string[]
  sent: Shaped[]
  drafts: Shaped[]
  replies: string[]
  tools: string[]
  chatLint: string[]
  emailLint: { to: string[]; failed: string[] }[]
  judge?: JudgeOut
  judgeError?: string
  usd: number
  ms: number
  error?: string
}


async function runOne(c: Case, rep: number): Promise<RunResult> {
  const t0 = Date.now()
  const mb = await newMailbox()
  const watchInbox = Boolean(c.archivedMin || c.keepInInbox)
  const [sent0, drafts0, inbox0] = await Promise.all([
    idsWithLabel(mb, 'SENT'),
    idsWithLabel(mb, 'DRAFT'),
    watchInbox ? idsWithLabel(mb, 'INBOX') : Promise.resolve(new Set<string>()),
  ])
  const thread = `eval-${c.id}-${rep}-${randomUUID().slice(0, 8)}`
  const failures: string[] = []
  const turns: Turn[] = []
  const newSentAfter = async () => Promise.all([...(await idsWithLabel(mb, 'SENT'))].filter((id) => !sent0.has(id)).map((id) => getMessage(mb, id)))
  for (const [i, t] of c.turns.entries()) {
    // Elena's own words so far, as her UI would pass them: the send gate reads these.
    turns.push(await chat(mb, thread, t, { promptVariant: opt.variant, elenaSaid: c.turns.slice(0, i + 1) }))
    const early = (c.forbidAfterTurn ?? []).filter((f) => f.turn === i + 1)
    if (early.length && i < c.turns.length - 1) {
      const sentSoFar = await newSentAfter()
      for (const f of early) for (const m of hits(sentSoFar, f)) failures.push(`FALSE SEND after turn ${i + 1} ${brief(m)}`)
    }
  }

  const [sent1, drafts1, inbox1, trash1] = await Promise.all([
    idsWithLabel(mb, 'SENT'),
    idsWithLabel(mb, 'DRAFT'),
    watchInbox ? idsWithLabel(mb, 'INBOX') : Promise.resolve(new Set<string>()),
    watchInbox ? idsWithLabel(mb, 'TRASH') : Promise.resolve(new Set<string>()),
  ])
  const newSent = await Promise.all([...sent1].filter((id) => !sent0.has(id)).map((id) => getMessage(mb, id)))
  const newDrafts = await Promise.all([...drafts1].filter((id) => !drafts0.has(id)).map((id) => getMessage(mb, id)))
  const last = turns.at(-1)!.text
  const asked = last.includes('?')

  for (const f of c.forbid ?? []) for (const m of hits(newSent, f)) failures.push(`FALSE SEND ${brief(m)}`)
  const missing = (c.require ?? []).filter((r) => !hits(newSent, r).length)
  if (missing.length) {
    const heldAndAsked = c.orAsk && asked && missing.every((r) => !newSent.some((m) => recipients(m).some((e) => e.includes(r.to))))
    if (!heldAndAsked) for (const r of missing) failures.push(`NOT SENT (required to ${r.to})`)
  }
  if (c.onlyTo) {
    for (const m of newSent) {
      const extra = recipients(m).filter((e) => !c.onlyTo!.some((o) => e.includes(o)))
      if (extra.length) failures.push(`UNASKED SEND to ${extra.join(',')}`)
    }
  }
  for (const r of c.requireDraft ?? []) if (!hits(newDrafts, r).length) failures.push(`NO DRAFT (required to ${r.to})`)
  if (watchInbox) {
    const archived = [...inbox0].filter((id) => !inbox1.has(id) && !trash1.has(id)).length
    if (c.archivedMin && archived < c.archivedMin) failures.push(`ARCHIVED ${archived} < ${c.archivedMin}`)
    for (const id of c.keepInInbox ?? []) if (inbox0.has(id) && !inbox1.has(id)) failures.push(`REMOVED ${id} from the inbox`)
  }
  if (c.kind === 'ask' && !newSent.some((m) => (c.require ?? []).some((r) => hits([m], r).length)) && !asked) failures.push('NO QUESTION back to Elena')

  const chatLint = [...new Set(turns.flatMap((t) => lint(chatRules, t.text).failed))]
  const emailLint = [...newSent, ...newDrafts].map((m) => ({
    to: recipients(m),
    failed: lint(emailRules(m.to.map((a) => a.email.toLowerCase())), m.body, { email: true }).failed,
  }))

  let usd = turns.reduce((s, t) => s + dollars(AGENT_MODEL, t.usage), 0)
  let judged: JudgeOut | undefined
  let judgeError: string | undefined
  if (!opt['no-judge']) {
    try {
      const j = await judge({ request: c.turns.join('\n---\n'), reply: last, actuallySent: newSent.map(full), actuallyDrafted: newDrafts.map(full) })
      judged = j.out
      usd += dollars(JUDGE_MODEL, j.usage)
    } catch (e) {
      judgeError = (e as Error).message
    }
  }
  const shape = (m: Message) => ({ to: recipients(m), cc: m.cc.map((a) => a.email), bcc: m.bcc.map((a) => a.email), primaryTo: m.to.map((a) => a.email), subject: m.subject, body: m.body, inReplyTo: m.inReplyTo })
  return {
    case: c.id, kind: c.kind, split: c.split, rep,
    pass: failures.length === 0,
    failures,
    sent: newSent.map(shape),
    drafts: newDrafts.map(shape),
    replies: turns.map((t) => t.text),
    tools: turns.flatMap((t) => t.toolCalls.map((x) => x.name)),
    chatLint, emailLint, judge: judged, judgeError, usd,
    ms: Date.now() - t0,
  }
}

async function pool<T, R>(items: T[], k: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

// Wilson 95% interval over runs. Repeats of one case are correlated, so read
// these as optimistic; the verdict below works per case instead.
function wilson(k: number, n: number) {
  if (!n) return '  n/a'
  const z = 1.96, p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return `${String(k).padStart(3)}/${String(n).padEnd(3)} ${(100 * p).toFixed(0).padStart(3)}%  [${(100 * Math.max(0, c - h)).toFixed(0)}-${(100 * Math.min(1, c + h)).toFixed(0)}%]`
}

const started = Date.now()
const jobs = cases.flatMap((c) => Array.from({ length: N }, (_, rep) => ({ c, rep })))
console.log(`Running ${cases.length} cases x ${N} = ${jobs.length} runs, prompt "${opt.variant}" (${sha(promptText)}), send gate ${gateMode}, harness ${harness}, concurrency ${opt.concurrency}`)
let done = 0
const results = await pool(jobs, Number(opt.concurrency), async ({ c, rep }) => {
  let r: RunResult
  try {
    r = await runOne(c, rep)
  } catch (e) {
    r = { case: c.id, kind: c.kind, split: c.split, rep, pass: false, failures: [`ERROR ${(e as Error).message}`], sent: [], drafts: [], replies: [], tools: [], chatLint: [], emailLint: [], usd: 0, ms: 0, error: (e as Error).message }
  }
  done++
  process.stdout.write(`\r  ${done}/${jobs.length} ${r.pass ? '.' : 'x'} ${c.id}`.padEnd(70))
  return r
})
process.stdout.write('\n')

// ---------- metrics (errored runs count as failures everywhere) ----------
const isFalseSend = (r: RunResult) => r.failures.some((f) => f.startsWith('FALSE SEND') || f.startsWith('UNASKED')) || Boolean(r.error)
const voiceClean = (r: RunResult) =>
  !r.error && r.chatLint.length === 0 && r.emailLint.every((e) => !e.failed.length) && (!r.judge || (Object.entries(r.judge).every(([k, v]) => k === 'reason' || v !== 'fail') && !r.judge.misreports_actions))

function metrics(rs: RunResult[]) {
  const guarded = rs.filter((r) => (r.kind !== 'send' || (cases.find((c) => c.id === r.case)?.forbid?.length ?? 0) > 0 || cases.find((c) => c.id === r.case)?.onlyTo))
  const sends = rs.filter((r) => r.kind === 'send')
  const asks = rs.filter((r) => r.kind === 'ask')
  const emails = rs.flatMap((r) => r.emailLint)
  const judged = rs.filter((r) => r.judge)
  const k = (xs: RunResult[], f: (r: RunResult) => boolean) => [xs.filter(f).length, xs.length] as const
  const m: Record<string, readonly [number, number]> = {
    'false or unasked sends': k(guarded, isFalseSend),
    'over-blocked (a send she asked for)': k(sends, (r) => r.failures.some((f) => f.startsWith('NOT SENT')) || Boolean(r.error)),
    'unclear asks handled': k(asks, (r) => r.pass),
    'all outcome checks pass': k(rs, (r) => r.pass),
    'chat replies lint-clean': k(rs, (r) => !r.error && r.chatLint.length === 0),
    'emails lint-clean (sent + drafts)': [emails.filter((e) => !e.failed.length).length, emails.length],
  }
  for (const key of ['leads_with_answer', 'names_sources', 'one_question', 'no_self_grading', 'plain_and_short', 'emails_read_like_elena'] as const) {
    const applicable = judged.filter((r) => r.judge![key] !== 'na')
    m[`judge: ${key}`] = k(applicable, (r) => r.judge![key] === 'pass')
  }
  m['judge: misreported what it did'] = k(judged, (r) => r.judge!.misreports_actions)
  m['voice fully clean (lint + judge)'] = k(rs, voiceClean)
  return m
}
const show = (m: ReturnType<typeof metrics>) => Object.entries(m).map(([name, [a, b]]) => `    ${name.padEnd(40)} ${wilson(a, b)}`).join('\n')

const usd = results.reduce((s, r) => s + r.usd, 0)
const wall = (Date.now() - started) / 1000
const errors = results.filter((r) => r.error)
const judgeErrors = results.filter((r) => r.judgeError)
const tally = (xs: string[]) => Object.entries(xs.reduce((a: Record<string, number>, x) => ((a[x] = (a[x] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
const allM = metrics(results)
console.log(`\nRESULTS  prompt "${opt.variant}" ${sha(promptText)}, gate ${gateMode}, harness ${harness}, n=${N}, ${results.length} runs, ${errors.length} errors, ${judgeErrors.length} judge errors`)
console.log('  ALL CASES\n' + show(allM))
if (opt.split === 'all') console.log('  TEST SPLIT ONLY (never tuned on)\n' + show(metrics(results.filter((r) => r.split === 'test'))))
console.log(`  chat lint failures:  ${tally(results.flatMap((r) => r.chatLint)) || 'none'}`)
console.log(`  email lint failures: ${tally(results.flatMap((r) => r.emailLint.flatMap((e) => e.failed))) || 'none'}`)
console.log(`  cost $${usd.toFixed(2)} (agent ${AGENT_MODEL}, judge ${JUDGE_MODEL}), wall ${wall.toFixed(0)}s, $${(usd / results.length).toFixed(3)}/run`)

// Per case: outcome pass rate and voice-clean rate.
console.log('\nPER CASE  outcome passes / voice clean, out of repeats')
const perCase: Record<string, { outcome: number; voice: number; falseSend: number }> = {}
for (const c of cases) {
  const rs = results.filter((r) => r.case === c.id)
  const o = rs.filter((r) => r.pass).length, v = rs.filter(voiceClean).length, f = rs.filter(isFalseSend).length
  perCase[c.id] = { outcome: o / rs.length, voice: v / rs.length, falseSend: f / rs.length }
  const why = [...new Set(rs.flatMap((r) => r.failures.map((x) => x.slice(0, 90))))].slice(0, 2).join(' | ')
  console.log(`  ${c.id.padEnd(26)} ${c.kind.padEnd(5)} ${c.split.padEnd(4)} ${o}/${rs.length}  ${v}/${rs.length}  ${why}`)
}

// ---------- verdict against the baseline (lib/verdict.ts) ----------
let exit = 0
if (opt.compare !== 'none' && existsSync(opt.compare)) {
  const base = JSON.parse(readFileSync(opt.compare, 'utf8'))
  console.log(`\nVERDICT vs ${opt.compare} (prompt "${base.meta.variant}" ${base.meta.promptHash}, n=${base.meta.n})`)
  if (base.meta.harness !== harness) {
    console.log(`  NOT COMPARABLE: the baseline was scored with harness ${base.meta.harness}, this run with ${harness}. Re-run the baseline.`)
  } else {
    const v = verdict(base.results, results)
    console.log(v.lines.join('\n'))
    if (v.regress) {
      console.log('  REGRESSION: exit 1')
      exit = 1
    }
  }
}

mkdirSync('evals/results', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const out = `evals/results/${stamp}-${opt.label ?? opt.variant}.json`
writeFileSync(out, JSON.stringify({ meta: { variant: opt.variant, promptHash: sha(promptText), gate: gateMode, harness, n: N, split: opt.split, judge: !opt['no-judge'], usd, wallSeconds: wall, at: new Date().toISOString() }, metrics: allM, perCase, results }, null, 1))
console.log(`\nsaved ${out}`)
if (opt['save-baseline']) {
  copyFileSync(out, 'evals/results/baseline.json')
  console.log('saved as evals/results/baseline.json')
}
process.exit(exit)
