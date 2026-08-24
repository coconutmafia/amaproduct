import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Страж класса «долгий запрос умирает на мобиле» (мандат Матвея 24.08).
// Юзеры работают с телефонов (Telegram-webview, PWA): любой долгий живой
// запрос из браузера рвётся сетью/блокировкой экрана. Правило класса:
// долгая операция = фоновый джоб (jobs) или after()+статус в артефакте,
// клиент поллит, id джоба ложится в черновик СРАЗУ.
//
// Найдено 24.08 (вечер): research_table1 создавался роутом, но ОТСУТСТВОВАЛ
// в карте RUNNERS самолечения GET /api/jobs/[id] — потерянная инвокация
// уходила в error («запусти ещё раз») вместо рестарта, хотя раннер резюмится
// с progress.doneBatches. Этот файл не даёт классу расползтись снова.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ── 1. Каждый тип джоба, который создаёт приложение, знает самолечение ───────
function collectTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      out.push(...collectTs(p))
    } else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('фоновые джобы: каждый создаваемый тип зарегистрирован в самолечении', () => {
  const sources = [...collectTs(join(ROOT, 'app')), ...collectTs(join(ROOT, 'lib'))]
  const createdTypes = new Set<string>()
  for (const p of sources) {
    const src = readFileSync(p, 'utf8')
    // Только литерал type: '…' ВНУТРИ .from('jobs').insert({…}) — не любые
    // упоминания type в файле (materials/route.ts тоже пишет type:)
    for (const m of src.matchAll(/\.from\('jobs'\)\s*\.insert\(\{[\s\S]{0,400}?type:\s*'([a-z0-9_]+)'/g)) {
      createdTypes.add(m[1])
    }
  }
  const runnersSrc = read('app/api/jobs/[id]/route.ts')

  it('нашёл созданные типы джобов', () => {
    expect(createdTypes.size).toBeGreaterThanOrEqual(9)
  })

  for (const type of [...createdTypes].sort()) {
    it(`тип '${type}' есть в RUNNERS (иначе застрявший джоб не перезапустится)`, () => {
      expect(runnersSrc).toMatch(new RegExp(`^\\s*${type}:\\s*process`, 'm'))
    })
  }
})

// ── 2. Раннеры не пишут сырой err.message в job.error ────────────────────────
// job.error читает клиент (граница доверия, см. error-text-hygiene и
// no-raw-api-errors.test.ts для роутов): хвосты провайдера («credit balance…»)
// не должны доезжать до людей.
describe('lib/jobs: job.error — только готовый русский текст, не err.message', () => {
  const RAW = /error:\s*(?:\w+\s+instanceof\s+Error\s*\?\s*)?(?:e|err|error)\??\.message/
  for (const p of collectTs(join(ROOT, 'lib', 'jobs'))) {
    it(p.replace(ROOT, ''), () => {
      const offenders = readFileSync(p, 'utf8').split('\n')
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => RAW.test(l) && !l.trim().startsWith('//'))
        .map(({ l, i }) => `${i + 1}: ${l.trim()}`)
      expect(offenders, `Сырой message уходит в job.error:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})

// ── 3. План прогрева: джоб-путь и одно ядро ──────────────────────────────────
describe('план прогрева переживает мобилу (24.08)', () => {
  it('ядро одно: SSE-роут и джоб используют lib/ai/warmupPlan', () => {
    const core = read('lib/ai/warmupPlan.ts')
    expect(core).toContain('create_warmup_plan') // промпт/тул живут в ядре
    const sse = read('app/api/ai/warmup-plan/route.ts')
    expect(sse).toContain("from '@/lib/ai/warmupPlan'")
    expect(sse).not.toContain('create_warmup_plan') // не раздваиваем промпт
    const job = read('lib/jobs/runWarmupPlanJob.ts')
    expect(job).toContain('generateWarmupPlan(')
  })
  it('джоб-роут: 202 + after() + тип warmup_plan', () => {
    const r = read('app/api/jobs/warmup-plan/route.ts')
    expect(r).toContain("type:       'warmup_plan'")
    expect(r).toContain('after(() => processWarmupPlanJob(')
    expect(r).toContain('{ status: 202 }')
    // Гейты как у SSE-пути: не дешевле обойти джобом
    expect(r).toContain('requirePaidAccess')
    expect(r).toContain('requireProjectAccess')
    expect(r).toContain("rateLimit(user.id, 'warmup-plan')")
  })
  it('клиент: джоб + поллинг, jobId в черновике СРАЗУ, догон при возвращении', () => {
    const w = read('components/strategy/WarmupWizard.tsx')
    expect(w).toContain('/api/jobs/warmup-plan')
    expect(w).toContain('patchDraftNow({ warmupJobId: data.jobId })')
    expect(w).toContain('draft?.warmupJobId && !draft.aiPlanData') // mount-догон
    expect(w).not.toContain('/api/ai/warmup-plan') // клиент больше не на SSE
  })
  it('ядро санитизирует ошибки: сырой err.message не уходит наружу', () => {
    const core = read('lib/ai/warmupPlan.ts')
    expect(core).toContain('captureException')
    expect(core).not.toMatch(/error:\s*(?:err|e)\.message/)
    // Старый грех SSE-роута: const msg = err.message → send({message: msg}).
    // console.error с err.message — легитимная телеметрия; ловим именно
    // отправку клиенту.
    const sse = read('app/api/ai/warmup-plan/route.ts')
    const offenders = sse.split('\n').filter(l =>
      /send\(/.test(l) && /(?:err|e)\.message|message:\s*msg\b/.test(l) && !l.trim().startsWith('//'))
    expect(offenders).toEqual([])
  })
})
