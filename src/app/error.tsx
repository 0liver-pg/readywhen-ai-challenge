'use client'
// Shown when one of Elena's buttons fails, e.g. the email changed since the
// page was loaded, instead of a bare error screen.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>That didn’t go through.</h1>
      <p className="hint">{error.message || 'Something changed since the page loaded.'}</p>
      <button onClick={() => (reset(), location.reload())}>Reload the page</button>
    </main>
  )
}
