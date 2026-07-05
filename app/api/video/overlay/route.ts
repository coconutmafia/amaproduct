import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ImageResponse } from 'next/og'
import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { loadFonts, renderSlide, themeFromBrand, FORMATS, type SlideSpec } from '@/lib/carousel/engine'
import { gateContentUnit, refundGeneration } from '@/lib/generations'
import { rateLimit } from '@/lib/rateLimit'

// Burns the blogger's brand-styled text ONTO a video (owner: «загружаешь видео,
// а он на него текст накладывает»). The overlay PNG comes from our own slide
// engine (transparent background, same plates/accents as photo stories), then
// ffmpeg composites it: video → scale/crop to 9:16 → overlay → H.264.
export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_INPUT = 60 * 1024 * 1024 // ~60 MB ≈ a 60-90s phone story clip

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bin = require('ffmpeg-static') as string | null
    // ffmpeg-static exports null on unsupported platform/arch → fail readably
    // (into the refund catch) instead of execFile getting a null path.
    if (!bin) { reject(new Error('ffmpeg binary unavailable on this platform')); return }
    const child = execFile(bin, args, { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(`ffmpeg: ${err.message.slice(0, 300)}`))
      else resolve()
    })
    child.on('error', (e) => reject(e))
  })
}

export async function POST(request: Request) {
  const tmp = `/tmp/ov-${Date.now()}`
  const inPath = `${tmp}-in.mp4`
  const pngPath = `${tmp}-overlay.png`
  const outPath = `${tmp}-out.mp4`
  const cleanup = () => Promise.allSettled([unlink(inPath), unlink(pngPath), unlink(outPath)])
  let consumed = false

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'video')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const { projectId, videoPath, text, position, plate } = (await request.json()) as {
      projectId?: string; videoPath?: string; text?: string; position?: string; plate?: boolean
    }
    if (!projectId || !videoPath || !text?.trim()) return NextResponse.json({ error: 'projectId, videoPath и text обязательны' }, { status: 400 })
    if (!videoPath.startsWith(`${projectId}/videos/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

    const { data: project } = await supabase
      .from('projects')
      .select('id, brand_accent_color, brand_bg_color, brand_text_color, brand_bg_style, brand_handle, brand_logo_url, brand_kit')
      .eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Burning text onto a video is an expensive content unit (ffmpeg + render).
    const gate = await gateContentUnit(user.id)
    if (gate.blocked) return NextResponse.json({ error: 'limit_reached', code: 'limit_reached', monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit }, { status: 402 })
    consumed = true
    // Any failure past this point produced no video — refund the consumed unit.
    const fail = async (msg: string, status: number) => { await refundGeneration(user.id); return NextResponse.json({ error: msg }, { status }) }

    // Brand: story style (brand_kit.story) wins over the posts style
    const kit = (project.brand_kit as Record<string, unknown>) || {}
    const story = (kit.story as Record<string, string>) || {}
    const brand = {
      accentColor: story.accentColor || project.brand_accent_color || undefined,
      bg: story.bg || project.brand_bg_color || undefined,
      text: story.text || project.brand_text_color || undefined,
      bgStyle: (story.bgStyle || project.brand_bg_style || undefined) as 'paper' | 'solid' | 'gradient' | undefined,
      handle: project.brand_handle || undefined,
      logoUrl: project.brand_logo_url || undefined,
    }

    // 1. Download the source video
    const admin = createAdminClient()
    const { data: signed, error: signErr } = await admin.storage.from('project-brand').createSignedUrl(videoPath, 600)
    if (signErr || !signed?.signedUrl) return await fail('Видео не найдено в хранилище', 404)
    const vidRes = await fetch(signed.signedUrl)
    if (!vidRes.ok) return await fail('Не удалось скачать видео', 500)
    const vidBuf = Buffer.from(await vidRes.arrayBuffer())
    if (vidBuf.length > MAX_INPUT) return await fail('Видео слишком большое (макс ~60 МБ / ~60-90 сек)', 400)
    await writeFile(inPath, vidBuf)

    // 2. Render the transparent text overlay with our slide engine
    const pos = (['top', 'center', 'bottom'].includes(String(position)) ? position : 'bottom') as SlideSpec['position']
    const spec: SlideSpec = {
      kind: 'story', index: 0, total: 1,
      headline: text.trim().slice(0, 400),
      position: pos,
      plate: plate !== false,
      textColor: plate === false ? '#FFFFFF' : undefined,
      transparent: true,
    }
    const theme = themeFromBrand(brand)
    const fonts = await loadFonts()
    const size = FORMATS.story
    const png = new ImageResponse(renderSlide(spec, theme, size), {
      width: size.w, height: size.h, fonts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    await writeFile(pngPath, Buffer.from(await png.arrayBuffer()))

    // 3. Composite: normalize to 1080×1920, overlay, H.264 + AAC
    await runFfmpeg([
      '-y', '-i', inPath, '-i', pngPath,
      '-filter_complex', '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v];[v][1:v]overlay=0:0:format=auto',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-t', '90',
      outPath,
    ])

    // 4. Upload the result, clean the source
    const outBuf = await readFile(outPath)
    const outStorage = `${projectId}/videos-out/${Date.now()}.mp4`
    const { error: upErr } = await admin.storage.from('project-brand').upload(outStorage, outBuf, { contentType: 'video/mp4', upsert: true })
    if (upErr) return await fail(upErr.message, 500)
    await admin.storage.from('project-brand').remove([videoPath]).catch(() => {})

    const url = admin.storage.from('project-brand').getPublicUrl(outStorage).data.publicUrl
    return NextResponse.json({ url })
  } catch (e) {
    console.error('[video/overlay]', e instanceof Error ? e.message : e)
    if (consumed) {
      try {
        const sb = await createClient()
        const { data: { user: u } } = await sb.auth.getUser()
        if (u) await refundGeneration(u.id)
      } catch { /* ignore */ }
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось обработать видео' }, { status: 500 })
  } finally {
    await cleanup()
  }
}
