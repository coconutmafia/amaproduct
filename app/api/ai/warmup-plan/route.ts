import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { AI_BUSY_MESSAGE } from '@/lib/ai/client'
import { requireProjectAccess } from '@/lib/projects/access'
import { generateWarmupPlan, type WarmupPlanInput } from '@/lib/ai/warmupPlan'

export const maxDuration = 300

// SSE-путь генерации плана прогрева. С 24.08 клиент (WarmupWizard) ходит через
// фоновый джоб POST /api/jobs/warmup-plan + поллинг — он переживает смерть
// вкладки на мобиле. Этот роут оставлен для незакрывшихся старых бандлов
// (Telegram-webview перечитывает бандл при каждом открытии, так что хвост
// короткий); ядро одно — lib/ai/warmupPlan.ts, промпт не раздваивается.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'warmup-plan')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    const input: WarmupPlanInput = await request.json()

    // A warmup plan is an expensive Claude generation with no natural write to
    // block a viewer — check editor+ explicitly (this route generates on the
    // owner's dime).
    const access = await requireProjectAccess(supabase, input.projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    // ── Stream: heartbeat каждого чанка Claude держит TCP живым ─────────────
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        try {
          send({ type: 'status', message: 'Составляю план прогрева...' })
          const r = await generateWarmupPlan(supabase, input, () => send({ type: 'progress' }))
          if (r.ok) send({ type: 'done', planData: r.planData })
          else send({ type: 'error', message: r.error })
        } catch (err) {
          // Ядро само санитизирует ошибки; сюда попадает только обрыв enqueue
          // (клиент ушёл) или совсем неожиданное — наружу готовый текст.
          console.error('[warmup-plan] SSE error:', err instanceof Error ? err.message : err)
          try { send({ type: 'error', message: AI_BUSY_MESSAGE }) } catch { /* клиент ушёл */ }
        } finally {
          try { controller.close() } catch { /* уже закрыт */ }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Warmup plan error:', error)
    await captureException(error, { where: 'warmup-plan' })
    return NextResponse.json({ error: AI_BUSY_MESSAGE }, { status: 503 })
  }
}
