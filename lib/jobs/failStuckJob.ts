import type { SupabaseClient } from '@supabase/supabase-js'
import { refundGenerations } from '@/lib/generations'
import { VIDEO_MONTAGE_UNITS } from '@/lib/generations-config'

// Финальное закрытие ЗАСТРЯВШЕГО джоба (инвокация потерялась, рестарты не
// помогли) — с учётом типа:
//   • montage: юниты списаны в роуте ДО джоба — при закрытии их ОБЯЗАНЫ
//     вернуть (иначе клиент заплатил за несуществующее видео), исходник
//     подчищаем;
//   • transcribe: файл НЕ трогаем — «Повторить» может продолжить с места
//     обрыва (чистка через 48ч в chain-watch);
//   • остальные one-shot: просто честная ошибка.
// Используется в GET /api/jobs/[id] (рестарты исчерпаны) и chain-watch (>24ч).
export interface StuckJobRow {
  id: string
  type: string
  user_id?: string | null
  payload?: Record<string, unknown> | null
}

export function stuckJobMessage(type: string): string {
  if (type === 'transcribe') {
    return 'Обработка прервалась на сервере — это на нашей стороне. Нажми «Повторить» — продолжу с места обрыва.'
  }
  if (type === 'montage') {
    return 'Монтаж прервался на сервере — это на нашей стороне. Единицы контента возвращены, запусти монтаж ещё раз.'
  }
  return 'Обработка прервалась на сервере — это на нашей стороне. Запусти ещё раз; если повторится, напиши нам.'
}

/** Пост-обработка типа при финальном закрытии: возвраты и уборка. */
export async function settleStuckJob(admin: SupabaseClient, job: StuckJobRow): Promise<void> {
  if (job.type === 'montage') {
    if (job.user_id) await refundGenerations(job.user_id, VIDEO_MONTAGE_UNITS).catch(() => {})
    const storagePath = (job.payload as { storagePath?: string } | null)?.storagePath
    if (storagePath) await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
  }
  // transcribe: файл нарочно остаётся (окно «Повторить»); чистка — chain-watch 48ч.
}
