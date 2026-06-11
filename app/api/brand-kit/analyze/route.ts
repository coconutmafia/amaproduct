import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { anthropic, MODEL } from '@/lib/ai/client'
import sharp from 'sharp'

// Claude-vision brand extraction: reads the uploaded style samples and infers the
// project's brand kit (palette / background style / mood / font), then saves it to
// the project so carousels/posts/stories render in THAT creator's style.
export const runtime = 'nodejs'
export const maxDuration = 120

const ALLOWED_BG = ['paper', 'solid', 'gradient']

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, sampleUrls, target } = (await request.json()) as { projectId?: string; sampleUrls?: string[]; target?: string }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const forStory = target === 'story' // story style is stored separately (brand_kit.story)
    const urls = (sampleUrls || []).filter(Boolean).slice(0, 5)
    if (urls.length === 0) return NextResponse.json({ error: 'Сначала загрузи примеры стиля' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Fetch + downscale each sample → base64 (keeps the vision payload small).
    const images: { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }[] = []
    for (const u of urls) {
      try {
        const r = await fetch(u)
        if (!r.ok) continue
        const buf = Buffer.from(await r.arrayBuffer())
        const jpg = await sharp(buf).resize(820, 820, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer()
        images.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } })
      } catch { /* skip a bad image */ }
    }
    if (images.length === 0) return NextResponse.json({ error: 'Не удалось прочитать изображения' }, { status: 400 })

    const tool = {
      name: 'extract_brand_kit',
      description: 'Фирменный стиль блогера',
      input_schema: {
        type: 'object' as const,
        properties: {
          accent_color: { type: 'string', description: 'главный акцентный цвет, hex' },
          bg_color: { type: 'string', description: 'типичный фон, hex' },
          text_color: { type: 'string', description: 'цвет основного текста, hex' },
          bg_style: { type: 'string', description: 'paper | solid | gradient' },
          mood: { type: 'string' },
          font_style: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['accent_color', 'bg_color', 'text_color', 'bg_style'],
      },
    }
    const prompt = `Ты — бренд-дизайнер. Перед тобой примеры оформления ${forStory ? 'СТОРИС блогера' : 'контента блогера (посты/карусели/обложки)'}. Определи его ФИРМЕННЫЙ СТИЛЬ${forStory ? ' ИМЕННО ДЛЯ СТОРИС' : ''}, чтобы генерировать ${forStory ? 'оформление сторис' : 'карусели и посты'} в этом же стиле. Верни через инструмент extract_brand_kit: accent_color (главный акцент для выделения ключевых слов, hex), bg_color (типичный фон, hex), text_color (цвет текста, hex), bg_style (paper если фактура бумаги, solid если однотонный фон, gradient если градиент), mood (1-3 слова), font_style (короткое описание шрифта), summary (1-2 предложения о стиле).`

    let kit: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 3 && !kit; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1000,
        tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'extract_brand_kit' },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images] }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') kit = block.input as Record<string, unknown>
    }
    if (!kit) return NextResponse.json({ error: 'Не удалось распознать стиль — попробуй ещё раз' }, { status: 502 })

    const hex = (v: unknown, fb: string) => { const s = String(v ?? '').trim(); return /^#?[0-9a-fA-F]{6}$/.test(s) ? (s.startsWith('#') ? s : '#' + s) : fb }
    const accent = hex(kit.accent_color, '#EC1E8C')
    const bg = hex(kit.bg_color, '#F3EEE7')
    const text = hex(kit.text_color, '#262321')
    const bgStyle = ALLOWED_BG.includes(String(kit.bg_style)) ? String(kit.bg_style) : 'solid'
    const admin = createAdminClient()

    if (forStory) {
      // Story style → brand_kit.story (merge; main brand columns untouched)
      const story = { accentColor: accent, bg, text, bgStyle, mood: String(kit.mood ?? ''), font_style: String(kit.font_style ?? ''), summary: String(kit.summary ?? ''), samples: urls }
      const { data: row } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
      const existing = (row?.brand_kit as Record<string, unknown>) || {}
      const { error } = await admin.from('projects').update({ brand_kit: { ...existing, story } }).eq('id', projectId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ accentColor: accent, bg, text, bgStyle, story })
    }

    // Main (posts/carousels) style: merge over the existing jsonb so unrelated
    // keys (story style, saved story sets) survive a re-recognition.
    const { data: prevRow } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
    const existingKit = (prevRow?.brand_kit as Record<string, unknown>) || {}
    const brandKit: Record<string, unknown> = { ...existingKit, mood: String(kit.mood ?? ''), font_style: String(kit.font_style ?? ''), summary: String(kit.summary ?? ''), samples: urls }

    const { error } = await admin.from('projects').update({
      brand_accent_color: accent,
      brand_bg_color: bg,
      brand_text_color: text,
      brand_bg_style: bgStyle,
      brand_kit: brandKit,
      brand_kit_status: 'ready',
    }).eq('id', projectId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ accentColor: accent, bg, text, bgStyle, kit: brandKit })
  } catch (e) {
    console.error('[brand-kit/analyze]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'analyze failed' }, { status: 500 })
  }
}
