import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundGeneration } from '@/lib/generations'
import { captureException } from '@/lib/sentry'
import { ImageResponse } from 'next/og'
import { loadFonts, renderSlide, themeFromBrand, FORMATS, type SlideSpec } from '@/lib/carousel/engine'
import { MAX_VIDEO_MB } from '@/lib/uploadLimits'

// Наложение брендового текста на видео как ФОНОВЫЙ ДЖОБ. Раньше это был
// синхронный fetch на 1-3 минуты (/api/video/overlay): телефон сворачивал
// вкладку — соединение рвалось, клиент видел ошибку, юнит списан, готовый
// ролик недостижим. Тот же reliability-паттерн, что у монтажа: роут списывает
// юнит и ставит джоб, клиент поллит GET /api/jobs/[id]; провал возвращает юнит.
//
// Деньги: 1 единица контента списана В РОУТЕ до постановки джоба. Любой провал
// здесь обязан вернуть её (refundGeneration).
// Исходник (videoPath) НИКОГДА не удаляется при провале: для серии сторис это
// материал клиента (keepSource), а в одиночном режиме юзер переиспользует его
// для «Наложить заново».

const MAX_INPUT = (MAX_VIDEO_MB + 12) * 1024 * 1024

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bin = require('ffmpeg-static') as string | null
    if (!bin) { reject(new Error('ffmpeg binary unavailable on this platform')); return }
    const child = execFile(bin, args, { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(`ffmpeg: ${err.message.slice(0, 300)}`))
      else resolve()
    })
    child.on('error', (e) => reject(e))
  })
}

interface JobRow {
  id: string
  user_id: string
  status: string
  payload: {
    projectId?: string
    videoPath?: string
    text?: string
    position?: string
    plate?: boolean
    keepSource?: boolean
  }
}

export async function processVideoOverlayJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (!job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return

  await admin.from('jobs').update({ status: 'processing', progress: { stage: 'download' } }).eq('id', jobId)

  const { projectId, videoPath, text, position, plate, keepSource } = row.payload
  const userId = row.user_id

  const tmp = `/tmp/ovj-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const inPath = `${tmp}-in.mp4`
  const pngPath = `${tmp}-overlay.png`
  const outPath = `${tmp}-out.mp4`
  const cleanupFs = () => Promise.allSettled([unlink(inPath), unlink(pngPath), unlink(outPath)])

  const fail = async (userMessage: string, err?: unknown) => {
    await refundGeneration(userId).catch(() => {})
    await admin.from('jobs').update({ status: 'error', error: userMessage }).eq('id', jobId)
    if (err) await captureException(err, { where: 'runVideoOverlayJob', jobId })
  }

  try {
    if (!projectId || !videoPath || !text?.trim()) {
      await fail('Видео или текст не переданы — попробуй ещё раз.')
      return
    }

    // Бренд проекта: стиль сторис (brand_kit.story) поверх общего.
    const { data: project } = await admin
      .from('projects')
      .select('id, brand_accent_color, brand_bg_color, brand_text_color, brand_bg_style, brand_handle, brand_logo_url, brand_kit')
      .eq('id', projectId)
      .single()
    if (!project) { await fail('Проект не найден.'); return }
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

    // 1. Скачать исходник
    const { data: signed, error: signErr } = await admin.storage.from('project-brand').createSignedUrl(videoPath, 600)
    if (signErr || !signed?.signedUrl) { await fail('Видео не найдено в хранилище — загрузи его заново.'); return }
    const vidRes = await fetch(signed.signedUrl)
    if (!vidRes.ok) { await fail('Не удалось скачать видео из хранилища — попробуй ещё раз.'); return }
    const vidBuf = Buffer.from(await vidRes.arrayBuffer())
    if (vidBuf.length > MAX_INPUT) { await fail(`Видео слишком большое (макс ~${MAX_VIDEO_MB} МБ).`); return }
    await writeFile(inPath, vidBuf)

    // 2. Прозрачный оверлей с текстом — нашим слайд-движком
    await admin.from('jobs').update({ progress: { stage: 'render' } }).eq('id', jobId)
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

    // 3. Композит: 1080×1920, оверлей, H.264 + AAC
    await admin.from('jobs').update({ progress: { stage: 'composite' } }).eq('id', jobId)
    await runFfmpeg([
      '-y', '-i', inPath, '-i', pngPath,
      '-filter_complex', '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v];[v][1:v]overlay=0:0:format=auto',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-t', '90',
      outPath,
    ])

    // 4. Результат в хранилище; исходник чистим только если не просили хранить
    const outBuf = await readFile(outPath)
    const outStorage = `${projectId}/videos-out/${Date.now()}.mp4`
    const { error: upErr } = await admin.storage.from('project-brand').upload(outStorage, outBuf, { contentType: 'video/mp4', upsert: true })
    if (upErr) { await fail('Не удалось сохранить готовое видео — попробуй ещё раз.', upErr); return }
    if (!keepSource) await admin.storage.from('project-brand').remove([videoPath]).catch(() => {})

    const url = admin.storage.from('project-brand').getPublicUrl(outStorage).data.publicUrl
    await admin.from('jobs').update({ status: 'done', result: { url } }).eq('id', jobId)
  } catch (e) {
    await fail('Не удалось обработать видео — попробуй ещё раз или загрузи другой файл.', e)
  } finally {
    await cleanupFs()
  }
}
