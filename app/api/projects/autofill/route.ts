import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { runAutofill } from '@/lib/projects/autofill'

export const dynamic = 'force-dynamic'
// 300, а не 90: холодный Apify ест до 80с, а фолбэк-цепочка IG (методы 1-5 по
// 10-12с) сверху — при 90с функцию убивал Vercel ДО честного ответа, и клиент
// видел generic-тост вместо нашего сообщения (кейс Иры Varshavsky 16.08 — у неё
// первопричиной был 402, но класс таймаута реален и ловился бы тем же тостом).
export const maxDuration = 300

// Sync-путь автозаполнения. С 24.08 клиент (ProjectWizard) ходит через фоновый
// джоб POST /api/jobs/project-autofill + поллинг — он переживает смерть вкладки
// на мобиле (скрейп 20-90с). Роут оставлен для незакрывшихся старых бандлов;
// ядро одно — lib/projects/autofill.ts.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'autofill')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  // Accept both URLs — try each until one works
  const body = await request.json().catch(() => ({})) as { url?: string; instagramUrl?: string; telegramUrl?: string }
  const instagramRaw = (body.instagramUrl || (body.url && body.url.includes('instagram') ? body.url : '') || '').trim()
  const telegramRaw  = (body.telegramUrl  || (body.url && (body.url.includes('t.me') || body.url.includes('telegram')) ? body.url : '') || '').trim()

  if (!instagramRaw && !telegramRaw) {
    return NextResponse.json({ error: 'Укажи ссылку на Instagram или Telegram' }, { status: 400 })
  }

  const r = await runAutofill({ instagramRaw, telegramRaw })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({
    success: true,
    platform: r.platform,
    niche: r.niche,
    description: r.description,
    target_audience: r.target_audience,
    content_goals: r.content_goals,
  })
}
