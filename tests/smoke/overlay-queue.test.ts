import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAX_PARALLEL_OVERLAY, isWaitingInQueue } from '@/lib/jobs/overlayQueue'

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

// Замер 08.09 (Светлана, 10 видео-кадров): при 5 одновременных overlay-джобах
// 2 заканчивались за 38–88 с, а 3 вставали и доезжали только самолечением на
// 10-й минуте (644–701 с). 7 записей «job self-heal: перезапуск video_overlay»
// в журнале за 15 минут — это был не сбой, а перегрузка одновременностью.
describe('очередь тяжёлых видео-джобов', () => {
  it('одновременно не больше двух', () => {
    expect(MAX_PARALLEL_OVERLAY).toBe(2)
  })
  it('ожидающий в очереди распознаётся по статусу и флагу', () => {
    expect(isWaitingInQueue('queued', { queued: true })).toBe(true)
    expect(isWaitingInQueue('queued', { queued: false })).toBe(false)
    expect(isWaitingInQueue('processing', { queued: true })).toBe(false)
    expect(isWaitingInQueue('queued', null)).toBe(false)
    expect(isWaitingInQueue('queued', { legEnded: true })).toBe(false) // это другая механика
  })
  it('роут: при занятых слотах джоб ставится в очередь, а не запускается', () => {
    const r = read('app/api/jobs/video-overlay/route.ts')
    expect(r).toContain('await overlaySlotFree(admin, user.id)')
    expect(r).toContain("progress: { queued: true, stage: 'queue' }")
    // юнит по-прежнему списывается на старте, а не при запуске обработки
    expect(r.indexOf('gateContentUnit')).toBeLessThan(r.indexOf('overlaySlotFree'))
  })
  it('поллер: подхватывает очередь и НЕ считает ожидающего застрявшим', () => {
    const p = read('app/api/jobs/[id]/route.ts')
    expect(p).toContain('isWaitingInQueue(job.status, job.progress) && RUNNERS[job.type as string]')
    expect(p).toContain("queued: false, stage: 'start'")
    // оптимистическая блокировка — стартует один поллер из N
    expect(p).toMatch(/queued: false[\s\S]{0,200}\.eq\('updated_at', job\.updated_at as string\)/)
    expect(p).toContain('!isWaitingInQueue(job.status, job.progress) &&\n    (job.status ===')
  })
})

describe('сторож не бьёт ложную тревогу и лечит зависшие материалы', () => {
  it('«credit balance» не считает собственные предупреждения chain-watch', () => {
    const c = read('app/api/cron/chain-watch/route.ts')
    expect(c).toContain(".eq('level', 'error')")
    expect(c).toContain(".not('message', 'ilike', 'chain-watch%')")
  })
  it('материал в processing >1ч переводится в error с подсказкой', () => {
    const c = read('app/api/cron/chain-watch/route.ts')
    expect(c).toContain("processing_status: 'error'")
    expect(c).toContain('Нажми «Обновить карту из исследования» ещё раз')
    expect(c).toContain("select('id, title, material_type")
  })
})
