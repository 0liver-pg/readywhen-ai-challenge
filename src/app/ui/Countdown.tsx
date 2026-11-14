'use client'
// Live countdown to an outbox email leaving. The mailbox has its own clock, so
// we measure its offset from real time once at mount and count against that.
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

function format(ms: number) {
  if (ms <= 0) return 'Sending now'
  const s = Math.ceil(ms / 1000)
  return `Sending in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Countdown({ sendsAt, mailboxNow }: { sendsAt: string; mailboxNow: string }) {
  const router = useRouter()
  // Until mounted we show the same text on server and client.
  const [text, setText] = useState('Sending soon')

  useEffect(() => {
    const offset = Date.parse(mailboxNow) - Date.now()
    const target = Date.parse(sendsAt)
    let refreshed = false
    const tick = () => {
      const left = target - (Date.now() + offset)
      setText(format(left))
      if (left <= 0 && !refreshed) {
        refreshed = true
        router.refresh()
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [sendsAt, mailboxNow, router])

  return <span className="countdown" role="timer">{text}</span>
}
