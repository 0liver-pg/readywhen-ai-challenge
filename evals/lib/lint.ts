// Deterministic voice checks, taken rule by rule from docs/voice.md.
// Each rule returns true when the text PASSES. No model involved, so these
// never drift between runs; `npm run eval:validate` measures them against
// Elena's own sent mail and against seeded faults.

export type Rule = { id: string; why: string; test: (text: string) => boolean }

// Quoted words are hers or someone else's, not the assistant's voice.
const unquote = (t: string) => t.replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g, '""')
const emoji = /\p{Extended_Pictographic}/u

const shared: Rule[] = [
  { id: 'no_em_dash', why: 'Never: em dashes', test: (t) => !/—/.test(unquote(t)) },
  { id: 'no_exclamation', why: 'Never: exclamation marks', test: (t) => !/!/.test(unquote(t)) },
  { id: 'no_emoji', why: 'Never: emoji', test: (t) => !emoji.test(t) },
  {
    id: 'no_hype',
    why: 'Never: hype words',
    test: (t) => !/\b(supercharge\w*|seamless(ly)?|leverag\w*|empower\w*|unlock\w*|game-changing|revolutionary)\b/i.test(unquote(t)),
  },
]

export const chatRules: Rule[] = [
  ...shared,
  {
    id: 'no_filler',
    why: 'Never: filler openers',
    test: (t) => !/\b(great question|absolutely|happy to help|i hope this helps)\b/i.test(unquote(t)),
  },
  {
    id: 'no_self_reference',
    why: 'Never: calling itself an AI, a model, a bot or a tool',
    test: (t) => !/\b(as an ai|language model|i(?:'m| am) (?:an? )?(?:ai|bot|assistant|model|tool)\b)/i.test(unquote(t)),
  },
  { id: 'no_headings', why: 'Short and plain: no headings', test: (t) => !/^\s{0,3}#{1,6}\s/m.test(t) },
  {
    id: 'no_reflex_offer',
    why: "Act, then report: don't end on a reflex offer",
    test: (t) => !/(let me know if (?:you|there|anything)|anything else|would you like me to|want me to do anything|happy to (?:help|do))[^]*$/i.test(t.slice(-220)),
  },
  {
    id: 'no_lists_when_short',
    why: 'No bullet lists for an answer that fits in three sentences',
    test: (t) => !(hasList(t) && sentences(t.replace(/^\s*([-*•]|\d+[.)])\s+/gm, '')) <= 3),
  },
]

export const italianDomains = (email: string) =>
  !/(nordlicht-kosmetik|harlowpine|maison-delcourt|vandermeer-outdoor)\./.test(email)
const team = (email: string) => email.endsWith('@lumelocations.it')

export function emailRules(to: string[]): Rule[] {
  const allTeam = to.length > 0 && to.every(team)
  const allItalian = to.every(italianDomains)
  const greeting = allItalian ? 'Ciao' : 'Hi'
  const sign = allTeam ? 'E.' : 'Elena'
  return [
    ...shared,
    {
      id: 'greeting',
      why: `Opens with "${greeting}" (Ciao for Italians, Hi for everyone else)`,
      test: (t) => new RegExp(`^\\s*${greeting}\\b`).test(t),
    },
    {
      id: 'sign_off',
      why: `Signs "${sign}" (E. to her team, Elena to everyone else)`,
      test: (t) => new RegExp(`(^|[\\s,])${sign.replace('.', '\\.')}\\s*$`).test(t.trim()),
    },
    { id: 'no_lists', why: 'No bullet lists', test: (t) => !hasList(t) },
    {
      id: 'no_corporate',
      why: 'No corporate phrasing',
      test: (t) => !/\b(dear\b|i hope (this|you|your)|i am writing to|please do not hesitate|kind regards|best regards|warm regards|further to)/i.test(t),
    },
    {
      id: 'length_1_to_5',
      // voice.md says "two to five sentences", but its own ✓ example
      // ("Ciao Enrico, we'll be at the studio from 07:00 tomorrow.") has one,
      // so one is allowed.
      why: 'One to five sentences (greeting and sign-off excluded)',
      test: (t) => {
        const n = sentences(stripFrame(t))
        return n >= 1 && n <= 5
      },
    },
  ]
}

function hasList(t: string) {
  return /^\s*([-*•]|\d+[.)])\s+\S/m.test(t)
}

// Sentence count, tolerant of times (07:30), decimals and initials (E.).
export function sentences(t: string) {
  const cleaned = t.replace(/\d[.:,]\d/g, '0').replace(/\b[A-Z]\./g, 'X').trim()
  if (!cleaned) return 0
  return cleaned.split(/[.?!]+(?:\s|$)/).filter((s) => s.trim().length > 2).length
}

// Drop the greeting word/name and the sign-off line so only the body is counted.
function stripFrame(t: string) {
  const lines = t.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1 && /^(E\.|Elena|Grazie,?\s*(E\.|Elena)?|A presto,?\s*\S*)$/.test(lines.at(-1)!)) lines.pop()
  // A short closing line ("Grazie mille,", "A presto,", "Thanks again,").
  if (lines.length > 1 && /^[\p{L}' ]{2,25},?$/u.test(lines.at(-1)!) && lines.at(-1)!.split(' ').length <= 3) lines.pop()
  let body = lines.join(' ')
  body = body.replace(/^(Ciao|Hi)\s+[^,]{1,40},\s*/, '')
  body = body.replace(/\s*(Grazie|Thanks|A presto)?,?\s*(E\.|Elena)\s*$/, '')
  return body
}

// Only Elena's own words count: cut forwarded or quoted mail and the
// signature block ("Elena Conti / Lume Locations, Milan") under the sign-off.
export function ownWords(t: string) {
  const cut = t.search(/^\s*(-{3,}|_{3,}|Forwarded message|Begin forwarded|(From|Da|Sent|Inviato):\s|On .{5,80} wrote:|Il .{5,80} ha scritto:)/im)
  let s = cut >= 0 ? t.slice(0, cut) : t
  const lines = s.trimEnd().split('\n')
  while (lines.length > 1 && /^\s*(Elena Conti|Lume Locations.*|Milan[o]?|elena@lumelocations\.it|\+39[\d ]+|)\s*$/.test(lines.at(-1)!)) lines.pop()
  return lines.join('\n')
}

export function lint(rules: Rule[], raw: string, { email = false } = {}) {
  const text = email ? ownWords(raw) : raw
  const failed = rules.filter((r) => !r.test(text)).map((r) => r.id)
  return { pass: failed.length === 0, failed }
}
