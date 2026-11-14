// Creates the mail tables and the default mailbox "main" on first boot.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { boot, releaseDue } = await import('./mail/store')
  await boot()
  const g = globalThis as typeof globalThis & { releaseTimer?: boolean }
  if (!g.releaseTimer) {
    g.releaseTimer = true
    setInterval(() => releaseDue().catch(() => {}), 5000)
  }
}
