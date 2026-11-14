import { MailboxId, MessageId } from '@/mail/contract'
import { elenaSaidOf, handle } from '@/mail/http'
import { sendDraft } from '@/mail/store'

// Answers { status: "sent", ...message } or { status: "held", draftId, reason }.
export const POST = handle((req, p: { mailboxId: string; draftId: string }) =>
  sendDraft(MailboxId.parse(p.mailboxId), MessageId.parse(p.draftId), { elenaSaid: elenaSaidOf(req) }),
)
