// Фоновая сборка «Таблицы исследования» (table1) — по жалобе Жени Лобовой
// 24.08 («Ошибка анализа — связь моргнула»): батчи идут НА СЕРВЕРЕ, клиент
// создаёт джоб и поллит /api/jobs/[id].
//
// Издание 2 (06.09, инцидент Стаси Кожемяко: «Анализирую часть 3 из 4» висело
// со вчерашнего дня, 9 из 16 джобов — «не нашёл участников»):
//   • батчи одной волны идут ПАРАЛЛЕЛЬНО (до CONCURRENCY), а не по очереди:
//     14 расшифровок раньше = 23 минуты и три ноги, теперь ≈ 4–5 минут;
//   • первый батч — «канон»: его формулировки вопросов уходят в остальные,
//     чтобы сводная таблица не рассыпалась на колонки-вариации (пропускается,
//     когда мастер проекта уже держит список вопросов);
//   • пустой батч (обрывок, приветствие) — не ошибка джоба: пропускаем,
//     ошибка только если участников нет НИГДЕ;
//   • прогресс — по батчам (progress.done[i]); нога переживает смерть
//     инвокации и продолжается с недостающих батчей;
//   • передача ноги — lib/jobs/continueLeg.ts (self-fetch с токеном + поллер
//     + самолечение, атомарный захват ноги).
// Ядро (промпт/канонизация/форс-тул) — общее с роутом: lib/research/table1.ts.
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import {
  loadKnownQuestions, runTable1Batch, questionsOf, uniqueQuestions, NO_RESPONDENTS_MESSAGE,
  type Respondent, type Table1BatchResult,
} from '@/lib/research/table1'
import { dedupeParts, isUsablePart, planBatches, type Part } from '@/lib/research/parts'
import { claimJobLeg, carryProgress, endLegAndContinue } from '@/lib/jobs/continueLeg'
import { refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { setUsageUser } from '@/lib/ai/usageContext'

// Бюджет ноги: новую волну не начинаем после этой отметки (волна ≈ до 2,5 мин
// при maxDuration=300s). Канон-батч длиннее CANON_LEG_MAX_MS тоже закрывает
// ногу — волна после него не гарантированно влезает в инвокацию.
export const LEG_BUDGET_MS = 150_000
export const CANON_LEG_MAX_MS = 60_000
export const CONCURRENCY = 5
// Мастер с таким числом вопросов заменяет канон-батч (повторные прогоны).
export const CANON_FROM_MASTER_MIN = 5

interface JobRow {
  id: string
  user_id: string
  project_id: string | null
  status: string
  updated_at: string
  payload: { projectId?: string; parts?: Part[] }
  progress: Record<string, unknown> | null
}

type DoneMap = Record<string, Respondent[]>

function readDone(p: Record<string, unknown>): DoneMap {
  const d = p.done
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {}
  const out: DoneMap = {}
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v as Respondent[]
  }
  return out
}

