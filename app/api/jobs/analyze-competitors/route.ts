import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { requireProjectAccess } from '@/lib/projects/access'
import { processCompetitorAnalysisJob } from '@/lib/jobs/runCompetitorAnalysisJob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/jobs/analyze-competitors { projectId } — фоновый анализ конкурентов
// (24.08, хвост класса «долгий запрос умирает на мобиле»). Клиент кладёт jobId
// в localStorage СРАЗУ и поллит GET /api/jobs/[id]; вкладку можно закрывать.
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

  // Fail fast: без материалов конкурентов джоб заведомо бессмыслен — честный
  // 400 сразу (как у sync-пути), а не error в поллинге.
  const { data: comp } = await supabase
    .from('project_materials')
    .select('id, raw_content')
    .eq('project_id', projectId)
    .eq('material_type', 'competitors')
    .limit(5)
  const hasCompetitors = (comp ?? []).some((c) => (c.raw_content || '').trim())
  if (!hasCompetitors) {
    return NextResponse.json({ error: 'Сначала добавь конкурентов в Instagram (раздел «Конкуренты»).' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: projectId,
    type:       'competitor_analysis',
    status:     'queued',
    payload:    { projectId },
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'analyze-competitors job POST' })
    return NextResponse.json({ error: 'Не удалось запустить анализ — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processCompetitorAnalysisJob(job.id as string))
  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
