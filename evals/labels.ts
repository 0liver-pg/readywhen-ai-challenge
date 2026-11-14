// Builds evals/labels/sheet.html: a one-page labelling sheet for a human.
//   Part A: confirm or flip each case's expected outcome, with the inbox
//           evidence quoted inline (the labels are the ground truth).
//   Part B: grade a sample of real assistant replies, to check the LLM judge
//           against a person (evals/lib/agreement.ts).
// Labels are kept in the page's localStorage; "Export" shows the JSON to save
// as evals/labels/human.json.
// Usage: node evals/labels.ts [--cases-only | results.json ...]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'

type Msg = { id: string; date: string; from: { name: string | null; email: string }; to: { email: string }[]; subject: string; body: string }
const inbox = new Map((JSON.parse(readFileSync('data/inbox.json', 'utf8')).messages as Msg[]).map((m) => [m.id, m]))
const cases = JSON.parse(readFileSync('evals/cases.json', 'utf8')).cases as { id: string; kind: string; split: string; turns: string[]; evidence: string }[]

const args = process.argv.slice(2)
const files = args.includes('--cases-only')
  ? []
  : args.length
  ? args
  : readdirSync('evals/results').filter((f) => f.endsWith('.json') && !f.startsWith('baseline')).map((f) => `evals/results/${f}`)
// Part B sample: one reply per case, alternating between the result files
// given (e.g. the starter prompt and the new one) so the human sees a real mix
// of good and bad replies, capped at 24.
const perFile = files.map((f) => (JSON.parse(readFileSync(f, 'utf8')).results as any[]).filter((r) => !r.error && r.judge))
const sample: any[] = []
cases.forEach((c, i) => {
  for (let k = 0; k < perFile.length; k++) {
    const r = perFile[(i + k) % Math.max(1, perFile.length)]?.find((x) => x.case === c.id)
    if (r) return void sample.push(r)
  }
})
sample.splice(24)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const quote = (ids: string) =>
  (ids.match(/msg_\d{4}/g) ?? [])
    .map((id) => inbox.get(id))
    .filter(Boolean)
    .map((m) => `<div class="ev"><b>${m!.id}</b> ${m!.date.slice(5, 16).replace('T', ' ')} <b>${esc(m!.from.name ?? m!.from.email)}</b> &rarr; ${esc(m!.to.map((t) => t.email.split('@')[0]).join(', '))}<br>${esc(m!.body.replace(/\s+/g, ' ').slice(0, 420))}</div>`)
    .join('')

const partA = cases
  .map(
    (c) => `<section class="card" data-id="A:${c.id}">
  <div class="meta">${c.id} · ${c.split}</div>
  <div class="ask">Elena: ${c.turns.map((t) => `“${esc(t)}”`).join(' <span class="then">then</span> ')}</div>
  <div class="note">${esc(c.evidence)}</div>${quote(c.evidence)}
  <div class="btns">Right outcome:
    ${['send', 'hold', 'ask', 'voice'].map((k) => `<button data-v="${k}" class="${k === c.kind ? 'proposed' : ''}">${k}</button>`).join('')}
  </div></section>`,
  )
  .join('\n')

const questions = JSON.parse(readFileSync('evals/labels/questions.json', 'utf8')) as { id: string; text: string; options: string[] }[]
const partQ = questions
  .map((q) => `<section class="card" data-id="${q.id}"><div class="ask">${esc(q.text)}</div><div class="btns">${q.options.map((o) => `<button data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></section>`)
  .join('\n')

const partB = sample
  .map(
    (r: any, i: number) => `<section class="card" data-id="B:${r.case}:${r.rep}:${i}">
  <div class="meta">${r.case} · reply ${i + 1}/${sample.length}</div>
  <div class="ask">Elena: ${esc(cases.find((c) => c.id === r.case)!.turns.join(' / '))}</div>
  <pre class="reply">${esc(r.replies.at(-1))}</pre>
  ${r.sent.length ? `<div class="note">Actually sent: ${esc(r.sent.map((s: any) => s.to.join(',')).join('; '))}</div>` : '<div class="note">Nothing was sent.</div>'}
  <div class="btns">Would Elena be happy with how this reads (voice.md)? <button data-v="yes">yes</button><button data-v="no">no</button></div>
</section>`,
  )
  .join('\n')

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eval labels</title><style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--line:#e4e2dc;--acc:#2f5d50;--pick:#2f5d50;--prop:#c9a227}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mut:#9a9890;--card:#1f1f1d;--line:#33322f;--acc:#8cc4b0;--pick:#5aa48c;--prop:#c9a227}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:860px;padding:16px}
h1{font-size:20px}h2{margin-top:32px;font-size:17px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}
.meta{color:var(--mut);font-size:12px}.ask{font-weight:600;margin:4px 0}.then{color:var(--mut);font-weight:400}.note{color:var(--mut);font-size:13px;margin:4px 0}
.ev{font-size:13px;border-left:3px solid var(--line);padding:2px 8px;margin:6px 0}.reply{white-space:pre-wrap;font:13px/1.45 ui-monospace,monospace;background:var(--bg);padding:8px;border-radius:6px;max-height:260px;overflow:auto}
button{font:inherit;margin:4px 4px 0 0;padding:4px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.proposed{border-color:var(--prop)}button.on{background:var(--pick);color:#fff;border-color:var(--pick)}
#bar{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);z-index:1}textarea{width:100%;height:120px}
</style></head><body>
<div id="bar"><b>Eval labels</b> · <span id="count"></span> · <button id="exp">Export JSON</button></div>
<h1>Part A: what should happen? (${cases.length} cases)</h1>
<p class="note">The gold border is my proposed label. Click it to confirm, or click another to flip it. <b>send</b>: the email should go. <b>hold</b>: nothing (or nothing like this) should go. <b>ask</b>: hold and ask Elena one question. <b>voice</b>: only the answer's quality matters.</p>
${partA}
<h2>Contested</h2>
${partQ}
${sample.length ? `<h2>Part B: does it sound right? (${sample.length} replies)</h2>` : ''}
${sample.length ? '' : '<!--'}<p class="note">Judge the chat reply only, against docs/voice.md: leads with the answer, short and plain, names who said what, asks at most one thing, no fluff. Gut feel is fine.</p>${sample.length ? '' : '-->'}
${partB}
<textarea id="out" hidden></textarea>
<script>
const KEY='eval-labels-v1';let s={};try{s=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const cards=[...document.querySelectorAll('.card')];
function paint(){cards.forEach(c=>c.querySelectorAll('button').forEach(b=>b.classList.toggle('on',s[c.dataset.id]===b.dataset.v)));document.getElementById('count').textContent=Object.keys(s).length+'/'+cards.length+' labelled'}
cards.forEach(c=>c.querySelectorAll('button').forEach(b=>b.onclick=()=>{s[c.dataset.id]=b.dataset.v;try{localStorage.setItem(KEY,JSON.stringify(s))}catch(e){}paint()}));
document.getElementById('exp').onclick=()=>{const o=document.getElementById('out');o.hidden=false;o.value=JSON.stringify(s,null,1);o.select()};
window.__labels=()=>s;paint();
</script></body></html>`
mkdirSync('evals/labels', { recursive: true })
writeFileSync('evals/labels/sheet.html', html)
writeFileSync('evals/labels/sample.json', JSON.stringify(sample.map((r: any, i: number) => ({ key: `B:${r.case}:${r.rep}:${i}`, case: r.case, judge: r.judge })), null, 1))
console.log(`wrote evals/labels/sheet.html (${cases.length} cases, ${sample.length} replies from ${files.length} result files)`)
