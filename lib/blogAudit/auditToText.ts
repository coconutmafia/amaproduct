import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'
import { MAX_SCORE } from '@/lib/blogAudit/checklist'

// Какие БЛОКИ попали в каждую зону — «надо пояснить снизу, что для ЭТОГО блога
// зелёное, что жёлтое, что серое. Вкратце» (Августа, 17 июля). Без этого зоны
// объясняются абстрактно, и человек не понимает, к чему они относятся у НЕГО.
//
// Правило: блок, где нечего было оценивать машинно → серый (нужен эксперт).
// Остальные — по доле набранного: с половины и выше «собрано», ниже — «зона роста».
// Блок может быть оценён частично (часть пунктов не видна) — он всё равно попадает
// в зелёный/жёлтый по оценённой части, иначе список зон раздулся бы дублями.
export function zoneBreakdown(result: AuditResult): { green: string[]; yellow: string[]; grey: string[] } {
  const g: string[] = [], y: string[] = [], s: string[] = []
  for (const b of result.blocks) {
    if (b.assessableMax === 0) { s.push(b.title); continue }
    ;(b.scored / b.assessableMax >= 0.5 ? g : y).push(b.title)
  }
  return { green: g, yellow: y, grey: s }
}

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
  const z = zoneBreakdown(result)
  const list = (a: string[]) => (a.length ? a.join(', ') : '—')
  L.push(`  • ${green} — собрано: критерии диагностики выполнены`)
  L.push(`      у этого блога: ${list(z.green)}`)
  L.push(`  • ${yellow} — зона роста: критерии не выполнены, это можно улучшить`)
  L.push(`      у этого блога: ${list(z.yellow)}`)
  L.push(`  • ${grey} — нужна оценка эксперта: автоматически проверить невозможно`)
  L.push(`      у этого блога: ${list(z.grey)}`)

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
