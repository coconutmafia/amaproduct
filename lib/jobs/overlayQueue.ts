// Очередь тяжёлых видео-джобов (09.09).
//
// ЗАМЕР на проде: Светлана собрала серию с 5 видео-кадрами, клиент стартовал
// все 5 overlay-джобов подряд (09:01:48…09:02:03). Каждый запускает ffmpeg в
// своей инвокации: 2 из 5 закончились за 38 и 88 секунд, остальные встали и
// доехали ТОЛЬКО через самолечение на 10-й минуте — 644–701 секунда вместо
// ~70. Второй заход в 09:16 повторил картину: 7 записей «job self-heal:
// перезапуск video_overlay» в журнале за 15 минут.
//
// Причина не в коде джоба (после рестарта тот же джоб укладывается в ~70 с), а
// в одновременности: несколько ffmpeg на одном инстансе душат друг друга.
// Поэтому больше двух сразу не запускаем: лишние ждут в 'queued' и стартуют,
// когда поллер клиента увидит свободный слот. Клиент ждёт очередь вместо
// десятиминутного простоя, а если вкладку закрыли — как и раньше подхватит
// самолечение.
import type { createAdminClient } from '@/lib/supabase/admin'

export const MAX_PARALLEL_OVERLAY = 2
/** Джоб старше этого окна считается мёртвым и слот не занимает (= STALE_MS поллера). */
const ALIVE_MS = 10 * 60 * 1000

/** Свободен ли слот на тяжёлую обработку у ЭТОГО пользователя. */
export async function overlaySlotFree(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  type = 'video_overlay',
): Promise<boolean> {
  try {
    const { data } = await admin
      .from('jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('type', type)
      .eq('status', 'processing')
      .gte('updated_at', new Date(Date.now() - ALIVE_MS).toISOString())
      .limit(MAX_PARALLEL_OVERLAY)
    return (data?.length ?? 0) < MAX_PARALLEL_OVERLAY
  } catch {
    return true // не смогли посчитать — ведём себя как раньше (запускаем)
  }
}

/** Джоб ждёт своей очереди (поставлен, но намеренно не запущен). */
export function isWaitingInQueue(status: unknown, progress: unknown): boolean {
  const p = (progress ?? {}) as Record<string, unknown>
  return status === 'queued' && p.queued === true
}
