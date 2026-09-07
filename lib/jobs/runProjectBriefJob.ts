// Фоновая пересборка «памяти проекта» (см. lib/ai/projectBrief.ts). Один
// проход Opus 5 по всем материалам (~$1–2 на большом проекте), результат в
// project_briefs. Пользователю не списывается: это наша экономия, а не его
// действие. Ставится в очередь из сборки контекста чата, когда бриф устарел.
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException, captureMessage } from '@/lib/sentry'
import { setUsageUser } from '@/lib/ai/usageContext'
import { collectBriefInput, generateProjectBrief, briefSourceHash } from '@/lib/ai/projectBrief'
import { MODEL } from '@/lib/ai/client'

interface JobRow { id: string; user_id: string; project_id: string | null; status: string; payload: { projectId?: string; sourceHash?: string } }

export async function processProjectBriefJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return
  const projectId = row.payload?.projectId || row.project_id
  if (!projectId) { await admin.from('jobs').update({ status: 'error', error: 'Нет проекта' }).eq('id', jobId); return }
  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)
  setUsageUser(row.user_id ?? undefined)
  try {
    const collected = await collectBriefInput(admin, projectId)
    if (!collected) { await admin.from('jobs').update({ status: 'error', error: 'Проект не найден' }).eq('id', jobId); return }
    // Хэш — по состоянию НА МОМЕНТ генерации (материалы могли измениться после постановки в очередь)
    const sourceHash = briefSourceHash(collected.input.project, collected.index)
    const r = await generateProjectBrief(collected.input)
    const { error: upErr } = await admin.from('project_briefs').upsert({
      project_id: projectId, brief: r.brief, source_hash: sourceHash, input_chars: r.inputChars,
      tokens: r.usage.output_tokens, model: MODEL, status: 'ready', error: null,
    }, { onConflict: 'project_id' })
    if (upErr) {
      if (/project_briefs|does not exist|schema cache/i.test(upErr.message)) {
        await captureMessage('project_brief: таблицы project_briefs нет — применить миграцию 049', 'warning', { projectId })
        await admin.from('jobs').update({ status: 'error', error: 'Память проекта не сохранена — нужна миграция 049.' }).eq('id', jobId)
        return
      }
      throw new Error(upErr.message)
    }
    await admin.from('jobs').update({ status: 'done', result: { chars: r.brief.length, inputChars: r.inputChars, truncated: r.truncated, usage: r.usage } }).eq('id', jobId)
  } catch (e) {
    await captureException(e, { where: 'runProjectBriefJob', jobId, projectId })
    await admin.from('jobs').update({ status: 'error', error: 'Не удалось собрать память проекта — попробуем при следующем сообщении.' }).eq('id', jobId)
    // Бриф с ошибкой не пишем: чат продолжит работать по полному слою.
  }
}
