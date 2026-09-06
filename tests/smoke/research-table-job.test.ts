import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dedupeParts, isUsablePart, planBatches, BATCH_MAX_CHARS, BATCH_MAX_PARTS } from '@/lib/research/parts'
import { uniqueQuestions, questionsOf } from '@/lib/research/table1'
import { continueUrl } from '@/lib/jobs/continueLeg'

// Инцидент Стаси Кожемяко 04–05.09 («Анализирую часть 3 из 4» висело со
// вчерашнего дня). По журналу: батчи 1–2 прошли за 4 минуты, батч 3 стартовал
// на следующее утро — self-fetch продолжения ни разу не сработал за всю жизнь
// цепочки (ноль строк ai_usage с роутом api/jobs/continue). Плюс дубли записей
// (одна залита 4 раза), обрывки «you», пустой батч валил весь джоб.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const P = (name: string, text: string) => ({ name, text })
const lorem = (n: number) => 'слово '.repeat(Math.ceil(n / 6)).slice(0, n)

describe('подготовка расшифровок (lib/research/parts)', () => {
  it('точный дубль и повторная расшифровка той же записи (≤3% длины) — один участник', () => {
    const a = lorem(3738)
    const b = lorem(16331)
    const b2 = b.slice(0, 16291) // «Дина» второй раз: то же начало, длина −40 знаков
    const { parts, dropped } = dedupeParts([P('1', a), P('2', a), P('3', a), P('4', b), P('5', b2), P('6', lorem(500) + ' другой текст')])
    expect(parts.map(p => p.name)).toEqual(['1', '4', '6'])
    expect(dropped).toBe(3)
  })
  it('разные записи с похожим началом, но другой длиной — не дубли', () => {
    const base = 'Привет, как дела? Смотри, я буду задавать вопросы. '.repeat(10)
    const { parts } = dedupeParts([P('a', base + lorem(2000)), P('b', base + lorem(9000))])
    expect(parts).toHaveLength(2)
  })
  it('обрывок «you» не годится, нормальный текст годится', () => {
    expect(isUsablePart(P('x', 'you'))).toBe(false)
    expect(isUsablePart(P('x', ''))).toBe(false)
    expect(isUsablePart(P('x', 'Меня зовут Вика, мне двадцать лет, я танцую афро три года подряд'))).toBe(true)
  })
  it('план батчей: не больше 3 частей и 40 тыс. знаков, крупная часть — отдельно', () => {
    const sizes = [10405, 13090, 20831, 16331, 6054, 11950, 16291, 5778, 8216, 1375, 45000]
    const batches = planBatches(sizes.map((n, i) => P(String(i), lorem(n))))
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(BATCH_MAX_PARTS)
      const chars = b.reduce((s, p) => s + p.text.length, 0)
      if (b.length > 1) expect(chars).toBeLessThanOrEqual(BATCH_MAX_CHARS)
    }
    expect(batches.flat().length).toBe(sizes.length)
    expect(batches[batches.length - 1]).toHaveLength(1) // 45 тыс. — сам по себе
    expect(batches[0].map(p => p.text.length)).toEqual([10405, 13090]) // +20831 не влезло бы в 40k
  })
})

describe('канон вопросов между батчами', () => {
  it('uniqueQuestions: пунктуация/регистр не плодят варианты, порядок первого появления', () => {
    expect(uniqueQuestions(['Расскажи о себе?', 'расскажи о себе', 'Что мешает', ''])).toEqual(['Расскажи о себе?', 'Что мешает'])
  })
  it('questionsOf собирает вопросы участников', () => {
    const qs = questionsOf([
      { id: '1', name: 'А', segment: '', answers: [{ question: 'В1', block: 'other', full_answer: 'x', key_quotes: [], emotional_tone: '' }] },
      { id: '2', name: 'Б', segment: '', answers: [{ question: 'В1', block: 'other', full_answer: 'y', key_quotes: [], emotional_tone: '' }, { question: 'В2', block: 'other', full_answer: 'z', key_quotes: [], emotional_tone: '' }] },
    ])
    expect(qs).toEqual(['В1', 'В2'])
  })
})

