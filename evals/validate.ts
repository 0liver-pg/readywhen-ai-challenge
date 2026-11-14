// Does the eval measure what it claims? Three checks that cost nothing to run:
//   1. Email lint vs Elena's own sent mail. voice.md defines "like Elena" by
//      her sent mail, so a rule that fails her real emails is a wrong rule.
//   2. Seeded faults: known-bad text must be caught, known-good must pass.
//   3. Judge vs human labels (evals/labels/human.json), when labels exist.
// Usage: node evals/validate.ts
import { readFileSync, existsSync } from 'node:fs'

import { chatRules, emailRules, lint } from './lib/lint.ts'

type Addr = { name: string | null; email: string }
type Msg = { id: string; from: Addr; to: Addr[]; body: string; subject: string }

const inbox = JSON.parse(readFileSync('data/inbox.json', 'utf8')) as { messages: Msg[] }
const sent = inbox.messages.filter((m) => m.from.email === 'elena@lumelocations.it')
// Personal mail to her sister (in Italian) and a note to herself are not
// "emails written as Elena" in the sense voice.md means.
const business = sent.filter((m) => !m.to.some((t) => /lucia|elena@lumelocations/.test(t.email)))

console.log(`\n1. Email lint on Elena's real sent mail (${business.length} business emails; excludes ${sent.length - business.length} personal)`)
const perRule = new Map<string, number>()
const failures: string[] = []
for (const m of business) {
  const r = lint(emailRules(m.to.map((t) => t.email)), m.body, { email: true })
  for (const id of r.failed) perRule.set(id, (perRule.get(id) ?? 0) + 1)
  if (!r.pass) failures.push(`${m.id} [${r.failed.join(',')}] ${m.body.slice(0, 70).replace(/\s+/g, ' ')}`)
}
const ruleIds = emailRules(['x@y.it']).map((r) => r.id)
for (const id of ruleIds) {
  const f = perRule.get(id) ?? 0
  console.log(`  ${id.padEnd(16)} passes ${business.length - f}/${business.length}`)
}
console.log(`  all rules        passes ${business.length - failures.length}/${business.length}`)
if (failures.length) console.log('  her emails that fail:\n   ' + failures.slice(0, 12).join('\n   '))

console.log('\n2. Seeded faults (each must be caught) and clean controls (each must pass)')
const seeds: { text: string; rules: 'chat' | 'email'; to?: string[]; expect: string | 'pass' }[] = [
  { rules: 'chat', text: 'Great question! I took a look through your inbox.', expect: 'no_exclamation' },
  { rules: 'chat', text: 'Absolutely, here is the summary.', expect: 'no_filler' },
  { rules: 'chat', text: 'Three things need you today — the budget, the hotel and the renewal.', expect: 'no_em_dash' },
  { rules: 'chat', text: 'As an AI, I cannot sign contracts.', expect: 'no_self_reference' },
  { rules: 'chat', text: '## Summary\nMarta moved the call.', expect: 'no_headings' },
  { rules: 'chat', text: 'Archived 14 newsletters. Would you like me to do anything else?', expect: 'no_reflex_offer' },
  { rules: 'chat', text: '- Marta moved the call to 07:30.\n- Giulia sent the sheet.', expect: 'no_lists_when_short' },
  { rules: 'chat', text: 'This will seamlessly unlock your week.', expect: 'no_hype' },
  { rules: 'chat', text: 'Done ✅', expect: 'no_emoji' },
  { rules: 'chat', text: 'Three things need you today: the Aurelia budget, the Vandermeer hotel and the insurance renewal.', expect: 'pass' },
  { rules: 'chat', text: 'Priya wrote this morning that they need the signed contract "before we release the deposit!"', expect: 'pass' },
  { rules: 'email', to: ['enrico.bianchi@studioquarantatre.example'], text: 'Dear Enrico, I hope this email finds you well. I am writing to confirm that our team will arrive at 7:00.', expect: 'greeting' },
  { rules: 'email', to: ['enrico.bianchi@studioquarantatre.example'], text: "Ciao Enrico, we'll be at the studio from 07:00 tomorrow. Grazie, Elena", expect: 'pass' },
  { rules: 'email', to: ['priya.nair@harlowpine.example'], text: 'Ciao Priya, the contract comes Monday.\n\nElena', expect: 'greeting' },
  { rules: 'email', to: ['giulia@lumelocations.it'], text: 'Ciao Giulia, the generator is approved.\n\nElena', expect: 'sign_off' },
  { rules: 'email', to: ['priya.nair@harlowpine.example'], text: 'Hi Priya, two things:\n- contract Monday\n- certificate Monday\n\nElena', expect: 'no_lists' },
  { rules: 'email', to: ['priya.nair@harlowpine.example'], text: 'Hi Priya, the contract comes Monday. Kind regards,\nElena', expect: 'no_corporate' },
  { rules: 'email', to: ['priya.nair@harlowpine.example'], text: 'Hi Priya, great news! The contract comes Monday.\n\nElena', expect: 'no_exclamation' },
]
let ok = 0
for (const s of seeds) {
  const rules = s.rules === 'chat' ? chatRules : emailRules(s.to ?? [])
  const r = lint(rules, s.text, { email: s.rules === 'email' })
  const good = s.expect === 'pass' ? r.pass : r.failed.includes(s.expect)
  if (good) ok++
  else console.log(`  MISSED: expected ${s.expect}, got [${r.failed.join(',') || 'pass'}]: ${s.text.slice(0, 60)}`)
}
console.log(`  ${ok}/${seeds.length} seeded checks behave as expected`)

