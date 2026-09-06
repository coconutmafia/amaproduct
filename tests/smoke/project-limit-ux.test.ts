import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectLimitFor, projectLimitMessage, isProjectLimitError } from '@/lib/projects/limit'

// Полина Шедько (Соло, 06.09): «уже в который раз берусь заполнить все данные
// по проекту — выдаёт ошибку». Триггер базы отбивал ВТОРОЙ проект на Соло
// (лимит 1), а мастер показывал «Упс, ошибка сервиса — это на нашей стороне».
// Стражи: лимит в UI = лимит в SQL; мастер объясняет лимит и до, и после.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('лимит проектов: UI зеркалит миграцию 035', () => {
  it('числа совпадают с project_limit() в SQL', () => {
    const sql = read('supabase/migrations/035_enforce_project_limit.sql')
    for (const m of sql.matchAll(/when '([a-z]+)'\s+then (\d+)/g)) {
      expect(projectLimitFor(m[1]), m[1]).toBe(Number(m[2]))
    }
    expect(projectLimitFor('solo')).toBe(1)
    expect(projectLimitFor(undefined)).toBe(3)
  })
  it('сообщение называет тариф, лимит и путь дальше', () => {
    const m = projectLimitMessage('solo', 1)
    expect(m).toContain('«Соло»')
    expect(m).toContain('1 проект')
    expect(m).toContain('«Про»')
    expect(projectLimitMessage('pro', 3)).toContain('«Продюсер»')
    expect(isProjectLimitError('new row violates: project_limit_reached: 1 of 1')).toBe(true)
    expect(isProjectLimitError('row-level security')).toBe(false)
  })
})

describe('мастер проекта и список: лимит объясняется, а не прячется за «ошибкой сервиса»', () => {
  it('мастер: баннер до заполнения, специальный тост после отказа базы', () => {
    const w = read('components/projects/ProjectWizard.tsx')
    expect(w).toContain('isProjectLimitError(msg)')
    expect(w).toContain('projectLimitMessage(')
    expect(w).toContain("label: 'Тарифы'")
    expect(w).toContain('atLimit && limitInfo')
    // общий текст остался только для настоящих технических ошибок
    expect(w.split('Упс, ошибка сервиса').length - 1).toBe(1)
  })
  it('список проектов показывает лимит тарифа', () => {
    const p = read('app/(dashboard)/projects/page.tsx')
    expect(p).toContain('projectLimitFor(tier)')
    expect(p).toContain('atLimit &&')
  })
})
