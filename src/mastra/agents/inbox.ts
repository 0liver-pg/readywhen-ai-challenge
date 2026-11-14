// Elena's inbox assistant: one agent, one prompt, the mail tools.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'

import type { Mailbox } from '../../mail/contract'
import { mailApi, mailTools } from '../tools/mail'

const CACHE = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

export const inbox = new Agent({
  id: 'inbox',
  name: 'Inbox assistant',
  description: "Elena Conti's email assistant",
  model: 'anthropic/claude-sonnet-5-5',
  // Read on every request, so a prompt edit applies to the next message without a restart.
  // Prompt caching: the tools and this prompt are the same all day, so they end
  // in a cache breakpoint; the clock lives in a second system block after it,
  // because a minute ticking over would otherwise invalidate the whole prefix.
  instructions: async ({ requestContext }) => {
    const mailbox = (await mailApi({ requestContext }, '')) as Mailbox
    const at = (o: Intl.DateTimeFormatOptions) => new Date(mailbox.now).toLocaleString('en-GB', { timeZone: mailbox.timeZone, ...o })
    const prompt = readFileSync(promptFile(requestContext?.get('promptVariant')), 'utf8')
      .replaceAll('{{ownerName}}', mailbox.owner.name ?? mailbox.owner.email)
      .replaceAll('{{ownerEmail}}', mailbox.owner.email)
      .replaceAll('{{today}}', `${at({ dateStyle: 'full' })} (${mailbox.timeZone})`)
    return [
      { role: 'system', content: prompt, providerOptions: CACHE },
      { role: 'system', content: `The time now is ${at({ timeStyle: 'short' })}.` },
    ]
  },
  tools: mailTools,
  // maxSteps: a sweep of the inbox reads many threads; Mastra's default of 5
  // stops it halfway. providerOptions: Anthropic's automatic caching puts a
  // second breakpoint at the end of each request, so every step re-reads the
  // previous step's conversation from cache instead of paying for it again.
  defaultOptions: { maxSteps: 25, providerOptions: CACHE },
  memory: new Memory({ options: { lastMessages: 40 } }),
})

// Evals can run a named variant from evals/prompts/ (e.g. the original prompt
// or a "never send" control) without touching the live prompt.
function promptFile(variant: unknown): string {
  if (typeof variant !== 'string' || variant === '' || variant === 'live') return promptPath()
  if (!/^[a-z0-9-]+$/.test(variant)) throw new Error(`bad promptVariant ${variant}`)
  return promptPath(process.cwd(), `evals/prompts/${variant}.md`)
}

// `mastra dev` runs from inside its build folder and `mastra build` output runs
// from the repo root, so look upwards for the source file.
function promptPath(dir = process.cwd(), rel = 'src/mastra/agents/inbox.md'): string {
  const candidate = path.join(dir, rel)
  if (existsSync(candidate)) return candidate
  if (path.dirname(dir) === dir) throw new Error(`${rel} not found above the working directory`)
  return promptPath(path.dirname(dir), rel)
}
