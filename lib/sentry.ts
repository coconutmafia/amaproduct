// Minimal Sentry reporter over the envelope HTTP API — no SDK.
//
// Deliberate choice: the project runs a customized Next.js fork, and
// @sentry/nextjs wants to wrap next.config (webpack/source-map hooks) — a real
// build-breakage risk for zero must-have gain. Server errors reach Sentry just
// fine through instrumentation.ts → captureException below. The DSN is public
// by design (browser SDKs embed it), so a committed fallback is fine; override
// with SENTRY_DSN env if it's ever rotated.
const FALLBACK_DSN = 'https://d02780e0380bb068f31e9654616748ba@o4511687858847744.ingest.de.sentry.io/4511687873658960'

function parseDsn(): { endpoint: string; key: string } | null {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || FALLBACK_DSN
  const m = dsn.match(/^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/)
  if (!m) return null
  return { endpoint: `https://${m[2]}/api/${m[3]}/envelope/`, key: m[1] }
}

async function sendEvent(event: Record<string, unknown>): Promise<void> {
  const cfg = parseDsn()
  if (!cfg) return
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const sentAt = new Date().toISOString()
  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn: undefined }) + '\n' +
    JSON.stringify({ type: 'event' }) + '\n' +
    JSON.stringify({ event_id: eventId, timestamp: sentAt, platform: 'node', environment: process.env.VERCEL_ENV || 'development', ...event })
  try {
    await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${cfg.key}, sentry_client=ama-lite/1.0`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* observability must never break the app */ }
}

// Also persist the event to our own error_events table (migration 028) so the
// team + the assistant can read recent failures directly via /api/admin/errors,
// without the Sentry dashboard. Best-effort: server-only (dynamic import keeps
// the admin client out of any edge bundle), and it can NEVER throw or it would
// break the very error path it's logging. Does not call captureException, so no
// loop. If the table doesn't exist yet (migration unapplied) the insert just
// fails silently and Sentry still gets the event.
async function logToDb(row: { level: string; message: string; stack?: string; context?: Record<string, unknown> }): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const ctx = row.context ?? {}
    const route = (ctx.route ?? ctx.path ?? ctx.where) as unknown
    const routeStr = typeof route === 'string' ? route : undefined
    const source = ctx.jobId ? 'job' : (routeStr && /cron/.test(routeStr)) ? 'cron' : 'server'
    const userId = (ctx.userId ?? ctx.user_id) as unknown
    await admin.from('error_events').insert({
      level: row.level,
      source,
      route: routeStr ? routeStr.slice(0, 300) : null,
      message: (row.message || 'Unknown error').slice(0, 2000),
      stack: row.stack ? row.stack.slice(0, 6000) : null,
      context: ctx,
      user_id: typeof userId === 'string' ? userId : null,
    })
  } catch { /* logging must never break the app */ }
}

export async function captureException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err))
  const stack = (e.stack || '').slice(0, 4000)
  await Promise.allSettled([
    sendEvent({
      level: 'error',
      exception: { values: [{ type: e.name || 'Error', value: e.message }] },
      extra: { stack, ...context },
    }),
    logToDb({ level: 'error', message: e.message || String(err), stack, context }),
  ])
}

export async function captureMessage(message: string, level: 'warning' | 'error' | 'info' = 'warning', context?: Record<string, unknown>): Promise<void> {
  await Promise.allSettled([
    sendEvent({ level, message: { formatted: message.slice(0, 8000) }, extra: context }),
    logToDb({ level, message, context }),
  ])
}

// Persist a CLIENT-side error (reported by instrumentation-client.ts via
// POST /api/client-error) into the SAME log the assistant reads. Testers hit
// bugs the developer never reproduces; storing them here (source='client', with
// page URL + browser UA in context) makes user-facing errors queryable via
// /api/admin/errors without needing the Sentry dashboard. Best-effort, never throws.
export async function logClientError(row: {
  message: string; stack?: string; kind?: string; url?: string; ua?: string; userId?: string
}): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    await admin.from('error_events').insert({
      level:   'error',
      source:  'client',
      route:   row.url ? row.url.slice(0, 300) : null,
      message: (row.message || 'Client error').slice(0, 2000),
      stack:   row.stack ? row.stack.slice(0, 6000) : null,
      context: { kind: row.kind, url: row.url, ua: row.ua },
      user_id: row.userId ?? null,
    })
  } catch { /* logging must never break the app */ }
}
