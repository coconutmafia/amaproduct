import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { captureException, captureMessage } from '@/lib/sentry'

// Самопродолжение долгого джоба между инвокациями (транскрибация, таблица
// исследования). Инцидент Стаси 04–05.09: цепочка через self-fetch на
// /api/jobs/continue НИ РАЗУ не сработала — в журнале ai_usage ноль вызовов
// с этим роутом за всё время; джобы на 3+ батчей висли до самолечения по
// stale (10 мин) и только при живом поллере, закрытая вкладка = «до утра»
// (джоб 04.09 15:05 → 05.09 09:48). Причины класса: адрес брался из
// VERCEL_URL (защищённый деплой-домен отвечает 401 без исключения), а не-2xx
// ответ никуда не сообщался. Теперь:
//   1) адрес — канонический домен приложения, не деплой-URL;
//   2) авторизация не зависит от CRON_SECRET: у ноги одноразовый токен;
//   3) не-2xx — событие в Sentry, а не тишина;
//   4) статус 'queued' + legEnded: поллер GET /api/jobs/[id] сам запускает
//      следующую ногу, даже если self-fetch не дошёл (второй путь);
//   5) захват ноги атомарный (updated_at): два диспетчера не запустят два
//      раннера на один джоб.

export function continueUrl(): string {
  const canonical = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  const base = canonical
    ? canonical
    : process.env.VERCEL_ENV === 'production'
      ? 'https://amaproduct.com'
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'
  return `${base.replace(/\/+$/, '')}/api/jobs/continue`
}

export function newContinueToken(): string {
  return randomBytes(24).toString('hex')
}

export interface LegEndParams {
  jobId: string
  progress: Record<string, unknown>
  result?: Record<string, unknown> | null
  where: string
}

/** Нога исчерпала бюджет: сохранить прогресс, отдать джоб в очередь и позвать следующую ногу. */
export async function endLegAndContinue(admin: SupabaseClient, p: LegEndParams): Promise<void> {
  const token = newContinueToken()
  const patch: Record<string, unknown> = {
    status: 'queued',
    progress: { ...p.progress, legEnded: true, continueToken: token },
  }
  if (p.result !== undefined) patch.result = p.result
  await admin.from('jobs').update(patch).eq('id', p.jobId)

  const url = continueUrl()
  let host = ''
  try { host = new URL(url).host } catch { /* локальный адрес */ }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
        'X-Job-Token': token,
      },
      body: JSON.stringify({ jobId: p.jobId }),
    })
    if (!res.ok) {
      await captureMessage(
        `job continue: HTTP ${res.status} от ${host} — нога не передана self-fetch, ждём поллер`,
        'warning',
        { where: p.where, jobId: p.jobId, status: res.status, host },
      )
    }
  } catch (e) {
    await captureException(e, { where: `${p.where} continue-fetch`, jobId: p.jobId, host })
  }
}

export interface ClaimableRow {
  id: string
  status: string
  updated_at: string
  progress: Record<string, unknown> | null
}

/**
 * Атомарный захват ноги: из N параллельных диспетчеров (self-fetch, поллер,
 * самолечение) раннер стартует один. Возвращает прогресс захваченной ноги
 * (с номером leg и счётчиком restarts, которые обязаны переживать все
 * последующие записи progress) или null, если ногу ведёт кто-то другой.
 */
export async function claimJobLeg(admin: SupabaseClient, row: ClaimableRow): Promise<Record<string, unknown> | null> {
  const prev = row.progress ?? {}
  const leg = (typeof prev.leg === 'number' ? prev.leg : 0) + 1
  const progress: Record<string, unknown> = { ...prev, leg, legEnded: false, continueToken: null }
  const { data } = await admin
    .from('jobs')
    .update({ status: 'processing', progress })
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .select('id')
  return data && data.length > 0 ? progress : null
}

/** Поля прогресса, которые переносятся из ноги в ногу без изменений. */
export function carryProgress(progress: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const p = progress ?? {}
  const out: Record<string, unknown> = {}
  if (typeof p.leg === 'number') out.leg = p.leg
  if (typeof p.restarts === 'number') out.restarts = p.restarts
  return out
}
