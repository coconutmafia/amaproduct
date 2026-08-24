// Недописанный ответ ассистента переживает выгрузку вкладки телефоном.
//
// История чата уже в localStorage (cbc8a4f), но СТРИМЯЩИЙСЯ ответ жил только
// в переменной: телефон выгрузил вкладку на середине длинного ответа («5
// рилзов» ≈ минуты) — вопрос остался, ответ исчез, юнит потрачен. Теперь
// накопленный текст пишется сюда (топорный троттлинг ~700мс, чтобы не дёргать
// синхронный localStorage на каждом чанке), при возврате страница доклеивает
// его в диалог с честной пометкой об обрыве.

const lastWrite = new Map<string, number>()

export function savePendingAnswer(key: string, text: string): void {
  try {
    const now = Date.now()
    if (now - (lastWrite.get(key) ?? 0) < 700) return
    lastWrite.set(key, now)
    localStorage.setItem(key, text)
  } catch { /* квота/приватный режим — не мешаем чату */ }
}

export function clearPendingAnswer(key: string): void {
  lastWrite.delete(key)
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

/** Забрать оборванный ответ (и сразу удалить, чтобы не доклеился дважды). */
export function takePendingAnswer(key: string): string | null {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) localStorage.removeItem(key)
    return v && v.trim() ? v : null
  } catch { return null }
}

export const PENDING_CUT_NOTE =
  '\n\n⚠️ Ответ оборвался — вкладка закрылась во время генерации. Напиши «продолжи», если нужно продолжение.'

// ── Почтовый ящик метеренной генерации (24.08) ───────────────────────────────
// Для «Сгенерировать пост/рилз…» (genFormat, списывает юнит) сервер заводит
// строку в jobs и отдаёт её id заголовком X-Gen-Job, а ГОТОВЫЙ текст дописывает
// туда по завершении — замерено: инвокация переживает смерть вкладки и
// достримливает. Клиент хранит id рядом с pending-текстом и при возврате
// забирает ПОЛНЫЙ ответ вместо огрызка (юнит куплен не зря).

export function saveGenJobId(pendingKey: string, jobId: string): void {
  try { localStorage.setItem(`${pendingKey}_job`, jobId) } catch { /* ignore */ }
}

export function clearGenJobId(pendingKey: string): void {
  try { localStorage.removeItem(`${pendingKey}_job`) } catch { /* ignore */ }
}

export function takeGenJobId(pendingKey: string): string | null {
  try {
    const v = localStorage.getItem(`${pendingKey}_job`)
    if (v !== null) localStorage.removeItem(`${pendingKey}_job`)
    return v || null
  } catch { return null }
}

/**
 * Забрать из ящика ПОЛНЫЙ текст генерации (если сервер успел дописать).
 * Несколько коротких попыток: на возврате юзера генерация либо давно готова,
 * либо вот-вот доедет (сервер жив без клиента). null — ящик пуст/недоступен.
 */
export async function fetchMailboxAnswer(
  jobId: string,
  { attempts = 6, delayMs = 5000 }: { attempts?: number; delayMs?: number } = {},
): Promise<{ text: string; complete: boolean } | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (res.status === 404) return null
      if (res.ok) {
        const body = await res.json() as { job?: { status?: string; result?: { text?: string; complete?: boolean } | null } }
        const job = body.job
        if (job?.status === 'done' && job.result?.text) {
          return { text: job.result.text, complete: job.result.complete !== false }
        }
        if (job?.status === 'error') return null
        // processing — сервер ещё дописывает, подождём
      }
    } catch { /* сеть моргнула — попробуем ещё */ }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  return null
}
