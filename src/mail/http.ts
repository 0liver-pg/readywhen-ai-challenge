// Maps the store's failures onto HTTP so every route is just the happy path.
import { z } from 'zod'

import { Invalid, NotFound } from './store'

export function handle<P>(fn: (req: Request, params: P) => Promise<unknown>) {
  return async function (req: Request, ctx: { params: Promise<P> }) {
    try {
      const result = await fn(req, await ctx.params)
      return result === undefined ? new Response(null, { status: 204 }) : Response.json(result)
    } catch (error) {
      if (error instanceof z.ZodError) return Response.json({ error: z.prettifyError(error) }, { status: 400 })
      if (error instanceof SyntaxError) return Response.json({ error: 'body is not valid JSON' }, { status: 400 })
      if (error instanceof Invalid) return Response.json({ error: error.message }, { status: 400 })
      if (error instanceof NotFound) return Response.json({ error: error.message }, { status: 404 })
      throw error
    }
  }
}

export function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams)
}

// Elena's own chat turns, as the caller (her UI, or an eval) passed them. The
// assistant's tools forward this header from the request context; the model
// can't write it. Absent means "she said nothing", so the gate holds.
export function elenaSaidOf(req: Request): string[] {
  const raw = req.headers.get('x-elena-said')
  if (!raw) return []
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
