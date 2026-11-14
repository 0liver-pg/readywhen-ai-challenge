import { handle } from '@/mail/http'
import { GATE_MODEL } from '@/mail/gate'

// Read-only: is the send gate on, on which model, and can it reach the model?
// (Evals record it, and refuse to run when the gate is on without a key.)
export const GET = handle(async () => ({ mode: process.env.SEND_GATE === 'off' ? 'off' : 'on', model: GATE_MODEL, keyPresent: Boolean(process.env.ANTHROPIC_API_KEY) }))
