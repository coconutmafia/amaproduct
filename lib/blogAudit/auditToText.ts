import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'
import { MAX_SCORE } from '@/lib/blogAudit/checklist'

// Плоский текст диагностики для скачивания в .docx.
//
// Зачем: разбор длинный, и владелец/клиенты пересылали его СКРИНШОТАМИ по частям
// («и им эти скрины неудобно, и мне они эту хуйню присылают» — 17 июля). Документ
// можно отправить одним файлом, переслать маркетологу и открыть с телефона.
//
// Формат повторяет экран: диагноз → как сложились 100 баллов → вердикт → что
// усилить → разбор по блокам в виде ВОПРОС → ОТВЕТ (пункты чек-листа — вопросы).
export function auditToText(result: AuditResult, dateLabel: string): string {
  const green = Math.max(0, result.scored)
  const grey = Math.max(0, MAX_SCORE - result.assessableMax)
  const yellow = Math.max(0, result.assessableMax - result.scored)

  const L: string[] = []
  L.push(`Профиль: @${result.handle}`)
  L.push(`Дата разбора: ${dateLabel}`)
  L.push('')
  L.push(`ДИАГНОЗ: ${result.diagnosis}`)
  L.push('')
  L.push('КАК СКЛАДЫВАЮТСЯ 100 БАЛЛОВ ЧЕК-ЛИСТА')
  L.push('Мы разобрали шапку профиля и последние посты. Сторис, актуальные и то, куда ведёт')
  L.push('ссылка, автоматически увидеть нельзя — эти баллы вынесены отдельно.')
  L.push(`  • ${green} — уже сделано: есть в шапке и постах, работает на продажу`)
  L.push(`  • ${grey} — не проверить автоматически: сторис, актуальные, воронка — посмотрит маркетолог`)
  L.push(`  • ${yellow} — можно усилить: в шапке и постах это есть, но недотянуто`)

  if (result.summary) {
    L.push('')
    L.push('ВЕРДИКТ')
    L.push(result.summary)
  }

  if (result.topGaps.length > 0) {
    L.push('')
    L.push('ЧТО УСИЛИТЬ В ПЕРВУЮ ОЧЕРЕДЬ')
    result.topGaps.forEach((g, i) => L.push(`  ${i + 1}. ${g}`))
  }

  L.push('')
  L.push('РАЗБОР ПО БЛОКАМ')
  for (const b of result.blocks) {
    L.push('')
    // Балл блока показываем только если в нём было что оценивать машинно.
    const head = b.assessableMax > 0 ? `${b.title} — ${b.scored} из ${b.assessableMax}` : `${b.title} — на консультации`
    L.push(head)
    for (const it of b.items) {
      L.push(`  ${it.label}`)
      L.push(`    ${it.note}`)
    }
  }

  L.push('')
  L.push('—')
  L.push('AMAproduct — экспресс-диагностика блога. Полный разбор актуальных, визуала и воронки —')
  L.push('на бесплатной консультации маркетолога.')
  return L.join('\n')
}
