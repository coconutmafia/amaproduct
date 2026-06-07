// Export a warmup plan as a CSV table (opens in Excel / Google Sheets / Numbers).
// Tolerant of BOTH plan shapes:
//   • saved / content-plan:      { warmup_plan: { phases: [...] }, meta }
//   • wizard draft (aiPlanData):  { strategy_summary, phases: [...] }

const PHASE_LABELS: Record<string, string> = {
  niche: 'Прогрев на нишу', expert: 'Прогрев на эксперта', product: 'Прогрев на продукт', objections: 'Отработка возражений',
  awareness: 'Знакомство', trust: 'Доверие', desire: 'Желание', close: 'Закрытие', activation: 'Активация',
}

const LINE_PREFIX = /^\s*\[\s*ЛИНИЯ:\s*([^\]]*)\]\s*([\s\S]*)$/i
const stripLine = (s: string) => String(s || '').replace(/^\s*\[\s*ЛИНИЯ:[^\]]*\]\s*/i, '').trim()

type RawDay = Record<string, unknown> & { day?: number }
type RawPhase = { phase?: string; label?: string; daily_plan?: RawDay[] }

function phasesOf(planData: unknown): RawPhase[] {
  const pd = planData as { warmup_plan?: { phases?: unknown }; phases?: unknown } | null
  if (pd && Array.isArray(pd.warmup_plan?.phases)) return pd.warmup_plan!.phases as RawPhase[]
  if (pd && Array.isArray(pd.phases)) return pd.phases as RawPhase[]
  return []
}

export function planToCsv(planData: unknown): string {
  const phases = phasesOf(planData)
  const header = ['День', 'Фаза', 'Смысл дня', 'Пост', 'Сторис', 'Рилз', 'Карусель', 'Email']
  const collected: Array<{ day: number; label: string; row: RawDay }> = []
  for (const ph of phases) {
    const label = PHASE_LABELS[ph.phase ?? ''] || ph.label || ph.phase || ''
    for (const d of (Array.isArray(ph.daily_plan) ? ph.daily_plan : [])) {
      collected.push({ day: Number(d.day ?? 0), label, row: d })
    }
  }
  collected.sort((a, b) => a.day - b.day)

  const rows: string[][] = [header]
  for (const { day, label, row } of collected) {
    const meaning = (row.meaning as string) || (row.theme as string) || ''
    const b = (row.briefs as Record<string, string>) || {}
    rows.push([String(day), label, meaning, b.post || '', b.stories || '', b.reels || '', b.carousel || '', b.email || ''])
  }
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  // Leading BOM so Excel reads UTF-8 (Cyrillic) correctly; CRLF line breaks.
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')
}

// Structured table for XLSX export: День | Фаза | Линия блога | Тема | + format briefs.
// Splits the day's meaning ("[ЛИНИЯ: X] тема…") into separate Линия / Тема columns.
export function planToAoa(planData: unknown): (string | number)[][] {
  const phases = phasesOf(planData)
  const header = ['День', 'Фаза', 'Линия блога', 'Тема', 'Пост', 'Сторис', 'Рилз', 'Карусель', 'Email']
  const collected: Array<{ day: number; label: string; row: RawDay }> = []
  for (const ph of phases) {
    const label = PHASE_LABELS[ph.phase ?? ''] || ph.label || ph.phase || ''
    for (const d of (Array.isArray(ph.daily_plan) ? ph.daily_plan : [])) {
      collected.push({ day: Number(d.day ?? 0), label, row: d })
    }
  }
  collected.sort((a, b) => a.day - b.day)

  const rows: (string | number)[][] = [header]
  for (const { day, label, row } of collected) {
    const meaning = (row.meaning as string) || (row.theme as string) || ''
    const lm = meaning.match(LINE_PREFIX)
    const line = lm ? lm[1].trim() : ''
    const theme = lm ? lm[2].trim() : meaning
    const b = (row.briefs as Record<string, string>) || {}
    rows.push([day, label, line, theme, stripLine(b.post), stripLine(b.stories), stripLine(b.reels), stripLine(b.carousel), stripLine(b.email)])
  }
  return rows
}

export async function downloadPlanXlsx(name: string, planData: unknown): Promise<void> {
  const { downloadXlsx } = await import('@/lib/utils/xlsxTable')
  await downloadXlsx(name || 'План прогрева', 'План прогрева', planToAoa(planData))
}

export function downloadPlanCsv(name: string, planData: unknown): void {
  const csv = planToCsv(planData)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name || 'План прогрева').replace(/[^\wа-яёА-ЯЁ \-]/gi, '').trim().slice(0, 60) || 'plan'}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
