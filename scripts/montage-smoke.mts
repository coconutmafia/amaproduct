// Живой smoke-тест конвейера монтажа: генерирует видео с «речью» и паузой,
// прогоняет РЕАЛЬНЫЙ пайплайн (silencedetect → нарезка → drawtext-субтитры с
// кириллицей) на ffmpeg-static — той же сборке, что работает на сервере.
// Запуск: npx tsx scripts/montage-smoke.mts
// Не трогает ни прод, ни API — только /tmp и локальный ffmpeg.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { parseSilences, buildKeepSegments, buildFilterGraph, buildAss } from '../lib/video/montage'

const T = `/tmp/montage-smoke-${process.pid}`
const IN = `${T}-in.mp4`
const ASS = `${T}-subs.ass`
const OUT = `${T}-out.mp4`

const run = async (args: string[]): Promise<string> => {
  const { stderr } = await promisify(execFile)(ffmpegPath as unknown as string, args, { maxBuffer: 32 * 1024 * 1024 })
  return String(stderr)
}
const durOf = (stderr: string): number => {
  const m = stderr.match(/time=(\d+):(\d+):([\d.]+)/g)
  if (!m?.length) return 0
  const l = m[m.length - 1].match(/time=(\d+):(\d+):([\d.]+)/)!
  return Number(l[1]) * 3600 + Number(l[2]) * 60 + Number(l[3])
}

// 1. вход: 12с, «тишина» 4-6.5с (громкость почти ноль)
await run([
  '-y', '-f', 'lavfi', '-i', 'color=c=0x224466:s=540x960:d=12',
  '-f', 'lavfi', '-i', "sine=frequency=300:duration=12,volume='if(between(t,4,6.5),0.001,1)':eval=frame",
  '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', IN,
])

// 2. паузы
const stderr = await run(['-i', IN, '-af', 'silencedetect=noise=-32dB:d=0.55', '-f', 'null', '-'])
const silences = parseSilences(stderr)
const duration = durOf(stderr)
console.log('паузы:', JSON.stringify(silences), 'длительность:', duration)
if (!silences.length) throw new Error('silencedetect не нашёл паузу')

const keep = buildKeepSegments(silences, duration)
console.log('оставляем:', JSON.stringify(keep))

// 3. рендер: ASS-субтитры с кириллицей (drawtext в ffmpeg-static НЕ собран!)
writeFileSync(ASS, buildAss(
  [
    { text: 'привет это тест', start: 0.3, end: 1.8 },
    { text: 'субтитры по словам', start: 2.0, end: 3.5 },
    { text: 'после вырезанной паузы', start: 4.0, end: 6.0 },
  ],
  'почему твой блог не продаёт',
))
const graph = buildFilterGraph({
  keep, hasSubtitles: true, assPath: ASS,
  fontsDir: join(process.cwd(), 'public/fonts'),
})
await run([
  '-y', '-i', IN,
  '-filter_complex', graph.filter,
  '-map', graph.videoOut, '-map', graph.audioOut,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25',
  '-c:a', 'aac', '-movflags', '+faststart', OUT,
])
console.log('выход:', statSync(OUT).size, 'байт')

// 4. пауза реально вырезана?
const outDur = durOf(await run(['-i', OUT, '-f', 'null', '-']))
console.log('длительность результата:', outDur)
if (outDur > duration - 1) throw new Error(`пауза НЕ вырезана (${outDur} из ${duration})`)
console.log(`\n✅ КОНВЕЙЕР РАБОТАЕТ: ${duration}с → ${outDur}с, drawtext с кириллицей прошёл (${OUT})`)
