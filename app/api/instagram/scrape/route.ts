import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { parseUsername } from '@/lib/instagram/scrapeAccount'
import { processInstagramScrapeJob } from '@/lib/jobs/runInstagramScrapeJob'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Hard quotas (per project). Enforced server-side; the UI also hides the
// "Добавить" button at the limit, but never trust the client.
const QUOTA = { my_instagram: 1, competitors: 5 } as const
type IgType = keyof typeof QUOTA

// Background-job pattern (same as roadmap #8 transcription): this route only
// validates + enqueues a job, then returns the jobId immediately. The actual
// Apify scrape + AI analysis runs server-side via `after()`
// (lib/jobs/runInstagramScrapeJob.ts) regardless of whether the client stays
// connected — the client just polls GET /api/jobs/[id].
export async function POST(request: Request) {
  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) {
    return NextResponse.json({ error: 'APIFY_TOKEN не настроен в окружении. Добавь в Vercel env vars.' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'scrape')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let body: { projectId?: string; instagramUrl?: string; accountType?: IgType }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { projectId, instagramUrl, accountType } = body
  if (!projectId || !instagramUrl || !accountType) {
    return NextResponse.json({ error: 'projectId, instagramUrl, accountType обязательны' }, { status: 400 })
  }
  if (accountType !== 'my_instagram' && accountType !== 'competitors') {
    return NextResponse.json({ error: 'accountType должен быть my_instagram или competitors' }, { status: 400 })
  }

  const username = parseUsername(instagramUrl)
  if (!username) {
    return NextResponse.json({ error: 'Не удалось распознать имя пользователя. Используй формат instagram.com/handle или просто @handle.' }, { status: 400 })
  }

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Enforce quota — count existing accounts of this type for the project
  const { count } = await supabase
    .from('project_materials')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('material_type', accountType)
  const used  = count ?? 0
  const limit = QUOTA[accountType]
  if (used >= limit) {
    return NextResponse.json({ error: `Лимит исчерпан: для ${accountType === 'my_instagram' ? 'своего аккаунта' : 'конкурентов'} максимум ${limit}. Удали один из существующих, чтобы добавить новый.` }, { status: 400 })
  }

  // Prevent duplicate of the same username for the same project
  const { data: duplicate } = await supabase
    .from('project_materials')
    .select('id')
    .eq('project_id', projectId)
    .eq('material_type', accountType)
    .eq('title', `@${username}`)
    .maybeSingle()
  if (duplicate) {
    return NextResponse.json({ error: `@${username} уже добавлен в этот проект.` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: projectId,
    type:       'instagram_scrape',
    status:     'queued',
    payload:    { projectId, username, accountType },
  }).select('id').single()
  if (error || !job) return NextResponse.json({ error: error?.message ?? 'Не удалось создать задачу' }, { status: 500 })

  after(() => processInstagramScrapeJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}
