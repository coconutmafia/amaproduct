import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeNextPath, withNext } from '@/lib/authNext'

// Стражи воронки Августы (29.08): бесплатная экспресс-диагностика блога для
// ЛЮБОГО зарегистрированного (в т.ч. без подписки), в конце — запись к Августе;
// всё остальное — только по тарифу (requirePaidAccess на каждом платном роуте).
// Раздаётся прямой ссылкой amaproduct.com/blog-audit: незалогиненный проходит
// регистрацию и ВОЗВРАЩАЕТСЯ на диагностику (?next= сквозь все пути входа).

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('safeNextPath: только внутренние пути (не open redirect)', () => {
  it('внутренний путь проходит', () => {
    expect(safeNextPath('/blog-audit')).toBe('/blog-audit')
    expect(safeNextPath('/blog-audit?x=1')).toBe('/blog-audit?x=1')
  })
  it('внешние и кривые адреса падают в дашборд', () => {
    expect(safeNextPath('https://evil.com')).toBe('/dashboard')
    expect(safeNextPath('//evil.com')).toBe('/dashboard')
    expect(safeNextPath('/a://b')).toBe('/dashboard')
    expect(safeNextPath('/a\\evil')).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath('evil')).toBe('/dashboard')
  })
  it('withNext не тащит дефолт и корректно клеит query', () => {
    expect(withNext('/register', '/dashboard')).toBe('/register')
    expect(withNext('/register', '/blog-audit')).toBe('/register?next=%2Fblog-audit')
    expect(withNext('/auth/callback?ref=X', '/blog-audit')).toBe('/auth/callback?ref=X&next=%2Fblog-audit')
  })
})

describe('?next= проносится через все пути входа', () => {
  it('middleware: /blog-audit защищён и редирект несёт next', () => {
    const proxy = read('proxy.ts')
    expect(proxy).toContain("'/blog-audit'")
    expect(proxy).toContain("loginUrl.searchParams.set('next'")
  })
  it('логин: пароль, Google и ссылка на регистрацию уважают next', () => {
    const login = read('app/(auth)/login/page.tsx')
    expect(login).toContain('router.push(nextPath)')
    expect(login).toMatch(/auth\/callback\?next=\$\{encodeURIComponent\(nextPath\)\}/)
    expect(login).toContain("withNext('/register', nextPath)")
  })
  it('регистрация: письмо, код из письма, Google и ссылка на логин уважают next', () => {
    const reg = read('app/(auth)/register/page.tsx')
    expect(reg).toContain("withNext('/auth/callback', nextPath)")
    expect(reg).toContain('router.push(nextPath)')
    expect(reg).toContain("cb.searchParams.set('next', nextPath)")
    expect(reg).toContain("withNext('/login', nextPath)")
  })
  it('колбэк валидирует next через safeNextPath', () => {
    const cb = read('app/auth/callback/route.ts')
    expect(cb).toContain('safeNextPath(searchParams.get')
  })
})

describe('контракт бесплатной диагностики (лид-магнит — НЕ «дыра»)', () => {
  // Будущий свип «у роута нет requirePaidAccess» не должен закрыть воронку:
  // standalone-аудит бесплатен ОСОЗНАННО (решение 25.08, воронка Августы 29.08).
  it('standalone-аудит не требует подписку и не списывает юниты', () => {
    const r = read('app/api/blog-audit/standalone/route.ts')
    expect(r).not.toContain('requirePaidAccess')
    expect(r).not.toContain('gateContentUnit')
    expect(r).not.toContain('gateMicroAction')
  })
  it('но авторизацию и rate-limit держит (анти-абьюз)', () => {
    const r = read('app/api/blog-audit/standalone/route.ts')
    expect(r).toContain('Unauthorized')
    expect(r).toMatch(/rateLimit\(user\.id, 'blog-audit-standalone'\)/)
  })
  it('CTA записи к Августе живёт в скоркарде и настраивается env', () => {
    const d = read('components/projects/BlogAuditDialog.tsx')
    expect(d).toContain('NEXT_PUBLIC_CONSULT_TELEGRAM')
    expect(d).toContain('Записаться на бесплатную консультацию')
  })
  it('standalone-экран показывает тот же скоркард (с CTA)', () => {
    const s = read('components/blogAudit/StandaloneBlogAudit.tsx')
    expect(s).toContain('BlogAuditScorecard')
  })
})
