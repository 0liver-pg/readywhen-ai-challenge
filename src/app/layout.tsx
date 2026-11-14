import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = { title: 'Lume · Today', description: "Elena's promises, holds and shoots" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  )
}
