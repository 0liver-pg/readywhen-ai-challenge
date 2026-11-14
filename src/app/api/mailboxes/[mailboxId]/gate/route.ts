import { Compose, MailboxId } from '@/mail/contract'
import { GATE_MODELS } from '@/mail/gate'
import { elenaSaidOf, handle } from '@/mail/http'
import { checkSend } from '@/mail/store'

// Dry run of the send gate: what would it decide for this email? Saves and
// sends nothing. Used by evals/gate.ts (?model= compares gate models); the
// assistant has no tool for it.
export const POST = handle(async (req, p: { mailboxId: string }) => {
  const model = new URL(req.url).searchParams.get('model') ?? undefined
  if (model && !(GATE_MODELS as readonly string[]).includes(model)) throw new Error(`unknown model ${model}`)
  return checkSend(MailboxId.parse(p.mailboxId), Compose.parse(await req.json()), elenaSaidOf(req), model)
})
