import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { briefSourceHash, stableLayerChars, assembleBriefInput, BRIEF_SYSTEM, BRIEF_KEEP_TYPES, BRIEF_MIN_LAYER_CHARS } from '@/lib/ai/projectBrief'

// «Память проекта» (07.09): бриф вместо 150+ тыс. токенов сырья в каждом
// сообщении чата. Стражи: хэш состояния реагирует на любое изменение
// материалов; вход генератора режет расшифровки первыми и поровну; промпт
// требует дословные цитаты и раздел «чего нет»; чат подменяет слой брифом
// только у больших проектов и ставит пересборку в очередь.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const proj = { name: 'Даша', niche: 'йога', description: null, content_language: null }
const idx = [
  { id: 'b', material_type: 'interview_transcript', title: 'Расшифровка', len: 20000, status: 'ready' },
  { id: 'a', material_type: 'audience_research', title: 'Таблица', len: 58000, status: 'ready' },
  { id: 'c', material_type: 'tone_of_voice', title: 'ToV', len: 4800, status: 'ready' },
]

describe('briefSourceHash / stableLayerChars', () => {
  it('хэш стабилен к порядку и меняется от любого изменения материала или проекта', () => {
    const h = briefSourceHash(proj, idx)
    expect(briefSourceHash(proj, [...idx].reverse())).toBe(h)
    expect(briefSourceHash(proj, idx.map(r => r.id === 'a' ? { ...r, len: 58001 } : r))).not.toBe(h)
    expect(briefSourceHash({ ...proj, niche: 'пилатес' }, idx)).not.toBe(h)
    expect(briefSourceHash(proj, idx.filter(r => r.id !== 'b'))).not.toBe(h)
    // материал в обработке/с ошибкой в хэш не входит (не дёргаем пересборку на полпути)
    expect(briefSourceHash(proj, [...idx, { id: 'd', material_type: 'other', title: 'x', len: 10, status: 'processing' }])).toBe(h)
  })
  it('объём слоя считается без расшифровок и с лимитами RAG', () => {
    expect(stableLayerChars(idx)).toBe(15000 + 4800) // таблица режется до 15k, расшифровка не в слое
    expect(BRIEF_MIN_LAYER_CHARS).toBeGreaterThan(30000)
  })
})

describe('вход генератора', () => {
  it('ядро целиком, расшифровки делят остаток поровну, мастер-таблица не дублируется', () => {
    const input = {
      project: { id: 'p', name: 'Даша', niche: 'йога', description: null },
      products: [{ name: 'Группа', product_type: 'подписка', price: 4900, currency: 'RUB', description: null }],
      materials: [
        { material_type: 'interview_transcript', title: 'К1', raw_content: 'x'.repeat(50000) },
        { material_type: 'interview_transcript', title: 'К2', raw_content: 'y'.repeat(50000) },
        { material_type: 'audience_research', title: 'Общая таблица кастдевов (все интервью)', raw_content: 'дубль'.repeat(1000) },
        { material_type: 'tone_of_voice', title: 'ToV', raw_content: 'голос '.repeat(100) },
      ],
    }
    const r = assembleBriefInput(input, 30000)
    expect(r.truncated).toBe(true)
    expect(r.text).not.toContain('Общая таблица кастдевов')
    expect(r.text).toContain('Группа (подписка) — 4900 RUB')
    const k1 = (r.text.match(/x/g) || []).length, k2 = (r.text.match(/y/g) || []).length
    expect(Math.abs(k1 - k2)).toBeLessThan(10) // поровну
    expect(r.text.length).toBeLessThanOrEqual(30000 + 2000)
  })
  it('промпт: только факты, цитаты дословно, раздел «чего нет», без markdown', () => {
    for (const s of ['ДОСЛОВНО', 'ЧЕГО В МАТЕРИАЛАХ НЕТ', 'БЕЗ markdown', 'Ничего не выдумывай', '40–80']) expect(BRIEF_SYSTEM).toContain(s)
  })
})

describe('чат подменяет слой памятью проекта', () => {
  it('контекст: бриф при свежем хэше, иначе пересборка в очередь; голос и линии блога остаются целиком', () => {
    const cc = read('lib/ai/chatContext.ts')
    expect(cc).toContain('getBriefState(admin, projectId, hash)')
    expect(cc, 'без таблицы (unavailable) пересборка не ставится').toContain("st.state === 'stale'")
    expect(cc, 'память проекта выключена по умолчанию (A/B №3 проигран)').toContain("process.env.PROJECT_BRIEF_ENABLED === '1'")
    expect(cc).toContain('ensureBriefJob(admin, projectId, userId, hash)')
    expect(cc).toContain('projectBrief: renderBriefSection(st.brief)')
    expect(cc).toContain('BRIEF_KEEP_TYPES.has(c.material_type)')
    expect([...BRIEF_KEEP_TYPES]).toEqual(expect.arrayContaining(['tone_of_voice', 'blog_lines']))
    const sys = read('lib/ai/prompts/system.ts')
    expect(sys).toContain('context.projectBrief')
    expect(sys).toContain('ПАМЯТЬ ПРОЕКТА')
  })
  it('джоб зарегистрирован в самолечении, миграция 049 есть, без таблицы — тихий фолбэк', () => {
    expect(read('app/api/jobs/[id]/route.ts')).toMatch(/project_brief:\s+processProjectBriefJob/)
    expect(read('supabase/migrations/049_project_briefs.sql')).toContain('create table if not exists project_briefs')
    const lib = read('lib/ai/projectBrief.ts')
    expect(lib).toContain("{ state: 'unavailable' }")
    expect(lib).toContain('BRIEF_JOB_DEBOUNCE_MS')
  })
})

describe('генератор: три параллельных прохода и сборка разделов', () => {
  it('splitSections режет ответ прохода по «N. ЗАГОЛОВОК», части покрывают все 9 разделов', async () => {
    const { splitSections, BRIEF_PARTS } = await import('@/lib/ai/projectBrief')
    const m = splitSections('1. ЭКСПЕРТ И ПРОЕКТ\nДаша, йога.\n\n2. ГОЛОС\n— «бережно»\n8. ФАКТЫ И ЦИФРЫ\n4900 ₽')
    expect([...m.keys()]).toEqual([1, 2, 8])
    expect(m.get(2)).toBe('— «бережно»')
    const covered = new Set(BRIEF_PARTS.flatMap(p => p.sections))
    expect([...covered].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    // аудитория и цитаты — из таблиц И расшифровок
    const aud = BRIEF_PARTS.find(p => p.sections.includes(4))!
    expect(aud.types).toEqual(expect.arrayContaining(['interview_transcript', 'audience_research', 'meanings_map']))
  })
})
