import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { runBlogAudit } from '@/lib/blogAudit/runBlogAudit'

interface JobRow {
  id: string
  status: string
  payload: { projectId: string; materialId: string }
}

// Диагностика блога по чек-листу «к продажам». Тот же jobs+after()-паттерн, что
// у instagram-скрейпа (reliability на мобилке): роут только создаёт job, реальный
// Claude-анализ идёт здесь, клиент поллит статус. Одна Claude-итерация по тексту
// профиля укладывается в maxDuration=300 — самопродолжение не нужно.
// Результат (AuditResult) кладём в jobs.result — отдельная таблица/миграция НЕ
// нужна (jobs уже хранит project_id/type/result), кэш последнего аудита читается
// из jobs по (project_id, type='blog_audit', status='done').
export async function processBlogAuditJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return // уже завершён

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  const { projectId, materialId } = row.payload

  try {
    const { data: material } = await admin
      .from('project_materials')
      .select('title, raw_content, material_type')
      .eq('id', materialId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!material || material.material_type !== 'my_instagram') {
      throw new Error('Аккаунт не найден. Сначала подключи свой Instagram в разделе «Материалы».')
    }
    const profileText = (material.raw_content as string | null)?.trim() || ''
    if (profileText.length < 40) {
      throw new Error('В подключённом аккаунте пока нет текста для анализа. Переподключи Instagram и попробуй снова.')
    }
    const handle = (material.title as string | null)?.replace(/^@/, '').trim() || 'account'

    const result = await runBlogAudit(handle, profileText)

    await admin.from('jobs').update({ status: 'done', result: result as unknown as Record<string, unknown> }).eq('id', jobId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка диагностики'
    console.error('[runBlogAuditJob] error:', msg)
    await admin.from('jobs').update({ status: 'error', error: msg }).eq('id', jobId)
    await captureException(err, { where: 'runBlogAuditJob', jobId, projectId })
  }
}
