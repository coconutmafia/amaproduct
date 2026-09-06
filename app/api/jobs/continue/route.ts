import { NextResponse, after } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { processTranscribeJob } from '@/lib/jobs/runTranscribeJob'
import { processResearchTableJob } from '@/lib/jobs/runResearchTableJob'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

// Internal-only: нога джоба, исчерпав бюджет времени, зовёт сюда следующую
// (lib/jobs/continueLeg.ts). Авторизация — ЛИБО общий CRON_SECRET, ЛИБО
// одноразовый токен ноги (progress.continueToken): цепочка не должна зависеть
// от того, выставлен ли секрет в окружении (инцидент Стаси 04–05.09 — ноль
// сработавших продолжений за всё время жизни цепочки). Раннер захватывает ногу
// атомарно, поэтому дубль вызова (self-fetch + поллер) безопасен.
const LEG_RUNNERS: Record<string, (jobId: string) => Promise<void>> = {
  transcribe:      processTranscribeJob,
  research_table1: processResearchTableJob,
}

function tokenMatches(given: string, expected: string): boolean {
  if (!given || !expected || given.length !== expected.length) return false
  try { return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) } catch { return false }
}

export async function POST(request: Request) {
  let body: { jobId?: unknown }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const jobId = typeof body.jobId === 'string' && /^[0-9a-f-]{36}$/.test(body.jobId) ? body.jobId : null
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: job } = await admin.from('jobs').select('type, progress').eq('id', jobId).maybeSingle()
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  const bySecret = !!secret && auth === `Bearer ${secret}`
  const expected = String((job?.progress as { continueToken?: unknown } | null)?.continueToken ?? '')
  const byToken = tokenMatches(request.headers.get('x-job-token') ?? '', expected)
  // Нет джоба или нет прав — один и тот же ответ: id не подсказываем.
  if (!job || (!bySecret && !byToken)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const runner = LEG_RUNNERS[job.type as string]
  if (!runner) return NextResponse.json({ error: 'Этот тип джоба не продолжается ногами' }, { status: 400 })
  after(() => runner(jobId))
  return NextResponse.json({ ok: true })
}
