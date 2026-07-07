import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, after } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { requireProjectAccess } from '@/lib/projects/access'
import { processBlogAuditJob } from '@/lib/jobs/runBlogAuditJob'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// POST /api/blog-audit { projectId } → диагностика блога по чек-листу «к продажам».
// Тот же jobs+after()-паттерн, что у instagram-скрейпа: роут валидирует вход +
// создаёт job, реальный Claude-анализ идёт в фоне (lib/jobs/runBlogAuditJob.ts),
// клиент поллит GET /api/jobs/[id]. Работает по УЖЕ подключённому my_instagram
// (без нового Apify-скрейпа). Аудит жжёт деньги Claude → требуем editor+ и
// rate-limit (как ai-роуты).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'blog-audit')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let body: { projectId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const { projectId } = body
  if (!projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Нужен подключённый аккаунт (my_instagram) — иначе анализировать нечего.
  const { data: material } = await supabase
    .from('project_materials')
    .select('id')
    .eq('project_id', projectId)
    .eq('material_type', 'my_instagram')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!material) {
    return NextResponse.json(
      { error: 'Сначала подключи свой Instagram в разделе «Материалы» — по нему делаем разбор.' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: projectId,
    type:       'blog_audit',
    status:     'queued',
    payload:    { projectId, materialId: material.id },
  }).select('id').single()
  if (error || !job) return NextResponse.json({ error: error?.message ?? 'Не удалось создать задачу' }, { status: 500 })

  after(() => processBlogAuditJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}

// GET /api/blog-audit?projectId=… → последний готовый разбор (кэш из jobs), либо
// { result: null } если ещё не запускали. Позволяет показать бейдж/скоркард без
// повторного Claude-вызова.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })

  const access = await requireProjectAccess(supabase, projectId, user.id, 'viewer')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // jobs RLS = user_id === auth.uid(): читаем свой последний разбор этого проекта.
  const { data: job } = await supabase
    .from('jobs')
    .select('result, created_at')
    .eq('project_id', projectId)
    .eq('type', 'blog_audit')
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ result: job?.result ?? null, createdAt: job?.created_at ?? null })
}
