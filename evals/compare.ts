// Re-judge two saved runs without spending anything:
//   node evals/compare.ts evals/results/baseline.json evals/results/<run>.json
import { readFileSync } from 'node:fs'

import { verdict } from './lib/verdict.ts'

const [a, b] = process.argv.slice(2)
if (!a || !b) throw new Error('usage: node evals/compare.ts <baseline.json> <run.json>')
const base = JSON.parse(readFileSync(a, 'utf8'))
const now = JSON.parse(readFileSync(b, 'utf8'))
console.log(`${b} ("${now.meta.variant}" ${now.meta.promptHash}) vs ${a} ("${base.meta.variant}" ${base.meta.promptHash})`)
if (base.meta.harness !== now.meta.harness) console.log(`  WARNING: scored with different harnesses (${base.meta.harness} vs ${now.meta.harness}); not comparable`)
const v = verdict(base.results, now.results)
console.log(v.lines.join('\n'))
for (const id of Object.keys(v.now)) {
  const x = v.base[id], y = v.now[id]
  if (x && Math.abs(x.outcome - y.outcome) > 1e-9) console.log(`    ${id.padEnd(26)} outcome ${(x.outcome * x.n).toFixed(0)}/${x.n} -> ${(y.outcome * y.n).toFixed(0)}/${y.n}`)
}
process.exit(v.regress ? 1 : 0)
