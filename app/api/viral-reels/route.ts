import { createClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/sentry'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { processViralReelJob } from '@/lib/jobs/runViralReelJob'
import { requireProjectAccess } from '@/lib/projects/access'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// ── GET: list reels (admin → system; user → their project's) ────────────────
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') ?? 'project'
  const projectId = searchParams.get('projectId')

  let q = supabase.from('viral_reels').select('*').order('created_at', { ascending: false })
  if (scope === 'system') q = q.eq('scope', 'system')
  else { if (!projectId) return NextResponse.json({ reels: [] }); q = q.eq('scope', 'project').eq('project_id', projectId) }

  const { data, error } = await q
  if (error) {
    if (error.message?.includes('does not exist')) return NextResponse.json({ reels: [], needsMigration: true })
    await captureException(new Error(error.message), { where: 'viral-reels GET' })
    return NextResponse.json({ error: 'Не удалось загрузить рилзы — обнови страницу' }, { status: 500 })
  }
  return NextResponse.json({ reels: data ?? [] })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('viral_reels').delete().eq('id', id)
  if (error) {
    await captureException(new Error(error.message), { where: 'viral-reels DELETE' })
    return NextResponse.json({ error: 'Не удалось удалить рилз — попробуй ещё раз' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// ── POST: enqueue scrape → transcribe → analyse → save as a background job ──
export async function POST(request: Request) {
  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) return NextResponse.json({ error: 'APIFY_TOKEN не настроен' }, { status: 500 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'viral-reels')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as {
    url?: string; scope?: 'system' | 'project'; projectId?: string; niches?: string[]
  }
  const url   = (body.url ?? '').trim()
  const scope = body.scope === 'system' ? 'system' : 'project'
  if (!url || !/instagram\.com\/(reel|p|tv)\//.test(url)) {
    return NextResponse.json({ error: 'Вставь ссылку на Instagram рилз/пост' }, { status: 400 })
  }

  // Authorisation per scope
  if (scope === 'system') {
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (prof?.role !== 'admin') return NextResponse.json({ error: 'Только админ может добавлять общие референсы' }, { status: 403 })
  } else {
    if (!body.projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })
    // Apify/Whisper/Claude cost + viral_reels write happen via the admin
    // client in the background job — check editor+ explicitly here.
    const access = await requireProjectAccess(supabase, body.projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Разбор рилза = UNIT_COSTS.viral_reels юнитов (Apify + Whisper + Claude —
  // прайс-лист 25.08). Админский scope=system не страдает: у админов юниты не
  // считаются внутри gateContentUnits. Провал джоба возвращает юниты.
  const gate = await gateContentUnits(user.id, UNIT_COSTS.viral_reels, 'viral_reels')
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json(
      { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
      { status: 402 },
    )
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: scope === 'project' ? body.projectId : null,
    type:       'viral_reel',
    status:     'queued',
    payload:    { url, scope, projectId: scope === 'project' ? body.projectId : null, niches: body.niches ?? [], createdBy: user.id },
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'viral-reels POST' })
    await refundGenerations(user.id, UNIT_COSTS.viral_reels)
    return NextResponse.json({ error: 'Не удалось создать задачу — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processViralReelJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}
