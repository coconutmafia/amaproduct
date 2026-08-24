import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { requireProjectAccess } from '@/lib/projects/access'
import { processResearchTableJob } from '@/lib/jobs/runResearchTableJob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/jobs/research-table { projectId, parts: [{name,text}] } — фоновая
// сборка «Таблицы исследования». Появился 24.08 по жалобе Жени Лобовой: долгие
// живые запросы table1 рвались мобильной сетью; джоб переживает и сеть, и
// закрытие вкладки (клиент поллит GET /api/jobs/[id] с самолечением stale).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'research-analyze')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  let body: { projectId?: string; parts?: { name?: string; text?: string }[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const projectId = body.projectId
  const parts = (Array.isArray(body.parts) ? body.parts : [])
    .map(p => ({ name: String(p?.name ?? 'Интервью').slice(0, 120), text: String(p?.text ?? '') }))
    .filter(p => p.text.trim().length > 0)
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (parts.length === 0) return NextResponse.json({ error: 'Нет расшифровок для анализа' }, { status: 400 })

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: projectId,
    type:       'research_table1',
    status:     'queued',
    payload:    { projectId, parts },
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'research-table POST' })
    return NextResponse.json({ error: 'Не удалось запустить анализ — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processResearchTableJob(job.id as string))
  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
