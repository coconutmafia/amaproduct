// Отправка заявки с диагностики в amoCRM через API v4 (частная интеграция с
// долгосрочным токеном — путь для НАШЕГО сайта; Tilda-формы ходят своей
// встроенной интеграцией и нас не касаются).
//
// Включается ДВУМЯ env (без деплоя кода): AMOCRM_SUBDOMAIN (xxx из
// xxx.amocrm.ru) + AMOCRM_TOKEN (долгосрочный токен интеграции). Опционально
// AMOCRM_PIPELINE_NAME / AMOCRM_STATUS_NAME — имя воронки/этапа, куда класть
// (без них amoCRM кладёт в первый этап основной воронки). Метка источника —
// тег «Заявка с диагностики» на сделке.
//
// Схема: создаём сделку комплексным эндпоинтом (сделка + контакт одним
// запросом), затем прикладываем примечание с Telegram/Instagram — у amoCRM
// нет стандартных полей под них, а примечание видно менеджеру сразу в карточке.
import { captureException } from '@/lib/sentry'

export type DiagnosticLead = { name: string; telegram: string; instagram: string; email: string }

// Значения из env чистим от пробелов/переносов (артефакты вставки в Vercel).
// Токен с НЕ-ASCII символом (реальный случай 31.08: при вставке в Vercel в
// значение попал «•», и fetch падал с криптичным «Cannot convert argument to
// a ByteString») — ловим заранее и говорим по-человечески.
const cleanEnv = (v?: string) => (v ?? '').trim()
export function amoTokenProblem(): string | null {
  const t = cleanEnv(process.env.AMOCRM_TOKEN)
  if (!t) return null
  const bad = t.match(/[^\x21-\x7E]/)
  if (bad) return `AMOCRM_TOKEN содержит недопустимый символ «${bad[0]}» (код ${bad[0].codePointAt(0)}) на позиции ${bad.index} — токен вставлен с мусором, перевставь его целиком`
  return null
}

export function amoConfigured(): boolean {
  return !!(cleanEnv(process.env.AMOCRM_SUBDOMAIN) && cleanEnv(process.env.AMOCRM_TOKEN))
}

const base = () => `https://${cleanEnv(process.env.AMOCRM_SUBDOMAIN)}.amocrm.ru`
const authHeaders = () => ({
  Authorization: `Bearer ${cleanEnv(process.env.AMOCRM_TOKEN)}`,
  'Content-Type': 'application/json',
})

// Чистый строитель тела — проверяется юнит-тестом без сети.
export function buildAmoLeadPayload(lead: DiagnosticLead, pipelineId?: number, statusId?: number) {
  return [{
    name: `Заявка с диагностики — ${lead.name}`,
    ...(pipelineId ? { pipeline_id: pipelineId } : {}),
    ...(statusId ? { status_id: statusId } : {}),
    _embedded: {
      tags: [{ name: 'Заявка с диагностики' }],
      contacts: [{
        first_name: lead.name,
        custom_fields_values: lead.email
          ? [{ field_code: 'EMAIL', values: [{ value: lead.email }] }]
          : undefined,
      }],
    },
  }]
}

export function buildAmoNoteText(lead: DiagnosticLead): string {
  return [`Telegram: @${lead.telegram}`, `Instagram: @${lead.instagram}`, lead.email ? `Email аккаунта AMA: ${lead.email}` : null]
    .filter(Boolean).join('\n')
}

// Резолв id воронки/этапа по именам из env (если заданы). Ошибки не роняют
// отправку — сделка уйдёт в дефолтную воронку, менеджер её всё равно увидит.
async function resolvePipeline(): Promise<{ pipelineId?: number; statusId?: number }> {
  const wantPipe = process.env.AMOCRM_PIPELINE_NAME?.trim().toLowerCase()
  if (!wantPipe) return {}
  try {
    const r = await fetch(`${base()}/api/v4/leads/pipelines`, { headers: authHeaders() })
    if (!r.ok) return {}
    const d = await r.json() as { _embedded?: { pipelines?: Array<{ id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string }> } }> } }
    const pipe = d._embedded?.pipelines?.find((p) => p.name.trim().toLowerCase() === wantPipe)
    if (!pipe) return {}
    const wantStatus = process.env.AMOCRM_STATUS_NAME?.trim().toLowerCase()
    const status = wantStatus ? pipe._embedded?.statuses?.find((s) => s.name.trim().toLowerCase() === wantStatus) : undefined
    return { pipelineId: pipe.id, statusId: status?.id }
  } catch {
    return {}
  }
}

export async function sendLeadToAmo(lead: DiagnosticLead): Promise<boolean> {
  if (!amoConfigured()) return false
  const tokenProblem = amoTokenProblem()
  if (tokenProblem) {
    await captureException(new Error(tokenProblem), { where: 'amocrm sendLead' })
    return false
  }
  try {
    const { pipelineId, statusId } = await resolvePipeline()
    const r = await fetch(`${base()}/api/v4/leads/complex`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify(buildAmoLeadPayload(lead, pipelineId, statusId)),
    })
    if (!r.ok) {
      await captureException(new Error(`amo complex ${r.status}: ${(await r.text()).slice(0, 200)}`), { where: 'amocrm sendLead' })
      return false
    }
    const created = await r.json() as Array<{ id?: number }>
    const leadId = created?.[0]?.id
    if (leadId) {
      // Примечание с контактами — best-effort: сделка уже создана
      await fetch(`${base()}/api/v4/leads/${leadId}/notes`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify([{ note_type: 'common', params: { text: buildAmoNoteText(lead) } }]),
      }).catch(() => {})
    }
    return true
  } catch (e) {
    await captureException(e, { where: 'amocrm sendLead' })
    return false
  }
}
