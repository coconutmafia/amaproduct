import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'

// Плоская текстовая выгрузка жила здесь до 27.08 и удалена вместе с переходом
// на оформленный документ: владелец справедливо заметил, что разбор скачивался
// простынёй, хотя на экране он разложен по зонам и карточкам. 01.09 документ
// стал PDF (lib/blogAudit/auditToPdf.tsx) — docx разваливался в Quick Look у
// получателей в Telegram. Здесь остались хелперы, общие для экрана и документа.

// Какие БЛОКИ попали в каждую зону — «надо пояснить снизу, что для ЭТОГО блога
// зелёное, что жёлтое, что серое. Вкратце» (Августа, 17 июля). Без этого зоны
// объясняются абстрактно, и человек не понимает, к чему они относятся у НЕГО.
//
// Правило: блок, где нечего было оценивать машинно → серый (нужен эксперт).
// Остальные — по доле набранного: с половины и выше «собрано», ниже — «зона роста».
// Блок может быть оценён частично (часть пунктов не видна) — он всё равно попадает
// в зелёный/жёлтый по оценённой части, иначе список зон раздулся бы дублями.
// Русское склонение слова «балл» — общее для экрана (BlogAuditDialog) и
// PDF-выгрузки (auditToPdf), чтобы подписи зон совпадали дословно.
export function ballWord(n: number): string {
  const a = Math.abs(n) % 100
  const b = n % 10
  if (a > 10 && a < 20) return 'баллов'
  if (b === 1) return 'балл'
  if (b > 1 && b < 5) return 'балла'
  return 'баллов'
}

export function zoneBreakdown(result: AuditResult): { green: string[]; yellow: string[]; grey: string[] } {
  const g: string[] = [], y: string[] = [], s: string[] = []
  for (const b of result.blocks) {
    if (b.assessableMax === 0) { s.push(b.title); continue }
    ;(b.scored / b.assessableMax >= 0.5 ? g : y).push(b.title)
  }
  return { green: g, yellow: y, grey: s }
}