export async function processResearchTableJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return // идемпотентность
  const claimed = await claimJobLeg(admin, row)
  if (!claimed) return // ногу уже ведёт другой раннер

  const projectId = row.payload?.projectId || row.project_id
  const rawParts = Array.isArray(row.payload?.parts)
    ? row.payload.parts.filter(p => p && typeof p.text === 'string' && p.text.trim())
    : []
  // Дубли и обрывки режем и здесь (старые джобы, ручные parts) — роут делает
  // то же до списания единиц.
  const { parts } = dedupeParts(rawParts.filter(isUsablePart))
  if (!projectId || parts.length === 0) {
    await admin.from('jobs').update({ status: 'error', error: 'Нет расшифровок для анализа — загрузи интервью ещё раз.' }).eq('id', jobId)
    if (row.user_id) await refundGenerations(row.user_id, UNIT_COSTS.research_table).catch(() => {})
    return
  }

  setUsageUser(row.user_id ?? undefined) // чей расход — для журнала ai_usage
  const carry = carryProgress(claimed)
  const batches = planBatches(parts)
  const totalBatches = batches.length
  const done = readDone(claimed)
  const known = await loadKnownQuestions(admin, projectId)
  let canon: string[] | null = Array.isArray(claimed.canonQuestions)
    ? (claimed.canonQuestions as string[])
    : known.length >= CANON_FROM_MASTER_MIN ? known : null

  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  const pending = () => batches.map((_, i) => i).filter(i => !done[String(i)])
  const snapshot = () => ({
    ...carry,
    doneBatches: Object.keys(done).length,
    totalBatches,
    done,
    ...(canon ? { canonQuestions: canon } : {}),
  })
  const saveProgress = () => admin.from('jobs').update({ progress: snapshot() }).eq('id', jobId)
  // Таблица оплачена на POST, а повтор заводит НОВЫЙ джоб (и новое списание) —
  // любой провал обязан вернуть юниты. Готовые батчи остаются в progress.
  const fail = async (message: string) => {
    await admin.from('jobs').update({ status: 'error', error: message, progress: snapshot() }).eq('id', jobId)
    if (row.user_id) await refundGenerations(row.user_id, UNIT_COSTS.research_table).catch(() => {})
  }
  const endLeg = () => endLegAndContinue(admin, { jobId, progress: snapshot(), where: 'runResearchTableJob' })

  const partOffset = (bi: number) => batches.slice(0, bi).reduce((n, b) => n + b.length, 0)
  // Один батч → таблица; временный сбой (перегруз) повторяем один раз.
  const runOne = async (bi: number, questions: string[]): Promise<Table1BatchResult> => {
    const batch = batches[bi]
    const off = partOffset(bi)
    const text = batch
      .map((p, i) => batch.length > 1 ? `[Файл ${off + i + 1}: ${p.name}]\n${p.text}` : p.text)
      .join('\n\n---\n\n')
    let r = await runTable1Batch(text, questions)
    if (!r.ok && r.retryable) {
      await new Promise(res => setTimeout(res, 3000))
      r = await runTable1Batch(text, questions)
    }
    return r
  }

  try {
    // Канон-батч: первый батч в одиночку задаёт формулировки вопросов.
    if (canon === null && !done['0'] && totalBatches > 1) {
      const r = await runOne(0, known)
      if (!r.ok) {
        await captureException(new Error(`research-table canon batch 1/${totalBatches}: ${r.error}`), { where: 'runResearchTableJob', jobId, projectId })
        await fail(r.error)
        return
      }
      done['0'] = r.table.respondents
      canon = uniqueQuestions([...known, ...questionsOf(r.table.respondents)])
      await saveProgress()
      if (pending().length > 0 && elapsed() > CANON_LEG_MAX_MS) { await endLeg(); return }
    }

    while (pending().length > 0) {
      if (elapsed() > LEG_BUDGET_MS) { await endLeg(); return }
      const wave = pending().slice(0, CONCURRENCY)
      const questions = canon ?? known
      const settled = await Promise.all(wave.map(bi => runOne(bi, questions)))
      let failed: string | null = null
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]
        if (r.ok) done[String(wave[j])] = r.table.respondents
        else if (failed === null) failed = r.error
      }
      await saveProgress()
      if (failed !== null) {
        await captureException(new Error(`research-table wave [${wave.map(i => i + 1).join(',')}]/${totalBatches}: ${failed}`), { where: 'runResearchTableJob', jobId, projectId })
        await fail(failed)
        return
      }
    }

    const respondents = batches.flatMap((_, i) => done[String(i)] ?? [])
    if (respondents.length === 0) { await fail(NO_RESPONDENTS_MESSAGE); return }
    await admin.from('jobs').update({
      status: 'done',
      result: { table1: { respondents } },
      progress: { ...carry, doneBatches: totalBatches, totalBatches, done: {} },
    }).eq('id', jobId)
  } catch (e) {
    await captureException(e, { where: 'runResearchTableJob', jobId, projectId })
    await fail('Анализ прервался на нашей стороне. Нажми «Создать таблицу» ещё раз — расшифровка не потерялась. Единицы контента возвращены.')
  }
}
