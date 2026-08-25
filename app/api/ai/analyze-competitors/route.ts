import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { requireProjectAccess } from '@/lib/projects/access'
import { analyzeCompetitors } from '@/lib/ai/competitorTable'

// Builds a competitor-comparison TABLE from the scraped Instagram data the
// project already has (project_materials.material_type = 'competitors', plus the
// blogger's own 'my_instagram' for a tailored takeaway). Returns structured rows
// the client renders + exports to XLSX.
//
// Sync-путь. С 24.08 клиент (CompetitorAnalysis) ходит через фоновый джоб
// POST /api/jobs/analyze-competitors + поллинг — он переживает смерть вкладки
// на мобиле. Роут оставлен для незакрывшихся старых бандлов; ядро одно —
// lib/ai/competitorTable.ts.
export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'analyze-competitors')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  const { projectId } = (await request.json().catch(() => ({}))) as { projectId?: string }
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Сводная таблица конкурентов = UNIT_COSTS.competitor_table юнит (флагман по
  // всем разборам; кнопка повторяемая). Провал возвращает юнит сразу.
  const gate = await gateContentUnits(user.id, UNIT_COSTS.competitor_table)
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json(
      { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
      { status: 402 },
    )
  }

  const r = await analyzeCompetitors(supabase, projectId)
  if (!r.ok) {
    await refundGenerations(user.id, UNIT_COSTS.competitor_table)
    const status = r.error.startsWith('Сначала добавь конкурентов') ? 400 : 503
    return NextResponse.json({ error: r.error }, { status })
  }
  return NextResponse.json({ competitors: r.rows })
}
