'use client'

import { useEffect, useState } from 'react'

// Friendly nudge for users who open AMA inside an in-app browser (Instagram /
// Telegram / TikTok WebViews). Those old WebViews can lack a working `URL`
// constructor — Next's client router does `new URL(...)` on navigation, so the
// app breaks with «URL is not a constructor». Августа's testers arrive via
// links shared in IG/TG, so this is a real segment. We can't reliably polyfill
// deep browser APIs in a customized Next build, so we detect and suggest opening
// in a real browser. Copy-link is the most reliable escape hatch (in-app
// browsers often ignore window.open / target=_blank).

const DISMISS_KEY = 'ama_inapp_notice_dismissed'

function shouldWarn(): boolean {
  // Definitive: the URL constructor is broken → the app can't route reliably.
  try { new URL('https://a/b?c#d') } catch { return true }
  // Preventive: known in-app browser user agents.
  const ua = navigator.userAgent || ''
  return /Instagram|FBAN|FBAV|FB_IAB|Telegram|TikTok|Line\/|MicroMessenger|GSA\/|; wv\)/i.test(ua)
}

export function InAppBrowserNotice() {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return
      if (shouldWarn()) setShow(true)
    } catch { /* storage blocked — just skip */ }
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* clipboard blocked in some webviews — user can copy from address bar */ }
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[100] bg-amber-500 text-black shadow-md">
      <div className="mx-auto max-w-2xl px-4 py-2.5 flex items-start gap-3 text-sm">
        <div className="flex-1 leading-snug">
          <strong>Вы открыли AMA во встроенном браузере.</strong>{' '}
          Для стабильной работы откройте сайт в Safari или Chrome — нажмите «⋯» вверху и выберите «Открыть в браузере».
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            onClick={copy}
            className="rounded-full bg-black/85 text-white text-xs font-semibold px-3 py-1 hover:bg-black transition-colors"
          >
            {copied ? 'Скопировано ✓' : 'Скопировать ссылку'}
          </button>
          <button onClick={dismiss} className="text-xs text-black/70 hover:text-black underline">
            скрыть
          </button>
        </div>
      </div>
    </div>
  )
}
