// The assistant's replies, formatted: paragraphs, "- " bullet lists and
// **bold**. Built as React elements (no HTML injection from model output).
import { Fragment, type ReactNode } from 'react'

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

export function Text({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/)
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').map((l) => l.replace(/^#{1,6}\s+/, ''))
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l)))
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>
        const head = lines.filter((l) => !/^\s*[-*•]\s+/.test(l))
        const items = lines.filter((l) => /^\s*[-*•]\s+/.test(l))
        return (
          <Fragment key={i}>
            {head.length > 0 && <p>{head.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>}
            {items.length > 0 && <ul>{items.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>}
          </Fragment>
        )
      })}
    </>
  )
}
