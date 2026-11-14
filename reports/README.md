# Reports

- [Task 1: Evals](task-1.md): what is measured, how I know it measures that, and what a run costs.
- [Task 2: Voice and the send gate](task-2.md): what failed, what changed, the numbers after each change, and what still fails.
- [Task 3: Product](task-3.md): Elena's Friday page, the problem it solves, and what I'd learn from ten owners.
- [Next steps](next-steps.md): closing the loop on each promise (drafted / sent / done), the real shoot board, a factory for client-tailored views, and production hardening.

## Running it

Node 22.18 or later (the evals run `.ts` files directly). With the mail API and the agent running (see the main README):

- `npm run eval`: the full eval against the saved baseline, about $13 to $14 and 5 minutes. `npm run eval -- --split dev --n 1 --no-judge` is about $2.
- `node evals/compare.ts evals/results/baseline.json evals/results/<run>.json`: re-judge any saved run, free.
- `npm run eval:validate`: check the checks, about $0.10.
- `http://localhost:3000/?mb=<mailbox>`: Elena's page. `POST /api/mailboxes` gives a fresh mailbox at Friday 09:00.
- `SEND_GATE=off npm run dev:web`: the mail API without the send gate (only for the ablation).

## How this was made

I used Claude Code throughout, as the brief invites. My own time, about one hour, went on deciding what to measure and what to build, choosing between options, the judgement calls on contested labels, and reviewing the results. Claude Code wrote the code, ran the evals and drafted these reports. Independent reviewer agents, which had not seen the work being built, checked the result before submission, and their findings are fixed or listed under "what still fails". No person with full context has labelled the eval cases yet; that is the first gap I'd close.
