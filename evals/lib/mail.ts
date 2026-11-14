// Thin HTTP client for the mail API and the agent, as an outside caller sees them.
export const MAIL = process.env.MAIL_API_URL ?? 'http://localhost:3000'
export const AGENT = process.env.AGENT_URL ?? 'http://localhost:4111'

type Addr = { name: string | null; email: string }
export type Message = {
  id: string
  threadId: string
  from: Addr
  to: Addr[]
  cc: Addr[]
  bcc: Addr[]
  subject: string
  body: string
  labels: string[]
  inReplyTo: string | null
}

async function http(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}
const post = (url: string, body: unknown) =>
  http(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export async function newMailbox(): Promise<string> {
  return (await post(`${MAIL}/api/mailboxes`, {})).id
}

export async function idsWithLabel(mailbox: string, label: string): Promise<Set<string>> {
  const ids = new Set<string>()
  let page: string | null = null
  do {
    const q = new URLSearchParams({ label, limit: '100', ...(page ? { pageToken: page } : {}) })
    const r = await http(`${MAIL}/api/mailboxes/${mailbox}/messages?${q}`)
    for (const m of r.messages) ids.add(m.id)
    page = r.nextPageToken
  } while (page)
  return ids
}

export const getMessage = (mailbox: string, id: string): Promise<Message> => http(`${MAIL}/api/mailboxes/${mailbox}/messages/${id}`)

export type ToolCall = { name: string; args: unknown; result: unknown }
export type Turn = {
  text: string
  toolCalls: ToolCall[]
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  ms: number
}

// One user turn. Memory carries earlier turns of the same `thread`.
export async function chat(mailbox: string, thread: string, content: string, context: Record<string, unknown> = {}): Promise<Turn> {
  const t0 = Date.now()
  const r = await post(`${AGENT}/api/agents/inbox/generate`, {
    messages: [{ role: 'user', content }],
    requestContext: { mailboxId: mailbox, ...context },
    memory: { thread, resource: 'eval' },
  })
  const toolCalls: ToolCall[] = []
  for (const step of r.steps ?? []) {
    const results = new Map<string, unknown>((step.toolResults ?? []).map((x: any) => [x.payload?.toolCallId, x.payload?.result]))
    for (const c of step.toolCalls ?? []) toolCalls.push({ name: c.payload?.toolName, args: c.payload?.args, result: results.get(c.payload?.toolCallId) })
  }
  const u = r.totalUsage ?? r.usage ?? {}
  return {
    text: r.text ?? '',
    toolCalls,
    usage: { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cacheRead: u.cachedInputTokens ?? 0, cacheWrite: u.cacheCreationInputTokens ?? 0 },
    ms: Date.now() - t0,
  }
}

// $ per million tokens (Claude API list prices, checked 2026-11).
export const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}
export function dollars(model: string, u: Turn['usage']) {
  const p = PRICES[model]
  const fresh = Math.max(0, u.input - u.cacheRead - u.cacheWrite)
  return (fresh * p.in + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite + u.output * p.out) / 1e6
}
