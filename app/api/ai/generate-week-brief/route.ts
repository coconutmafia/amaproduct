import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { requireProjectAccess } from '@/lib/projects/access'
import { generateWeekBrief, type BriefDay } from '@/lib/ai/weekBrief'
import { NextResponse } from 'next/server'

export const maxDuration = 90

// Sync-путь генерации плана недели. С 24.08 клиент (content-plan) ходит через
// фоновый джоб POST /api/jobs/week-brief + поллинг — он переживает смерть
// вкладки на мобиле и сам сохраняет брифы в warmup_plans. Этот роут оставлен
// для незакрывшихся старых бандлов; ядро одно — lib/ai/weekBrief.ts.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'generate-week-brief')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  const { projectId, days } = await request.json() as { projectId: string; days: BriefDay[] }

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const r = await generateWeekBrief(supabase, projectId, days)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json({ days: r.days })
}
