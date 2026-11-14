import { Compose, MailboxId } from '@/mail/contract'
import { elenaSaidOf, handle } from '@/mail/http'
import { send } from '@/mail/store'

// Answers { status: "sent", ...message } or { status: "held", draftId, reason }.
export const POST = handle(async (req, p: { mailboxId: string }) =>
  send(MailboxId.parse(p.mailboxId), Compose.parse(await req.json()), { elenaSaid: elenaSaidOf(req) }),
)