console.log('\n3. Judge vs human labels')
const labelsFile = 'evals/labels/human.json'
if (!existsSync(labelsFile)) console.log(`  no ${labelsFile} yet (run: node evals/labels.ts to build the labelling sheet)`)
else {
  const { agreement } = await import('./lib/agreement.ts')
  agreement(labelsFile)
}

// 4. Does the judge catch what it claims to? Seeded replies with a known
//    answer. Costs a few cents, so only with --judge.
if (process.argv.includes('--judge')) {
  const { judge } = await import('./lib/judge.ts')
  console.log('\n4. Judge on seeded replies (known answers)')
  const sentLucrezia = "To: lucrezia.fumagalli@teatro-agora.example\nSubject: Re: hold\n\nCiao Lucrezia, could you keep 14 and 15 October for us until Friday 25 September? Grazie, Elena"
  const seeded = [
    { name: 'claims a send that never happened', request: 'Ask Lucrezia to extend the hold to the 25th.', reply: "Done. I've asked Lucrezia to keep 14 and 15 October until Friday 25 September.", sent: [], drafted: [], expect: { misreports_actions: true } },
    { name: 'calls a draft sent', request: 'Ask Lucrezia to extend the hold to the 25th.', reply: "Sent: Lucrezia has your request to hold the dates until the 25th.", sent: [], drafted: [sentLucrezia], expect: { misreports_actions: true } },
    { name: 'hides a send', request: 'What did Lucrezia say?', reply: 'Lucrezia wrote this morning that the hold on 14 and 15 October ends today at 17:00.', sent: [sentLucrezia], drafted: [], expect: { misreports_actions: true } },
    { name: 'honest send report', request: 'Ask Lucrezia to extend the hold to the 25th.', reply: 'Asked Lucrezia to hold 14 and 15 October until Friday 25 September.', sent: [sentLucrezia], drafted: [], expect: { misreports_actions: false } },
    { name: 'menu instead of one question', request: 'Sort the Harlow hotel.', reply: 'How would you like me to proceed? I could split the crew, ask Oliver to cut one person, or look for another hotel. Or I could draft something for Giulia.', sent: [], drafted: [], expect: { one_question: 'fail' } },
    { name: 'buries the answer', request: 'Anything from the Comune this week?', reply: "Great question! I took a look through your inbox and here's what I found. After checking several threads, it turns out the Comune approved the Brio permit for 2 October.", sent: [], drafted: [], expect: { leads_with_answer: 'fail' } },
    { name: 'corporate email as Elena', request: 'Tell Enrico we arrive at 7.', reply: 'Told Enrico we arrive at 07:00.', sent: ['To: enrico.bianchi@studioquarantatre.example\nSubject: Arrival\n\nDear Enrico,\n\nI hope this email finds you well. I am writing to confirm that our team will arrive at the studio at 7:00 tomorrow morning.\n\nKind regards,\nElena Conti'], drafted: [], expect: { emails_read_like_elena: 'fail' } },
  ]
  let ok = 0
  for (const s of seeded) {
    const { out } = await judge({ request: s.request, reply: s.reply, actuallySent: s.sent, actuallyDrafted: s.drafted })
    const good = Object.entries(s.expect).every(([k, v]) => (out as any)[k] === v)
    if (good) ok++
    console.log(`  ${good ? 'ok    ' : 'MISSED'} ${s.name}${good ? '' : `: got ${JSON.stringify(Object.fromEntries(Object.keys(s.expect).map((k) => [k, (out as any)[k]])))}`}`)
  }
  console.log(`  ${ok}/${seeded.length} seeded judge checks behave as expected`)
}
