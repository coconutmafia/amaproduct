import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, after } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { parseUsername } from '@/lib/instagram/scrapeAccount'
import { processStandaloneBlogAuditJob } from '@/lib/jobs/runStandaloneBlogAuditJob'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// POST /api/blog-audit/standalone { handle } — диагностика ЛЮБОГО Instagram по
// @хендлу, без проекта (вход с главной). Скрейпит профиль на лету + аудит в
// фоне (jobs+after()), клиент поллит GET /api/jobs/[id]. Требует авторизацию;
// rate-limit строже проектного (жжёт Apify): 10/ч.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'blog-audit-standalone')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let body: { handle?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const username = parseUsername(body.handle ?? '')
  if (!username) {
    return NextResponse.json({ error: 'Укажи корректный @аккаунт Instagram или ссылку на профиль' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: null,
    type:       'blog_audit_standalone',
    status:     'queued',
    payload:    { username },
  }).select('id').single()
  if (error || !job) return NextResponse.json({ error: error?.message ?? 'Не удалось создать задачу' }, { status: 500 })

  after(() => processStandaloneBlogAuditJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}
