import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logClientError } from '@/lib/sentry'

export const dynamic = 'force-dynamic'

// Sink for client-side errors (window.onerror / unhandledrejection, reported by
// instrumentation-client.ts). Writes them into error_events (source='client') so
// the team + assistant can read testers' errors via /admin/errors — the developer
// never reproduces most user-facing bugs. Unauthenticated on purpose (errors also
// happen on public/pre-login pages); we still attach the user id when a session
// exists. Payload sizes are capped; the client caps itself at 5 reports/page.
export async function POST(request: Request) {
  let body: { kind?: unknown; message?: unknown; stack?: unknown; url?: unknown; ua?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ok: false }, { status: 400 }) }

  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) return NextResponse.json({ ok: true }) // nothing worth logging

  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined)

  let userId: string | undefined
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id
  } catch { /* pre-login / no session — fine */ }

  await logClientError({
    message: message.slice(0, 2000),
    stack:   str(body.stack, 6000),
    kind:    str(body.kind, 100),
    url:     str(body.url, 500),
    ua:      str(body.ua, 400),
    userId,
  })
  return NextResponse.json({ ok: true })
}
