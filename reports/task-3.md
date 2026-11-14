# Task 3: Product

## What I built

One page for Elena's Friday morning: `src/app/page.tsx`, at `http://localhost:3000/?mb=<mailbox>` (default `main`). It is not an inbox. It opens on one sentence ("3 emails waiting for your say. 6 of your promises have slipped."), then:

1. **Held for you.** Emails the assistant tried to send and the Task 2 gate stopped. Each shows who it was for, the reason in one sentence, and her own earlier words: "msg_0321 (Laura Bettini): 'From now on everything goes through me.'" She can read it, send it anyway or discard it. Her button calls the store directly; it is not an API route, so the assistant can't press it.
2. **Promises.** Every commitment in her mail: who said they'd do what, for whom, by when, in their exact words, linked to the message. Split by who owes it (you, your team, others) and by what needs attention: slipping (the date passed and nothing in her mail shows it happened), due today, the next seven days, said this week with no date.
3. **Shoots.** The same promises, one card per upcoming job from her diary.

Every open promise has a one-click **Draft an update** (her own promises), **Draft a chase** (what others owe her) or **Draft a nudge** (her team). The assistant writes it in her voice and saves it, never sends it; it appears under **Drafts for you**, where she can edit and send it or discard it. Where the assistant can't know something, it leaves a gap like `[when]`, and the page won't send until she fills it in. Tried on the slipped gallery promise to Jonas, it drafted: "I'm sorry, the selects gallery did not reach you on Wednesday as I promised. It isn't out yet, and I should have told you sooner. You'll have it by [when]..."

Anything that passes the send gate doesn't leave at once: it waits five minutes under **Sending soon**, with a countdown and an **Undo** that puts it back in Drafts. The gate is the main defence against an email Elena didn't want; this is her last chance when the gate gets it wrong, which on the hard cases it does about one time in eight (Task 2). The window is `UNDO_SECONDS` (default 300; `0` sends at once).

Above them is one line to tell the assistant what to do. It matters more for safety than for chat: the page, not the model, passes her exact words to the send gate, so the gate always judges from what she typed.

The promises come from `scripts/promises.ts`: one Sonnet 5.5 call per conversation (171 conversations with a person in them) lists the promises with exact quotes and drops any that don't point at a real message; a second pass shows the model later mail between the same people anywhere in the mailbox and asks whether each open promise was kept, because promises made in one thread are often kept in another (31 were). Result: 206 promises, 149 still open, saved to `data/promises.json` for $2.86 in total, so the page costs nothing to load and shows everyone the same thing.

## The problem it solves for Elena

The brief's ICP "make promises to clients there, and lose track of them". Elena's mail bears that out. On Friday at 09:00 the page shows, among others:

- To Jonas Keller, 14 Sept: the selects gallery "will be with you on Wednesday by midday". Nothing in her mail since shows it went.
- To Chiara, 16 Sept: "Please wait for my list, I will send it tomorrow." Nothing since.
- To Tommaso, 14 Sept: "I will write to Anna Rizzo today". Nothing to Anna since.

For each of those three I checked the inbox: no later message shows it done. None of them is an unread email. They are her own sentences, sitting in her sent mail. An inbox, or a chat box next to one, will never put them in front of her unless she thinks to ask. A ledger does it every morning.

The Shoots view is the weaker half, and I'd say so. Promises are tagged by client, not by job, so a client with two jobs (Brio, Harlow & Pine) shows the same list twice, and "Generator and night security for the Brenta shoot" shows nothing. The real shoot board (venue, permit, crew, catering, transport and insurance per job, each with its source) is in `reports/next-steps.md`. Even so, it already shows something useful: the Tavola Viva card for Monday lists, one under the other: Giulia will send Domenico a headcount of 21 unless told otherwise; Domenico will keep 18 if he hears nothing by noon; Elena will answer Domenico herself if he writes. Her own note the day before says 42. That three-way conflict is exactly what tripped the assistant and the gate in Task 2, and here a person can see it at a glance.

**Generic versus client-specific.** Every small service business makes promises by email, so the ledger is the general readywhen feature. Only a location agency has shoots, venues and call times; the shoot board is what you'd build for this client. It's the same data and a different cut, about 40 lines. That is the shape I'd want for the next ten clients: one extraction everyone shares, and a thin view per trade (a site board for a builder, a deliverables board for a studio). The views are small enough for a coding agent to draft from a client's own inbox and a one-paragraph brief, with a person checking it, so a client-specific feature costs days, not a project. How I'd build that factory is in `reports/next-steps.md`.

## How sure am I that it's right?

- The three slipping promises above: checked by hand.
- Every promise must quote a real message; any that don't are dropped by code.
- **Precision: not measured.** 15 promises the page shows, spread evenly, are in the labelling sheet (Part C) for a person to mark right, not a promise, already done or wrong details. Until someone does, treat the list as a draft. Reading the slipping list myself, it over-counts: conditional promises ("I will answer him if he writes"), standing holds and promises kept off email (a bank transfer, a phone call) all show as slipped.
- Known weak spot: "done" means "a message shows it". If Elena did it by phone, the page will say it slipped. That's why the wording is "nothing in her mail shows it happened", not "overdue".

The numbers above are for a fresh mailbox at Friday 09:00. Each mailbox's clock runs in real time (that's the mock), so an older one, like `main` after a day, shows more slipping; `POST /api/mailboxes` gives a fresh copy to view with `/?mb=<id>`.

Not built: marking a promise done by hand, editing a held email before sending, and keeping the ledger fresh as new mail arrives (today it's a script run).

## What I'd want to learn from putting it in front of ten owners like her

1. **Does the slipping list match what they'd have dropped?** Show it on a Friday, ask them to mark each item "I'd forgotten", "I knew" or "not a promise". If fewer than a third are "I'd forgotten", the ledger is noise and should rank by consequence, not date.
2. **Do they trust a hold enough to leave sending on?** Count how often they press "Send it anyway", and whether they read the email first. Pressing it without reading means the reasons aren't trusted; never pressing it means the gate may be over-blocking and nobody notices.
3. **Is the morning page where they start, or one more tab?** Watch whether they open it before their inbox on day 5 without a reminder. If not, the same content belongs in the one email they already read every morning.
4. **What do they call a promise?** Owners in trades, studios and agencies will draw the line in different places ("I'll have a look" counts for some). Ten conversations would give me the labelled examples to tune the extractor per trade.
