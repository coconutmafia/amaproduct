// Фоновая сборка «Таблицы исследования» (table1) — по жалобе Жени Лобовой
// 24.08 («Ошибка анализа — связь моргнула»): раньше каждый батч был долгим
// живым запросом из браузера, и мобильная сеть/блокировка экрана рвали его.
// Теперь клиент создаёт джоб и поллит /api/jobs/[id]; батчи идут НА СЕРВЕРЕ,
// прогресс копится в job.progress, при исчерпании бюджета времени джоб
// продолжает сам себя через /api/jobs/continue (паттерн транскрибации).
// Ядро (промпт/канонизация/форс-тул) — общее с роутом: lib/research/table1.ts.
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { loadKnownQuestions, runTable1Batch, type Respondent } from '@/lib/research/table1'
import { refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { setUsageUser } from '@/lib/ai/usageContext'

const TIME_BUDGET_MS = 220_000 // на один заход; остальное — самопродолжение
const BATCH = 3                // расшифровок на один вызов Claude (как в старом клиенте)

type Part = { name: string; text: string }

interface JobRow {
  id: string
  user_id: string
  project_id: string | null
  status: string
  payload: { projectId?: string; parts?: Part[] }
  progress: { doneBatches?: number; totalBatches?: number; respondents?: Respondent[] } | null
}

function continueUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? (process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}`)
    : 'http://localhost:3000'
  return `${base}/api/jobs/continue`
}

export async function processResearchTableJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return // идемпотентность

  const projectId = row.payload?.projectId || row.project_id
  const parts = Array.isArray(row.payload?.parts) ? row.payload.parts.filter(p => p && typeof p.text === 'string' && p.text.trim()) : []
  if (!projectId || parts.length === 0) {
    await admin.from('jobs').update({ status: 'error', error: 'Нет расшифровок для анализа — загрузи интервью ещё раз.' }).eq('id', jobId)
    if (row.user_id) await refundGenerations(row.user_id, UNIT_COSTS.research_table).catch(() => {})
    return
  }

  setUsageUser(row.user_id ?? undefined) // чей расход — для журнала ai_usage
  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  const batches: Part[][] = []
  for (let i = 0; i < parts.length; i += BATCH) batches.push(parts.slice(i, i + BATCH))
  const totalBatches = batches.length

  const respondents: Respondent[] = Array.isArray(row.progress?.respondents) ? [...row.progress!.respondents!] : []
  let bi = row.progress?.doneBatches ?? 0
  const startedAt = Date.now()

  // Канонизация вопросов — один раз на заход (мастер меняется только на save)
  const knownQuestions = await loadKnownQuestions(admin, projectId)

  try {
    while (bi < totalBatches) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        await admin.from('jobs').update({
          progress: { doneBatches: bi, totalBatches, respondents },
        }).eq('id', jobId)
        after(async () => {
          try {
            await fetch(continueUrl(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET ?? ''}` },
              body: JSON.stringify({ jobId }),
            })
          } catch (e) {
            await captureException(e, { where: 'runResearchTableJob continue-fetch', jobId })
          }
        })
        return
      }

      const batch = batches[bi]
      const batchText = batch
        .map((p, i) => batch.length > 1 ? `[Файл ${bi * BATCH + i + 1}: ${p.name}]\n${p.text}` : p.text)
        .join('\n\n---\n\n')

      const r = await runTable1Batch(batchText, knownQuestions)
      if (!r.ok) {
        // Прогресс НЕ теряем: готовые батчи лежат в progress, повторный запуск
        // джоба с клиента начнёт новый джоб, но ошибка ретраебельна и честна.
        await captureException(new Error(`research-table batch ${bi + 1}/${totalBatches}: ${r.error}`), { where: 'runResearchTableJob', jobId, projectId })
        await admin.from('jobs').update({
          status: 'error',
          error: r.error,
          progress: { doneBatches: bi, totalBatches, respondents },
        }).eq('id', jobId)
        // Таблица оплачена на POST, а повтор заводит НОВЫЙ джоб (и новое
        // списание) — значит этот провал обязан вернуть юниты.
        if (row.user_id) await refundGenerations(row.user_id, UNIT_COSTS.research_table).catch(() => {})
        return
      }
      respondents.push(...r.table.respondents)
      bi++
      await admin.from('jobs').update({
        progress: { doneBatches: bi, totalBatches, respondents },
      }).eq('id', jobId)
    }

    await admin.from('jobs').update({
      status: 'done',
      result: { table1: { respondents } },
      progress: { doneBatches: totalBatches, totalBatches, respondents: [] },
    }).eq('id', jobId)
  } catch (e) {
    await captureException(e, { where: 'runResearchTableJob', jobId, projectId })
    await admin.from('jobs').update({
      status: 'error',
      error: 'Анализ прервался на нашей стороне. Нажми «Создать таблицу» ещё раз — расшифровка не потерялась. Единицы контента возвращены.',
    }).eq('id', jobId)
    if (row.user_id) await refundGenerations(row.user_id, UNIT_COSTS.research_table).catch(() => {})
  }
}
