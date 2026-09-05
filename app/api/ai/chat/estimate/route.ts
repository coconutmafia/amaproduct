import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAccess } from '@/lib/projects/access'
import { buildProjectChatContext, buildStandaloneChatContext, type ChatMsg } from '@/lib/ai/chatContext'
import { estimateChatUnits } from '@/lib/billing/chatPricing'
import { getGenerationStats } from '@/lib/generations'
import type { Project } from '@/types'

export const dynamic = 'force-dynamic'

// POST /api/ai/chat/estimate { projectId?, messages, genFormat? } — «≈ N ед.»
// до отправки (честные единицы, 05.09). Считает ТЕ ЖЕ system-блоки и историю,
// что уйдут в чат, токены — count_tokens (бесплатно). Наружу только единицы и
// остаток; себестоимость не отдаётся. Плюс последнее списание чата — чтобы
// под ответом показать «списано K ед.».
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: string; messages?: ChatMsg[]; genFormat?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content }))
  if (messages.length === 0) messages.push({ role: 'user', content: 'Привет' })

  try {
    let systemBlocks: string[]
    let apiMessages: { role: 'user' | 'assistant'; content: string }[] = messages
    if (body.projectId) {
      const access = await requireProjectAccess(supabase, body.projectId, user.id, 'viewer')
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
      const { data: project } = await supabase.from('projects').select('*').eq('id', body.projectId).single()
      if (!project) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
      const ctx = await buildProjectChatContext({
        supabase, userId: user.id, projectId: body.projectId, project: project as Project,
        genFormat: body.genFormat, messages,
      })
      systemBlocks = ctx.systemBlocks
      apiMessages = ctx.outMessages.map(m => ({ role: m.role, content: m.content }))
    } else {
      const ctx = await buildStandaloneChatContext(supabase, user.id, messages[messages.length - 1]?.content || '')
      systemBlocks = ctx.systemBlocks
    }
    const est = await estimateChatUnits(systemBlocks.map(text => ({ type: 'text' as const, text })), apiMessages)
    const stats = await getGenerationStats(user.id)

    let lastCharge: number | null = null
    try {
      const { data } = await createAdminClient()
        .from('unit_ledger')
        .select('units, created_at')
        .eq('user_id', user.id)
        .in('action', ['chat', 'content'])
        .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
      if (data && data[0]) lastCharge = Number(data[0].units)
    } catch { /* лента ещё не применена */ }

    return NextResponse.json({
      units: est.units,
      remaining: stats.remaining,
      limit: stats.monthlyLimit,
      lastCharge,
    })
  } catch {
    return NextResponse.json({ error: 'Не удалось оценить' }, { status: 500 })
  }
}
