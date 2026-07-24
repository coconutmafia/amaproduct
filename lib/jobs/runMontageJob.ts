import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundGenerations } from '@/lib/generations'
import { VIDEO_MONTAGE_UNITS } from '@/lib/generations-config'
import { captureException } from '@/lib/sentry'
import {
  parseSilences, buildKeepSegments, wordsToPhrases, buildFilterGraph, buildAss, totalDuration,
  type Word,
} from '@/lib/video/montage'

// Авто-монтаж рилса (MVP, 21 июля): вырезать паузы + сжечь субтитры по словам
// + хук из сценария. Только готовые кирпичи — ffmpeg-static и Whisper.
// Один прогон = одна нога (без самопродолжения): вход ограничен 60 МБ / ~90 сек,
// что укладывается в maxDuration=300 вызывающего роута с запасом.
//
// Деньги: 5 юнитов списаны В РОУТЕ до постановки джоба. Любой провал здесь
// обязан вернуть их полностью (refundGenerations) — иначе человек заплатил
// за несуществующее видео.

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bin = require('ffmpeg-static') as string | null
    if (!bin) { reject(new Error('ffmpeg binary unavailable on this platform')); return }
    execFile(bin, args, { timeout: 240_000, maxBuffer: 32 * 1024 * 1024 }, (err, _stdout, stderr) => {
      // silencedetect пишет результат в stderr при УСПЕХЕ — stderr нужен всегда
      if (err) reject(new Error(`ffmpeg: ${err.message.slice(0, 300)}`))
      else resolve(String(stderr))
    })
  })
}

async function probeDuration(inPath: string): Promise<number> {
  // ffmpeg-static не тащит ffprobe — длительность берём из stderr прогона в null
  const stderr = await runFfmpeg(['-i', inPath, '-f', 'null', '-']).catch((e) => String(e?.message ?? ''))
  const m = String(stderr).match(/time=(\d+):(\d+):([\d.]+)/g)
  if (!m?.length) return 0
  const last = m[m.length - 1].match(/time=(\d+):(\d+):([\d.]+)/)
  if (!last) return 0
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
}

