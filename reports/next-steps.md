# Next steps

What I'd build next, in order. None of it is in the repo yet.

## 1. Close the loop on each promise

Today a slipped or slipping promise stays in the list after Elena drafts or sends a follow-up for it, so the list doesn't shrink as she works through it. Each promise row gets a status with checkboxes:

- [ ] **Drafted**: ticked automatically when a follow-up draft for this promise exists (the "Draft an update / chase / nudge" button records which promise it was for).
- [ ] **Sent**: ticked automatically when that follow-up leaves (after the undo window), with a link to the sent email.
- [ ] **Done**: ticked by Elena, for promises kept off email (a call, a bank transfer) or no longer needed.

Ticked rows move out of "Slipping" into a short "Handled today" list, so the headline count ("6 of your promises have slipped") counts only what still needs her. The links need one small table (promise id, draft id, status, who ticked it, when), and they feed the precision check: a "Done" ticked by Elena on something the ledger called open is a labelled miss for the extractor.

## 2. A real shoot board for Lume

Today's Shoots tab groups promises by client, so it can't tell two jobs for the same client apart. The board Elena needs has one card per job, with what a shoot depends on:

| Field | Filled from | Shown as |
|---|---|---|
| Venue | the job's threads and attachments | confirmed / pencilled / nothing in mail |
| Permit (Comune) | permit notices, Giulia's threads | approved, with date / pending / not needed |
| Crew and freelancers | confirmations to Luca and Giulia | who is booked, who hasn't confirmed |
| Catering, transport, generator | supplier threads | headcount and time agreed, and any conflict |
| Insurance | broker threads, client requests | certificate sent / asked for / nothing in mail |
| Blockers | open promises tagged to this job, and held emails | who is waiting on whom |

It needs one change to the extraction: tag each promise and fact with a job, not a client, by giving the model the job list from `data/owner.md`. Every field quotes its source message, and a missing fact says "nothing in her mail", never a guess. To check it: a person marks 20 fields right or wrong across five jobs before it ships.

## 3. A factory for client-tailored views

Every owner in readywhen's ICP makes promises by email, so the promise ledger and the held queue are the product. What changes per business is the view on top: a shoot board for a location agency, a site board for a builder, a deliverables board for a design studio. Built by hand, each is a small project; built by a factory, each is days.

**Input:** a new client's mailbox (a few weeks) and a one-paragraph brief from the owner ("I run a kitchen-fitting firm; every job has a survey, an order, a fitting date and a sign-off").

**Pipeline**, each step a Claude agent with a narrow job and a check that isn't an LLM's opinion:

1. **Schema.** Read the brief and a sample of threads, and propose the "job" record for this trade (fields, statuses, what counts as done). A person approves it in ten minutes. This is the only required human step, and the one that encodes taste.
2. **Extractor.** Generate the extraction prompt for that schema from a shared template (the ledger's two passes: extract with exact quotes, then check later mail for completion). Code rejects any fact that doesn't quote a real message.
3. **Eval set, before the view.** Sample 30 facts across jobs and have the owner or a readywhen person mark them right or wrong in a click-through sheet (the one in `evals/labels/` is the pattern). The extractor ships only above a precision bar, say 90%, and the number goes in the client's file.
4. **View.** Generate the page from a component kit (card, field, source quote, held email), not from scratch, so every client page has the same affordances: source links, "nothing in mail", the held queue. The coding agent writes only the layout and the field mapping, and a typecheck plus a screenshot review gate it.
5. **Guardrails reused, not rebuilt.** The send gate, the voice rules for the owner's own sent mail (calibrated the way `evals/validate.ts` checks the lint against Elena's real emails), and the eval harness come with every client.

**What makes it a factory rather than ten bespoke builds:** steps 2, 4 and 5 are templates; only step 1 (the schema) and step 3 (the labels) need a person, and both are short. The eval in step 3 is what lets readywhen ship a generated view to a real owner without reading every line.

**What I'd measure:** time from a new client's mailbox to a live view, extractor precision per client, and whether owners open the view on day 5 without a reminder.

## 4. Hardening the send gate for production

- Store Elena's chat turns server-side and pass only a conversation id to the mail API, or sign them, so no caller can forge "Elena said".
- Put her approve button behind her session, with the content check it already has.
- Add prompt-injection cases to `evals/gate.ts` (an email that addresses the gate, a forged "Elena approved this" quote, instructions inside an attachment).
- Add 15 or so harder hold cases (sweeps, forwards, confidential threads), so a safety change can reach significance; today only 5 cases fail at baseline.
- When the assistant holds something back itself, have it save the draft with a one-line warning, so every "not sent" email shows its reason on her page the way gate holds do (assistant drafts already appear under "Drafts for you", without a reason).
