// Client-side error reporting to Sentry (lite, no SDK — see lib/sentry.ts for
// why). Runs before the app becomes interactive. Caps at 5 events per page
// load so a render-loop error can't burn the Sentry free quota.
const DSN = 'https://d02780e0380bb068f31e9654616748ba@o4511687858847744.ingest.de.sentry.io/4511687873658960'

const m = DSN.match(/^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/)
let sent = 0

// Browser-extension noise — NOT our code. Crypto-wallet extensions (MetaMask,
// Phantom, …) inject a provider into every page and throw connection errors
// ("Failed to connect to MetaMask") on sites that have nothing to do with web3.
// Anything thrown from an extension URL is likewise never ours. Dropping these
// keeps /admin/errors + Sentry high-signal (matters for reading real failures
// like the Prodamus webhook). We have no web3/wallet feature, so these keywords
// can't be a genuine app error.
const EXTENSION_NOISE = /metamask|ethereum|web3|wallet|solana|phantom|coinbase|chrome-extension:\/\/|moz-extension:\/\/|safari-web-extension:\/\//i

// Атрибуция «TypeError: Load failed» (Safari, повторяется на /dashboard и
// /knowledge с айфонов): у события НИКОГДА нет стека, и невозможно понять,
// какой именно запрос упал. Оборачиваем fetch и запоминаем URL последнего
// упавшего — отчёт понесёт его в контексте (lastFetch). Обёртка прозрачна:
// те же аргументы, тот же promise, ошибка перебрасывается как есть.
let lastFailedFetch: { url: string; at: number } | null = null
try {
  const origFetch = window.fetch.bind(window)
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    let url = ''
    try {
      const a = args[0]
      url = String(a instanceof Request ? a.url : a).slice(0, 300)
    } catch { /* URL не читается — не мешаем запросу */ }
    return origFetch(...args).catch((e: unknown) => {
      // Свои же репортерские запросы уликой не считаем — иначе их отказ
      // (например, при обрыве сети) перезаписал бы настоящий источник.
      if (!/\/api\/client-error|sentry\.io/.test(url)) {
        lastFailedFetch = { url, at: Date.now() }
      }
      throw e
    })
  }) as typeof fetch
} catch { /* не смогли обернуть — репортер работает как раньше */ }

function report(kind: string, message: string, stack?: string) {
  if (!m || sent >= 5) return
  if (EXTENSION_NOISE.test(message) || (stack && EXTENSION_NOISE.test(stack))) return
  sent++
  // Свежий (≤10с) упавший fetch — почти наверняка источник «Load failed».
  const lastFetch = lastFailedFetch && Date.now() - lastFailedFetch.at < 10_000
    ? lastFailedFetch.url
    : undefined
  const eventId = (crypto.randomUUID?.() || String(Date.now())).replace(/-/g, '')
  const sentAt = new Date().toISOString()
  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: sentAt }) + '\n' +
    JSON.stringify({ type: 'event' }) + '\n' +
    JSON.stringify({
      event_id: eventId, timestamp: sentAt, platform: 'javascript', level: 'error',
      exception: { values: [{ type: kind, value: String(message).slice(0, 500) }] },
      extra: { stack: (stack || '').slice(0, 3000), url: location.href, ua: navigator.userAgent, lastFetch },
    })
  try {
    fetch(`https://${m[2]}/api/${m[3]}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${m[1]}, sentry_client=ama-lite/1.0` },
      body: envelope,
      keepalive: true,
    }).catch(() => {})
  } catch { /* never break the app */ }

  // ALSO persist to our own error log so the team + assistant read testers'
  // errors via /admin/errors without the Sentry dashboard (source='client').
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, message: String(message).slice(0, 500), stack: (stack || '').slice(0, 3000), url: location.href, ua: navigator.userAgent, lastFetch }),
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

// Capability probe: some in-app browsers (old Android WebViews, in-app IG/TG
// browsers) lack a working URL constructor. Next's client router does
// `new URL(...)` on navigation, so this surfaces as «URL is not a constructor»
// and breaks the app. Report it explicitly WITH the UA (via report → our log +
// Sentry) so we can identify the exact browser and decide the fix.
try {
  new URL('https://a/b?c#d')
} catch (err) {
  report('UnsupportedBrowser', 'URL constructor отсутствует — вероятно устаревший in-app браузер', (err as Error)?.stack)
}
