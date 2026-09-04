import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// «Новый чат» (жалоба Ланы 04.09): история диалога живёт в localStorage и
// восстанавливалась при каждом заходе — начать с чистого листа было нельзя.
// Обе чат-страницы обязаны иметь сброс, чистящий И state, И свои ключи
// хранения (иначе диалог «воскресает» при следующем открытии).
describe('кнопка «Новый чат» на обеих чат-страницах', () => {
  it('быстрая генерация: сброс чистит state, localStorage и pending', () => {
    const src = readFileSync(`${process.cwd()}/app/(dashboard)/create/page.tsx`, 'utf8')
    expect(src).toContain('Новый чат')
    expect(src).toContain("localStorage.removeItem('ama_chat_create')")
    expect(src).toContain("clearPendingAnswer('ama_chat_create_pending')")
  })
  it('проектный ассистент: сброс чистит state, свой ключ, pending и genJob', () => {
    const src = readFileSync(`${process.cwd()}/app/(dashboard)/projects/[id]/assistant/page.tsx`, 'utf8')
    expect(src).toContain('Новый чат')
    expect(src).toContain('localStorage.removeItem(chatLsKey)')
    expect(src).toContain('clearPendingAnswer(pendingKey)')
    expect(src).toContain('clearGenJobId(pendingKey)')
  })
})
