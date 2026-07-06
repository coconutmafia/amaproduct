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

export async function captureException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err))
  await sendEvent({
    level: 'error',
    exception: { values: [{ type: e.name || 'Error', value: e.message }] },
    extra: { stack: (e.stack || '').slice(0, 4000), ...context },
  })
}

export async function captureMessage(message: string, level: 'warning' | 'error' | 'info' = 'warning', context?: Record<string, unknown>): Promise<void> {
  await sendEvent({ level, message: { formatted: message.slice(0, 8000) }, extra: context })
}
