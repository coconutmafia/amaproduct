// Client-side error reporting to Sentry (lite, no SDK — see lib/sentry.ts for
// why). Runs before the app becomes interactive. Caps at 5 events per page
// load so a render-loop error can't burn the Sentry free quota.
const DSN = 'https://d02780e0380bb068f31e9654616748ba@o4511687858847744.ingest.de.sentry.io/4511687873658960'

const m = DSN.match(/^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/)
let sent = 0

function report(kind: string, message: string, stack?: string) {
  if (!m || sent >= 5) return
  sent++
  const eventId = (crypto.randomUUID?.() || String(Date.now())).replace(/-/g, '')
  const sentAt = new Date().toISOString()
  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: sentAt }) + '\n' +
    JSON.stringify({ type: 'event' }) + '\n' +
    JSON.stringify({
      event_id: eventId, timestamp: sentAt, platform: 'javascript', level: 'error',
      exception: { values: [{ type: kind, value: String(message).slice(0, 500) }] },
      extra: { stack: (stack || '').slice(0, 3000), url: location.href, ua: navigator.userAgent },
    })
  try {
    fetch(`https://${m[2]}/api/${m[3]}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${m[1]}, sentry_client=ama-lite/1.0` },
      body: envelope,
      keepalive: true,
    }).catch(() => {})
  } catch { /* never break the app */ }
}

window.addEventListener('error', (e) => {
  report(e.error?.name || 'Error', e.message || 'window.onerror', e.error?.stack)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  report(r?.name || 'UnhandledRejection', r?.message || String(r), r?.stack)
})
