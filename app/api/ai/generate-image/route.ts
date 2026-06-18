import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

    const { projectId, prompt, mode: rawMode } = (await request.json()) as {
      projectId?: string; prompt?: string; mode?: string
    }
    const mode: Mode = rawMode === 'background' ? 'background' : 'sticker'
    if (!projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })
    if (!prompt || !prompt.trim()) return NextResponse.json({ error: 'Опиши, что нарисовать' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const size = mode === 'background' ? '1024x1536' : '1024x1024'
    const aspect = mode === 'background' ? 1024 / 1536 : 1

    const { default: OpenAI } = await import('openai')
    const openai = new OpenAI({ apiKey })

    let b64: string | undefined
    try {
      const result = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: buildPrompt(prompt, mode),
        size,
        quality: 'medium',
        ...(mode === 'sticker' ? { background: 'transparent', output_format: 'png' } : { output_format: 'png' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      b64 = result.data?.[0]?.b64_json
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[generate-image] openai', msg)
      // The most common real-world failure: the org hasn't unlocked gpt-image-1.
      if (/verif|access|must be verified|403|model/i.test(msg)) {
        return NextResponse.json({ error: 'Нет доступа к модели картинок (gpt-image-1). Нужно подтвердить организацию в OpenAI.' }, { status: 502 })
      }
      if (/safety|moderation|content policy/i.test(msg)) {
        return NextResponse.json({ error: 'Описание не прошло модерацию — переформулируй.' }, { status: 422 })
      }
      return NextResponse.json({ error: 'Не удалось сгенерировать картинку — попробуй ещё раз.' }, { status: 502 })
    }

    if (!b64) return NextResponse.json({ error: 'Пустой ответ генерации' }, { status: 502 })

    const buf = Buffer.from(b64, 'base64')
    const admin = createAdminClient()
    const path = `${projectId}/ai/${Date.now()}-${mode}.png`
    const { error: upErr } = await admin.storage.from('project-brand').upload(path, buf, { contentType: 'image/png', upsert: true })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    const url = admin.storage.from('project-brand').getPublicUrl(path).data.publicUrl

    return NextResponse.json({ url, aspect, mode })
  } catch (e) {
    console.error('[generate-image]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'generation failed' }, { status: 500 })
  }
}
