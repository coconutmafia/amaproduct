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

// Свип 20.08 (мандат Матвея: «все в основном мобильные юзеры — не должно быть
// проблем»): 手писные <a download> запрещены ВЕЗДЕ, кроме единственного
// фолбэка внутри lib/utils/saveFile.ts. Текстовые скачивания идут через
// POST /api/download-text (top-level форма), бинарные — через saveBlobSmart
// (share-first). Новый код с blob-скачиванием мимо хелпера уронит этот тест.
describe('репо-широкий запрет ручных <a download> (кроме saveFile.ts)', () => {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name === '.git') continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, acc)
      else if (/\.(ts|tsx)$/.test(name)) acc.push(p)
    }
    return acc
  }
  it('присвоение .download = есть только в saveFile.ts', () => {
    const files = [...walk(join(process.cwd(), 'components')), ...walk(join(process.cwd(), 'app')), ...walk(join(process.cwd(), 'lib'))]
    const offenders: string[] = []
    for (const f of files) {
      if (f.endsWith('lib/utils/saveFile.ts')) continue
      const src = readFileSync(f, 'utf8')
      if (/\.download\s*=\s*/.test(src)) offenders.push(f)
    }
    expect(offenders, `Ручной <a download> глушится Telegram-webview/iOS-PWA — используй saveBlobSmart/downloadTextViaServer из lib/utils/saveFile.ts:\n${offenders.join('\n')}`).toEqual([])
  })
  it('download-text: только text/*-белый список, attachment, nosniff, лимит, auth', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/download-text/route.ts'), 'utf8')
    expect(src).toContain("'text/csv', 'text/markdown', 'text/plain'")
    expect(src).toContain("filename*=UTF-8''")
    expect(src).toContain('nosniff')
    expect(src).toContain('MAX_BYTES')
    expect(src).toContain('Unauthorized')
  })
  it('saveBlobSmart: share-first с фолбэком', () => {
    const src = readFileSync(join(process.cwd(), 'lib/utils/saveFile.ts'), 'utf8')
    expect(src).toContain('canShare')
    expect(src).toContain('AbortError')
  })
})
