// Human labels vs the eval: (A) do the case labels the eval uses match the
// human's, and (B) does the LLM judge agree with the human on voice?
import { readFileSync } from 'node:fs'

const VOICE_KEYS = ['leads_with_answer', 'names_sources', 'one_question', 'no_self_grading', 'plain_and_short'] as const

export function agreement(file: string) {
  const human = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  const cases = JSON.parse(readFileSync('evals/cases.json', 'utf8')).cases as { id: string; kind: string }[]

  const a = cases.filter((c) => human[`A:${c.id}`])
  const flips = a.filter((c) => human[`A:${c.id}`] !== c.kind)
  console.log(`  A. case labels: human agrees with ${a.length - flips.length}/${a.length}`)
  for (const c of flips) console.log(`     FLIPPED ${c.id}: eval says ${c.kind}, human says ${human[`A:${c.id}`]}`)

  const sample = JSON.parse(readFileSync('evals/labels/sample.json', 'utf8')) as { key: string; judge: Record<string, string> }[]
  let tp = 0, tn = 0, fp = 0, fn = 0
  for (const s of sample) {
    const h = human[s.key]
    if (!h) continue
    const judgeOk = VOICE_KEYS.every((k) => s.judge[k] !== 'fail')
    const humanOk = h === 'yes'
    if (judgeOk && humanOk) tp++
    else if (!judgeOk && !humanOk) tn++
    else if (judgeOk && !humanOk) fp++
    else fn++
  }
  const n = tp + tn + fp + fn
  if (!n) return console.log('  B. no reply labels yet')
  const po = (tp + tn) / n
  const pe = ((tp + fp) * (tp + fn) + (tn + fn) * (tn + fp)) / (n * n)
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe)
  console.log(`  B. judge vs human on ${n} replies: agree ${tp + tn}/${n} (${(100 * po).toFixed(0)}%), Cohen's kappa ${kappa.toFixed(2)}`)
  console.log(`     judge passed / human failed: ${fp}   judge failed / human passed: ${fn}`)
}
