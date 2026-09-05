import { NextResponse } from 'next/server'
import { AI_BUSY_MESSAGE } from '@/lib/ai/client'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { logAiUsage } from '@/lib/ai/usage'
import { requirePaidAccess } from '@/lib/billing/access'
import { requireProjectAccess } from '@/lib/projects/access'

// AI image generation for the «free» designer (step a): turn a text description
// into a flat-illustration STICKER (transparent PNG, dropped on a story as an
// image block) or a full story BACKGROUND. Uses OpenAI gpt-image-1 — the only
// OpenAI model that supports transparent backgrounds, which stickers need.
//
// Node runtime: we decode the returned base64 and upload it to the public
// project-brand bucket via the service role (after an ownership check), then
// hand back a URL the editor / engine can use directly.
//
// NOTE (billing): image generation is a real OpenAI cost and a NEW output type.
// Enforcement is OFF project-wide, so it isn't metered yet — when BILLING is
// switched on this is a candidate «content unit» (see PRICING §13).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Mode = 'sticker' | 'background'

function buildPrompt(raw: string, mode: Mode): string {
  const desc = raw.trim().slice(0, 800)
  if (mode === 'background') {
    return `A clean vertical 9:16 background image for an Instagram story: ${desc}. Soft, modern, tasteful, lots of calm negative space so text stays readable on top. Absolutely no text, no letters, no watermark, no logos.`
  }
  // sticker
  return `A single flat vector illustration sticker: ${desc}. Modern flat design, simple bold shapes, soft brand-friendly colours, subtle shading, centered, isolated on a fully transparent background. No text, no letters, no watermark, no drop shadow on the background.`
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'OpenAI не настроен' }, { status: 500 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'image')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    const { projectId, prompt, mode: rawMode, count: rawCount } = (await request.json()) as {
      projectId?: string; prompt?: string; mode?: string; count?: number
    }
    const mode: Mode = rawMode === 'background' ? 'background' : 'sticker'
    // Варианты на выбор (Марина 24.08: «генерирует одну картинку, и она может
    // не подходить»). 1..3 за вызов; дефолт 1 — старые клиенты не дорожают.
    const count = Math.max(1, Math.min(3, Math.floor(Number(rawCount) || 1)))
    if (!projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })
    if (!prompt || !prompt.trim()) return NextResponse.json({ error: 'Опиши, что нарисовать' }, { status: 400 })

    // Real OpenAI cost + upload goes through the admin client — check editor+
    // explicitly.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    // Цена за КАЖДЫЙ вариант, а не за клик: gpt-image-1 берёт $0.063 с картинки,
    // и «3 варианта за одну единицу» давали −16% маржи (замер 25.08).
    const imageUnits = count * UNIT_COSTS.image_per_variant
    const gate = await gateContentUnits(user.id, imageUnits, 'image')
    if (gate.blocked) {
      const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
      return NextResponse.json(
        { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
        { status: 402 },
      )
    }

    const size = mode === 'background' ? '1024x1536' : '1024x1024'
    const aspect = mode === 'background' ? 1024 / 1536 : 1

    const { default: OpenAI } = await import('openai')
    const openai = new OpenAI({ apiKey })

    let b64s: string[] = []
    try {
      const result = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: buildPrompt(prompt, mode),
        size,
        n: count,
        quality: 'medium',
        ...(mode === 'sticker' ? { background: 'transparent', output_format: 'png' } : { output_format: 'png' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      b64s = (result.data ?? []).map((d: { b64_json?: string }) => d.b64_json).filter((x: string | undefined): x is string => !!x)
      void logAiUsage({
        userId: user.id, route: 'ai/generate-image', provider: 'openai_image',
        model: 'gpt-image-1', meta: { count, mode, size },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[generate-image] openai', msg)
      await refundGenerations(user.id, imageUnits)
      // The most common real-world failure: the org hasn't unlocked gpt-image-1.
      if (/verif|access|must be verified|403|model/i.test(msg)) {
        return NextResponse.json({ error: 'Нет доступа к модели картинок (gpt-image-1). Нужно подтвердить организацию в OpenAI.' }, { status: 502 })
      }
      if (/safety|moderation|content policy/i.test(msg)) {
        return NextResponse.json({ error: 'Описание не прошло модерацию — переформулируй.' }, { status: 422 })
      }
      return NextResponse.json({ error: 'Не удалось сгенерировать картинку — попробуй ещё раз.' }, { status: 502 })
    }

    if (b64s.length === 0) {
      await refundGenerations(user.id, imageUnits)
      return NextResponse.json({ error: 'Пустой ответ генерации' }, { status: 502 })
    }

    const admin = createAdminClient()
    const stamp = Date.now()
    const urls: string[] = []
    for (let i = 0; i < b64s.length; i++) {
      const buf = Buffer.from(b64s[i], 'base64')
      const path = `${projectId}/ai/${stamp}-${i}-${mode}.png`
      const { error: upErr } = await admin.storage.from('project-brand').upload(path, buf, { contentType: 'image/png', upsert: true })
      if (upErr) {
        await captureException(new Error(upErr.message), { where: 'generate-image upload' })
        continue // один вариант не сохранился — остальные всё равно отдаём
      }
      urls.push(admin.storage.from('project-brand').getPublicUrl(path).data.publicUrl)
    }
    if (urls.length === 0) {
      return NextResponse.json({ error: 'Картинка сгенерировалась, но не сохранилась — попробуй ещё раз.' }, { status: 500 })
    }

    // url = первый вариант (обратная совместимость), urls = все на выбор
    return NextResponse.json({ url: urls[0], urls, aspect, mode })
  } catch (e) {
    console.error('[generate-image]', e instanceof Error ? e.message : e)
    await captureException(e, { where: 'generate-image' })
    return NextResponse.json({ error: AI_BUSY_MESSAGE }, { status: 503 })
  }
}
