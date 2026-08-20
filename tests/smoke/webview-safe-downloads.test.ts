import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// Инцидент 20.08 (Полина Назарова): «не могу посмотреть и скачать» карту
// смыслов с телефона, «с компа вообще не открывается». Сайт был открыт по
// ссылке из Telegram → встроенный браузер (WKWebView): blob + <a download>
// молча не скачивает, window.open ПОСЛЕ await молча блокируется (то же в
// iOS-PWA «на рабочем столе» и в настольном Safari с блокировкой попапов).
// Класс закрыт: просмотр = модалка в странице, скачивание = обычная навигация
// на серверный URL с Content-Disposition. Эти стражи держат класс закрытым.
// ─────────────────────────────────────────────────────────────────────────────

const knowledge = () => readFileSync(join(process.cwd(), 'components/projects/KnowledgePageClient.tsx'), 'utf8')
const downloadRoute = () => readFileSync(join(process.cwd(), 'app/api/materials/[id]/download/route.ts'), 'utf8')

describe('материалы: просмотр и скачивание живут без попапов и blob (20.08)', () => {
  it('страница материалов не использует window.open-хелпер и клиентскую сборку файлов', () => {
    const src = knowledge()
    expect(src).not.toContain('openMaterialInBrowser')
    expect(src).not.toContain('downloadXlsxBook')
    expect(src).not.toContain('downloadDocx')
  })

  it('скачивание — навигация на серверный /download', () => {
    const src = knowledge()
    expect(src).toMatch(/window\.location\.href = `\/api\/materials\/\$\{id\}\/download`/)
  })

  it('просмотр — модалка в странице (viewer), не новое окно', () => {
    const src = knowledge()
    expect(src).toContain('setViewer({ id, title, content })')
    expect(src).toMatch(/Dialog open=\{!!viewer\}/)
  })

  it('серверный download: attachment с кириллическим именем (RFC 5987) и все форматы', () => {
    const src = downloadRoute()
    expect(src).toContain("filename*=UTF-8''")
    expect(src).toContain("material_type === 'meanings_map'")
    expect(src).toContain("material_type === 'audience_research'")
    expect(src).toContain('wordprocessingml.document') // docx-фолбэк для текстовых
    expect(src).toContain('captureException')
  })

  it('книга кастдевов = эталон урока: «Касдевы» + «Карта смыслов» вторым листом', () => {
    const src = downloadRoute()
    expect(src).toContain("name: 'Касдевы'")
    expect(src).toContain("name: 'Карта смыслов'")
    expect(src).toContain('mergeRepeats: [0, 1]')
  })
})
