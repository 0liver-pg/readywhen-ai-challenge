// The promise ledger: what Elena, her team and the people she works with said
// they would do, from data/promises.json (built by scripts/promises.ts), sorted
// into what needs her now.
import { readFileSync } from 'node:fs'
import path from 'node:path'

export type Promise_ = {
  who: string
  side: 'elena' | 'team' | 'them'
  toWhom: string
  what: string
  due: string | null
  quote: string
  messageId: string
  status: 'open' | 'done' | 'dropped'
  doneBy: string | null
  shoot: string | null
  threadId: string
  subject: string
  date: string
}

export type Shoot = { date: string; client: string; title: string }

let cache: { promises: Promise_[]; shoots: Shoot[] } | undefined
export function load() {
  if (cache) return cache
  const root = process.cwd()
  const { promises } = JSON.parse(readFileSync(path.join(root, 'data/promises.json'), 'utf8')) as { promises: Promise_[] }
  // "## Coming up" in owner.md: "- 2026-09-19: Corvo Studio floral product shoot at ..."
  const owner = readFileSync(path.join(root, 'data/owner.md'), 'utf8')
  const section = owner.split('## Coming up')[1]?.split('\n## ')[0] ?? ''
  const clients = [...new Set(promises.map((p) => p.shoot).filter(Boolean))] as string[]
  const shoots = section
    .split('\n')
    .map((l) => l.match(/^- (\d{4}-\d{2}-\d{2}): (.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ date: m[1], title: m[2], client: clients.find((c) => m[2].includes(c.split(' ')[0])) ?? '' }))
  cache = { promises, shoots }
  return cache
}

export type Bucket = 'slipping' | 'today' | 'soon' | 'later' | 'undated'
// Relative to the mailbox's "now". Slipping = the date passed in the last two
// weeks and nothing in the mail shows it happened.
export function bucket(p: Promise_, today: string): Bucket | null {
  if (p.status !== 'open') return null
  if (!p.due) return daysBetween(p.date.slice(0, 10), today) <= 10 ? 'undated' : null
  const d = daysBetween(today, p.due)
  if (d < -14) return null
  if (d < 0) return 'slipping'
  if (d === 0) return 'today'
  if (d <= 7) return 'soon'
  return 'later'
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

export function when(due: string | null, today: string) {
  if (!due) return 'no date'
  const d = daysBetween(today, due)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  const day = new Date(due + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return d < 0 ? `${day}, ${-d} days ago` : d <= 7 ? day : day
}