export async function processMontageJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (!job || job.status === 'done' || job.status === 'error') return

  const { storagePath, hookText, projectId } = (job.payload ?? {}) as {
    storagePath?: string; hookText?: string; projectId?: string
  }
  const userId = job.user_id as string

  const tmp = `/tmp/mt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const inPath = `${tmp}-in.mp4`
  const audioPath = `${tmp}-a.mp3`
  const assPath = `${tmp}-subs.ass`
  const outPath = `${tmp}-out.mp4`
  const cleanupFs = () => Promise.allSettled([unlink(inPath), unlink(audioPath), unlink(assPath), unlink(outPath)])

  const fail = async (userMessage: string, err?: unknown) => {
    await refundGenerations(userId, VIDEO_MONTAGE_UNITS)
    await admin.from('jobs').update({ status: 'error', error: userMessage }).eq('id', jobId)
    if (err) await captureException(err, { where: 'runMontageJob', jobId })
    if (storagePath) await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
  }

  try {
    if (!storagePath || !projectId) { await fail('Видео не передано — загрузи файл ещё раз.'); return }
    await admin.from('jobs').update({ status: 'processing', progress: { stage: 'download' } }).eq('id', jobId)

    // 1. скачать исходник
    const { data: signed, error: signErr } = await admin.storage.from('audio-temp').createSignedUrl(storagePath, 600)
    if (signErr || !signed?.signedUrl) { await fail('Видео не найдено в хранилище — загрузи ещё раз.'); return }
    const dl = await fetch(signed.signedUrl)
    if (!dl.ok) { await fail('Не удалось скачать видео из хранилища.'); return }
    const buf = Buffer.from(await dl.arrayBuffer())
    if (buf.length < 10_000) { await fail('Файл пустой — возможно, не докачался из iCloud. Попробуй ещё раз.'); return }
    await writeFile(inPath, buf)

    // 2. длительность + паузы одним прогоном silencedetect
    await admin.from('jobs').update({ progress: { stage: 'analyze' } }).eq('id', jobId)
    const silenceStderr = await runFfmpeg([
      '-i', inPath, '-af', 'silencedetect=noise=-32dB:d=0.55', '-f', 'null', '-',
    ])
    const durM = silenceStderr.match(/time=(\d+):(\d+):([\d.]+)/g)
    let duration = 0
    if (durM?.length) {
      const last = durM[durM.length - 1].match(/time=(\d+):(\d+):([\d.]+)/)
      if (last) duration = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
    }
    if (!duration) duration = await probeDuration(inPath)
    if (!duration || duration < 2) { await fail('Не удалось прочитать видео — это точно видеофайл со звуком?'); return }
    if (duration > 95) { await fail('Видео длиннее 90 секунд — обрежь его и попробуй ещё раз (лимит рилса).'); return }

    const keep = buildKeepSegments(parseSilences(silenceStderr), duration)
    if (!keep.length) { await fail('В видео не нашлось речи — проверь звук.'); return }

    // 3. аудио → Whisper с таймкодами слов
    await admin.from('jobs').update({ progress: { stage: 'transcribe' } }).eq('id', jobId)
    await runFfmpeg(['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', audioPath])
    const audioBuf = await readFile(audioPath)
    const { default: OpenAI, toFile } = await import('openai')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const tr = await openai.audio.transcriptions.create({
      file: await toFile(audioBuf, 'audio.mp3', { type: 'audio/mpeg' }),
      model: 'whisper-1', language: 'ru',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    })
    const words: Word[] = ((tr as unknown as { words?: Word[] }).words ?? [])
      .map((w) => ({ word: String(w.word), start: Number(w.start), end: Number(w.end) }))
    const phrases = wordsToPhrases(words, keep)

    // 4. рендер: вырезание пауз + 9:16 + субтитры/хук одним ASS-фильтром.
    // Шрифты — из public/fonts через fontsdir (тот же приём, что у карусели).
    await admin.from('jobs').update({ progress: { stage: 'render', phrases: phrases.length } }).eq('id', jobId)
    const hasSubtitles = phrases.length > 0 || Boolean(hookText?.trim())
    if (hasSubtitles) await writeFile(assPath, buildAss(phrases, hookText ?? undefined))
    const graph = buildFilterGraph({
      keep, hasSubtitles, assPath,
      fontsDir: join(process.cwd(), 'public', 'fonts'),
    })
    await runFfmpeg([
      '-y', '-i', inPath,
      '-filter_complex', graph.filter,
      '-map', graph.videoOut, '-map', graph.audioOut,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ])

    // 5. результат в постоянное хранилище, исходник подчистить
    const outBuf = await readFile(outPath)
    const outStorage = `${projectId}/videos-out/montage-${Date.now()}.mp4`
    const { error: upErr } = await admin.storage.from('project-brand')
      .upload(outStorage, outBuf, { contentType: 'video/mp4', upsert: true })
    if (upErr) { await fail('Не удалось сохранить готовое видео. Попробуй ещё раз.', upErr); return }
    await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})

    const url = admin.storage.from('project-brand').getPublicUrl(outStorage).data.publicUrl
    await admin.from('jobs').update({
      status: 'done',
      result: {
        url,
        durationBefore: Math.round(duration * 10) / 10,
        durationAfter: Math.round(totalDuration(keep) * 10) / 10,
        cuts: Math.max(0, keep.length - 1),
        phrases: phrases.length,
      },
    }).eq('id', jobId)
  } catch (e) {
    await fail('Не удалось смонтировать видео. Попробуй ещё раз или загрузи другой файл.', e)
  } finally {
    await cleanupFs()
  }
}
