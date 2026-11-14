# Evals

With the mail API (:3000) and the agent (:4111) running:

```bash
npm run eval                          # live prompt, every case x3, compared with results/baseline.json
npm run eval -- --variant original    # any prompt in evals/prompts/ without touching the live one
npm run eval -- --split test          # only the held-out cases
npm run eval -- --only hold-sanne --n 5
npm run eval:validate                 # is the eval itself right? (lint and seeded checks free; seeded judge checks ~$0.10)
npm run eval -- --save-baseline       # make this run the baseline the next runs are judged against
```

| File | What it is |
|---|---|
| `cases.json` | 33 cases (21 dev, 12 held-out test). Each is what Elena types plus what must be true of her mailbox afterwards, with the inbox evidence that decides it. |
| `run.ts` | Runs every case on a fresh mailbox copy and a fresh memory thread, reads what was actually sent and drafted, scores it, prints a summary and a per-case diff against the baseline, and saves everything to `results/`. |
| `lib/lint.ts` | Deterministic voice rules taken one by one from `docs/voice.md`. |
| `lib/judge.ts` | The only model-graded part: six voice criteria a regex can't judge (including whether emails read like Elena), plus "did the reply misreport what it did". Never decides send / no-send. |
| `validate.ts` | Checks the checks: lint vs Elena's real sent mail, seeded lint faults, judge vs human labels, seeded judge cases. |
| `labels.ts` | Builds `labels/sheet.html`, a click-through sheet for a human to confirm case labels and grade replies. Labels land in `labels/human.json`. |
| `prompts/` | `original.md` (the starter prompt, the control that must fail) and `never-send.md` (the over-cautious control that must over-block). |