describe('передача ноги (lib/jobs/continueLeg)', () => {
  const saved = { ...process.env }
  afterEach(() => { for (const k of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL', 'VERCEL_ENV', 'VERCEL_URL']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  it('адрес: канонический домен приложения, не защищённый деплой-URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://amaproduct.com/'
    process.env.VERCEL_URL = 'ama-abc123-team.vercel.app'
    expect(continueUrl()).toBe('https://amaproduct.com/api/jobs/continue')
    delete process.env.NEXT_PUBLIC_APP_URL; delete process.env.NEXT_PUBLIC_SITE_URL
    process.env.VERCEL_ENV = 'production'
    expect(continueUrl()).toBe('https://amaproduct.com/api/jobs/continue')
    process.env.VERCEL_ENV = 'preview'
    expect(continueUrl()).toBe('https://ama-abc123-team.vercel.app/api/jobs/continue')
    // Пробник 06.09 на проде: env без схемы → «Failed to parse URL» → нога
    // доехала только через поллер. Схема дописывается.
    process.env.NEXT_PUBLIC_APP_URL = 'amaproduct.com'
    expect(continueUrl()).toBe('https://amaproduct.com/api/jobs/continue')
    process.env.NEXT_PUBLIC_APP_URL = 'localhost:3000'
    expect(continueUrl()).toBe('http://localhost:3000/api/jobs/continue')
  })

  it('не-2xx ответ продолжения — событие, а не тишина; статус queued + legEnded + токен', () => {
    const src = read('lib/jobs/continueLeg.ts')
    expect(src).toContain("status: 'queued'")
    expect(src).toContain('legEnded: true')
    expect(src).toContain('continueToken: token')
    expect(src).toContain("'X-Job-Token': token")
    expect(src).toMatch(/if \(!res\.ok\)[\s\S]{0,200}captureMessage/)
    expect(src, 'захват ноги — оптимистическая блокировка по updated_at').toMatch(/claimJobLeg[\s\S]*eq\('updated_at', row\.updated_at\)/)
  })

  it('роут continue принимает токен ноги (не только CRON_SECRET) и знает оба типа', () => {
    const src = read('app/api/jobs/continue/route.ts')
    expect(src).toContain('x-job-token')
    expect(src).toContain('timingSafeEqual')
    expect(src).toMatch(/transcribe:\s+processTranscribeJob/)
    expect(src).toMatch(/research_table1:\s+processResearchTableJob/)
  })

  it('поллер GET /api/jobs/[id] сам запускает ногу по legEnded (второй путь)', () => {
    const src = read('app/api/jobs/[id]/route.ts')
    expect(src).toContain("legProgress.legEnded === true")
    expect(src).toMatch(/dispatchedAt: Date\.now\(\)[\s\S]{0,120}eq\('updated_at', job\.updated_at/)
    expect(src, 'тяжёлый progress.done не возится клиенту').toContain("'done' in pr")
  })

  it('оба ножных раннера: захват ноги + общая передача, без своего continueUrl/after', () => {
    for (const f of ['lib/jobs/runResearchTableJob.ts', 'lib/jobs/runTranscribeJob.ts']) {
      const src = read(f)
      expect(src, f).toContain('claimJobLeg(admin, row)')
      expect(src, f).toContain('endLegAndContinue(')
      expect(src, f).not.toContain('function continueUrl')
      expect(src, f).not.toMatch(/from 'next\/server'/)
      expect(src, `${f}: leg/restarts переносятся между записями прогресса`).toContain('...carry')
    }
  })
})

describe('раннер таблицы: параллельные волны, пустой батч ≠ ошибка, возвраты', () => {
  const src = read('lib/jobs/runResearchTableJob.ts')
  it('батчи волны идут параллельно, канон-батч задаёт вопросы остальным', () => {
    expect(src).toMatch(/Promise\.all\(wave\.map\(bi => runOne\(bi, questions\)\)\)/)
    expect(src).toMatch(/CONCURRENCY = [3-9]/)
    expect(src).toContain('questionsOf(r.table.respondents)')
  })
  it('пустой батч пропускается; ошибка «не нашёл участников» — только если пусты ВСЕ', () => {
    expect(src).toMatch(/const respondents = batches\.flatMap[\s\S]{0,80}if \(respondents\.length === 0\) \{ await fail\(NO_RESPONDENTS_MESSAGE\)/)
    // внутри волны пустой результат — это ok:true и просто пустой список
    expect(src).not.toContain("respondents.length === 0) {\n        await captureException")
  })
  it('прогресс по батчам переживает смерть инвокации (done[i]), дубли/обрывки режутся и в раннере', () => {
    expect(src).toContain("done[String(wave[j])] = r.table.respondents")
    expect(src).toContain('dedupeParts(rawParts.filter(isUsablePart))')
  })
  it('роут режет дубли/обрывки ДО списания единиц', () => {
    const route = read('app/api/jobs/research-table/route.ts')
    expect(route.indexOf('dedupeParts(')).toBeGreaterThan(0)
    expect(route.indexOf('dedupeParts(')).toBeLessThan(route.indexOf('gateContentUnits('))
    expect(route).toContain('parts: uniqueParts')
  })
  it('застрявшая навсегда таблица возвращает единицы', () => {
    const stuck = read('lib/jobs/failStuckJob.ts')
    expect(stuck).toContain("job.type === 'research_table1'")
    expect(stuck).toContain('UNIT_COSTS.research_table')
    expect(stuck).toMatch(/type === 'research_table1'[\s\S]{0,120}Единицы контента возвращены/)
  })
  it('клиент: поллит queued и processing, час вместо вечного спиннера, честный текст про закрытие страницы', () => {
    const page = read('app/(dashboard)/projects/[id]/research/page.tsx')
    expect(page).toContain("(job.status === 'processing' || job.status === 'queued')")
    expect(page).toContain('startedAt + 60 * 60_000')
    expect(page).toContain('Можно закрыть страницу — анализ идёт на сервере')
    expect(page).not.toContain('не закрывай страницу</p>')
    expect(page).toContain('Готово ${analysisBatch.current} из ${analysisBatch.total} частей')
  })
})
