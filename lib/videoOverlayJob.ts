'use client'

// Клиентский хелпер наложения текста на видео ЧЕРЕЗ ФОНОВЫЙ ДЖОБ.
// Замена синхронного fetch('/api/video/overlay') на 1-3 минуты, который не
// переживал сворачивание вкладки телефоном (обрыв соединения = «ошибка» при
// живом сервере и списанном юните). Джоб доделывается на сервере; поллинг
// возобновляется, когда вкладка просыпается (pollJob).
import { pollJob } from '@/lib/jobs/pollJob'

export class OverlayPaymentRequired extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export interface OverlayParams {
  projectId: string
  videoPath: string
  text: string
  position?: string
  plate?: boolean
  keepSource?: boolean
}

/** Стартовать джоб наложения. Бросает OverlayPaymentRequired на 402. */
export async function startOverlayJob(params: OverlayParams): Promise<string> {
  const res = await fetch('/api/jobs/video-overlay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (res.status === 402) {
    const d = await res.json().catch(() => ({} as { code?: string }))
    throw new OverlayPaymentRequired(d.code === 'payment_required' ? 'needs_plan' : 'limit')
  }
  const d = await res.json().catch(() => ({} as { jobId?: string; error?: string }))
  if (!res.ok || !d.jobId) throw new Error(d.error || 'Не удалось запустить обработку видео')
  return d.jobId
}

/** Дождаться готового ролика по джобу. */
export async function awaitOverlayJob(jobId: string): Promise<string> {
  const result = await pollJob<{ url?: string }>(jobId)
  if (!result?.url) throw new Error('Обработка видео не вернула результат — попробуй ещё раз')
  return result.url
}

/** Старт + ожидание одним вызовом (одиночные сценарии). */
export async function runOverlayJob(params: OverlayParams): Promise<string> {
  const jobId = await startOverlayJob(params)
  return awaitOverlayJob(jobId)
}
