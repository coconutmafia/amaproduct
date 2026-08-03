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
