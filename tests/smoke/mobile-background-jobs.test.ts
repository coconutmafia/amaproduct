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

// ── 4. План недели: джоб-путь, одно ядро и СЕРВЕРНОЕ сохранение брифов ───────
describe('план недели переживает мобилу (24.08)', () => {
  it('ядро одно: sync-роут и джоб используют lib/ai/weekBrief', () => {
    const core = read('lib/ai/weekBrief.ts')
    expect(core).toContain("'week_brief'") // форс-тул живёт в ядре
    const sync = read('app/api/ai/generate-week-brief/route.ts')
    expect(sync).toContain("from '@/lib/ai/weekBrief'")
    expect(sync).not.toContain('week_brief,') // не раздваиваем промпт
    const job = read('lib/jobs/runWeekBriefJob.ts')
    expect(job).toContain('generateWeekBrief(')
  })
  it('джоб сам сохраняет брифы в warmup_plans (клиент может не вернуться)', () => {
    const job = read('lib/jobs/runWeekBriefJob.ts')
    expect(job).toContain('mergeBriefsIntoPlanData(')
    expect(job).toContain("from('warmup_plans')")
  })
  it('джоб-роут: 202 + after() + warmupPlanId проверяется на принадлежность проекту', () => {
    const r = read('app/api/jobs/week-brief/route.ts')
    expect(r).toContain("type:       'week_brief'")
    expect(r).toContain('after(() => processWeekBriefJob(')
    expect(r).toContain('{ status: 202 }')
    expect(r).toContain('requirePaidAccess')
    expect(r).toContain('requireProjectAccess')
    // Чужой warmupPlanId не должен стать целью записи
    expect(r).toMatch(/eq\('project_id', projectId\)/)
  })
  it('клиент: джоб + поллинг, jobId в localStorage сразу, догон при возвращении', () => {
    const page = read('app/(dashboard)/projects/[id]/content-plan/page.tsx')
    expect(page).toContain('/api/jobs/week-brief')
    expect(page).toContain('ama_week_brief_job_')
    expect(page).toContain('pollWeekBriefJob(saved.jobId') // mount-догон
    expect(page).not.toContain('/api/ai/generate-week-brief') // клиент больше не на sync
  })
})

// ── 4b. Автозаполнение мастера: джоб-путь и одно ядро ───────────────────────
describe('автозаполнение мастера переживает мобилу (24.08)', () => {
  it('ядро одно: sync-роут и джоб используют lib/projects/autofill', () => {
    const core = read('lib/projects/autofill.ts')
    expect(core).toContain('scrapeInstagram') // скрейп живёт в ядре
    expect(core).toContain('runAutofill')
    const sync = read('app/api/projects/autofill/route.ts')
    expect(sync).toContain("from '@/lib/projects/autofill'")
    expect(sync).not.toContain('apify.com') // не раздваиваем скрейп
    const job = read('lib/jobs/runAutofillJob.ts')
    expect(job).toContain('runAutofill(')
  })
  it('джоб-роут: 202 + after() + гейты (429/402) как у sync-пути', () => {
    const r = read('app/api/jobs/project-autofill/route.ts')
    expect(r).toContain("type:    'project_autofill'")
    expect(r).toContain('after(() => processAutofillJob(')
    expect(r).toContain('{ status: 202 }')
    expect(r).toContain('requirePaidAccess')
    expect(r).toContain("rateLimit(user.id, 'autofill')")
  })
  it('клиент: джоб + поллинг, jobId в localStorage сразу, догон, 402-подсказка жива', () => {
    const w = read('components/projects/ProjectWizard.tsx')
    expect(w).toContain('/api/jobs/project-autofill')
    expect(w).toContain('ama_autofill_job_')
    expect(w).toContain('pollAutofillJob(jobId)') // mount-догон
    expect(w).toContain('payment_required') // честный 402 (Ира, 16.08) не потерян
    expect(w).not.toContain('/api/projects/autofill') // клиент больше не на sync
  })
})

