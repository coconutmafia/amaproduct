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
    expect(d).toContain("import { CONSULT_URL } from '@/lib/consult'")
    expect(d).toContain('Записаться на бесплатную консультацию')
  })
  it('standalone-экран показывает тот же скоркард (с CTA)', () => {
    const s = read('components/blogAudit/StandaloneBlogAudit.tsx')
    expect(s).toContain('BlogAuditScorecard')
  })
})

describe('воронка диагностики v2 (спека ассистентки 29.08)', () => {
  it('лендинг: оффер диагностики + CTA «Пройти диагностику» → /blog-audit', () => {
    const l = read('components/landing/LandingPage.tsx')
    expect(l).toContain('бесплатную диагностику')
    expect(l).toContain('Пройти диагностику')
    expect(l).toContain('href="/blog-audit"')
    expect(l).toContain('DiagnosticPathSection')
  })
  it('консультация НЕ предлагается до отчёта: автопопапа нет, действия ВНИЗУ отчёта', () => {
    const s = read('components/blogAudit/StandaloneBlogAudit.tsx')
    expect(s).not.toContain('setConsultOpen')
    expect(s).toContain('Для тех, кто готов действовать👇🏼')
    expect(s).toContain('Забронировать место')
    // второй CTA — тарифы AI-SMMщика
    expect(s).toContain('Хочешь попробовать пользоваться AI-SMMщиком?')
    expect(s).toContain('Попробовать')
    expect(s).toContain('href="/pricing"')
    // встроенный CTA скоркарда скрыт — не конкурирует с двумя действиями
    expect(s).toContain('hideCta')
  })
  it('форма заявки: имя/Telegram/Instagram, бота не используем, текст успеха точный', () => {
    const s = read('components/blogAudit/StandaloneBlogAudit.tsx')
    expect(s).toContain("fetch('/api/diagnostic-lead'")
    expect(s).toContain('Маркетолог команды Августа свяжется с вами в Telegram.')
    const api = read('app/api/diagnostic-lead/route.ts')
    expect(api).toContain("rateLimit(user.id, 'diagnostic-lead')")
    expect(api).toContain("source: 'diagnostic'")
    // заявка сохраняется ВСЕГДА; Telegram/amoCRM — best-effort в after() за env
    expect(api).toContain('TG_LEADS_BOT_TOKEN')
    expect(api).toContain('AMOCRM_WEBHOOK_URL')
    expect(api).toContain('Заявка с диагностики')
  })
  it('CTA проектного аудита не тронут (hideCta только для воронки)', () => {
    const d = read('components/projects/BlogAuditDialog.tsx')
    expect(d).toContain('Записаться на бесплатную консультацию')
    expect(d).toContain('{!hideCta && (')
  })
})

describe('amoCRM-адаптер (долгосрочный токен, вкл. через env)', () => {
  it('роут заявки: API-путь основной, вебхук — запасной', () => {
    const api = read('app/api/diagnostic-lead/route.ts')
    expect(api).toContain('amoConfigured()')
    expect(api).toContain('sendLeadToAmo(')
    expect(api).toContain('AMOCRM_WEBHOOK_URL')
  })
  it('payload: тег «Заявка с диагностики», контакт с email, примечание с TG/IG', async () => {
    const { buildAmoLeadPayload, buildAmoNoteText } = await import('../../lib/leads/amocrm')
    const lead = { name: 'Аня', telegram: 'anya', instagram: 'anya_ig', email: 'a@b.c' }
    const p = buildAmoLeadPayload(lead, 7, 9)
    expect(p[0].name).toBe('Заявка с диагностики — Аня')
    expect(p[0].pipeline_id).toBe(7)
    expect(p[0].status_id).toBe(9)
    expect(p[0]._embedded.tags[0].name).toBe('Заявка с диагностики')
    expect(JSON.stringify(p[0]._embedded.contacts[0])).toContain('a@b.c')
    const note = buildAmoNoteText(lead)
    expect(note).toContain('@anya')
    expect(note).toContain('@anya_ig')
  })
})

describe('гигиена env amoCRM (кейс «•» в токене, 31.08)', () => {
  it('токен с не-ASCII символом даёт человеческую ошибку, а не криптичный ByteString', async () => {
    const { amoTokenProblem } = await import('../../lib/leads/amocrm')
    process.env.AMOCRM_TOKEN = 'eyJ0eXAiO•••'
    expect(amoTokenProblem()).toContain('недопустимый символ')
    process.env.AMOCRM_TOKEN = 'eyJ0eXAiOiJKV1Qi.normal-token_123'
    expect(amoTokenProblem()).toBeNull()
    delete process.env.AMOCRM_TOKEN
  })
  it('значения env чистятся от пробелов, битый токен не даёт слать запрос', () => {
    const src = read('lib/leads/amocrm.ts')
    expect(src).toContain('cleanEnv(process.env.AMOCRM_TOKEN)')
    expect(src).toContain('amoTokenProblem()')
  })
})