// ── 4c. Анализ конкурентов: джоб-путь и одно ядро ───────────────────────────
describe('анализ конкурентов переживает мобилу (24.08)', () => {
  it('ядро одно: sync-роут и джоб используют lib/ai/competitorTable', () => {
    const core = read('lib/ai/competitorTable.ts')
    expect(core).toContain('competitor_analysis') // форс-тул живёт в ядре
    const sync = read('app/api/ai/analyze-competitors/route.ts')
    expect(sync).toContain("from '@/lib/ai/competitorTable'")
    expect(sync).not.toContain('tool_choice') // не раздваиваем промпт
    const job = read('lib/jobs/runCompetitorAnalysisJob.ts')
    expect(job).toContain('analyzeCompetitors(')
  })
  it('джоб-роут: 202 + after() + fail-fast без материалов конкурентов', () => {
    const r = read('app/api/jobs/analyze-competitors/route.ts')
    expect(r).toContain("type:       'competitor_analysis'")
    expect(r).toContain('after(() => processCompetitorAnalysisJob(')
    expect(r).toContain('{ status: 202 }')
    expect(r).toContain('requirePaidAccess')
    expect(r).toContain('Сначала добавь конкурентов')
  })
  it('клиент: джоб + поллинг, jobId в localStorage сразу, догон', () => {
    const c = read('components/projects/CompetitorAnalysis.tsx')
    expect(c).toContain('/api/jobs/analyze-competitors')
    expect(c).toContain('ama_competitors_job_')
    expect(c).toContain('void poll(jobId)') // mount-догон
    expect(c).not.toContain('/api/ai/analyze-competitors') // клиент больше не на sync
  })
})

// ── 5. mergeBriefsIntoPlanData: юнит на правила слияния ─────────────────────
describe('mergeBriefsIntoPlanData', async () => {
  const { mergeBriefsIntoPlanData } = await import('../../lib/jobs/runWeekBriefJob')
  const planData = {
    warmup_plan: {
      phases: [
        { daily_plan: [ { day: 1, meaning: 'смысл 1' }, { day: 2, meaning: 'смысл 2' } ] },
        { daily_plan: [ { day: 3, meaning: 'смысл 3', formats: ['post'], briefs: { post: 'старый' } } ] },
      ],
    },
  }
  const requestDays = [
    { day: 1, date: '01.09.2026', phase: 'awareness', meaning: 'смысл 1', formats: ['post', 'reels'] },
    { day: 2, date: '02.09.2026', phase: 'awareness', meaning: 'смысл 2' }, // без форматов → дефолт
  ]

  it('пишет форматы и отфильтрованные брифы только для запрошенных дней', () => {
    const generated = [
      { day: 1, brief: { post: 'тема поста', reels: 'тема рилса', stories: 'лишний формат' } },
      { day: 2, brief: { post: 'п', stories: 'с', reels: 'р' } },
    ]
    const next = mergeBriefsIntoPlanData(planData, requestDays, generated) as typeof planData
    const d1 = next.warmup_plan.phases[0].daily_plan[0] as Record<string, unknown>
    // stories не в выбранных форматах дня 1 — отфильтрован (правило клиента)
    expect(d1.formats).toEqual(['post', 'reels'])
    expect(d1.briefs).toEqual({ post: 'тема поста', reels: 'тема рилса' })
    const d2 = next.warmup_plan.phases[0].daily_plan[1] as Record<string, unknown>
    expect(d2.formats).toEqual(['post', 'stories', 'reels']) // дефолт
    // день 3 не запрашивался — не тронут (другие недели целы)
    const d3 = next.warmup_plan.phases[1].daily_plan[0] as Record<string, unknown>
    expect(d3.briefs).toEqual({ post: 'старый' })
    // исходник не мутирован
    expect((planData.warmup_plan.phases[0].daily_plan[0] as Record<string, unknown>).briefs).toBeUndefined()
  })
})
