import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { UNIT_COSTS, VIDEO_MONTAGE_UNITS, PLAN_CONFIG } from '@/lib/generations-config'

// Прайс-лист единиц (решение Матвея 25.08 «математика должна быть плюсовой»):
// каждая дорогая операция стоит юниты из одного месячного лимита. Стражи здесь
// держат три инварианта, которые ломаются молча и дорого:
//   (а) у КАЖДОЙ платной операции есть гейт (иначе снова «пользуются как
//       продюсер за цену соло»);
//   (б) списание ВСЕГДА имеет парный возврат при провале (иначе клиент платит
//       за несостоявшуюся работу — класс, который уже чинили для монтажа);
//   (в) цены в UI берутся из UNIT_COSTS, а не хардкодом (иначе кнопка обещает
//       одно, а сервер списывает другое).

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('прайс-лист единиц', () => {
  it('цены заданы и положительные', () => {
    for (const [k, v] of Object.entries(UNIT_COSTS)) {
      expect(typeof v, `UNIT_COSTS.${k}`).toBe('number')
      expect(v, `UNIT_COSTS.${k}`).toBeGreaterThan(0)
    }
  })

  it('легаси-имя VIDEO_MONTAGE_UNITS = UNIT_COSTS.video_montage', () => {
    expect(VIDEO_MONTAGE_UNITS).toBe(UNIT_COSTS.video_montage)
  })

  it('самая дорогая операция влезает в месячный лимит базового тарифа', () => {
    const max = Math.max(...Object.values(UNIT_COSTS).filter((_, i) => i !== Object.keys(UNIT_COSTS).indexOf('micro_batch')))
    expect(max).toBeLessThan(PLAN_CONFIG.solo.generations)
  })

  it('честный онбординг влезает в лимит solo: 20 кастдевов + аудит + 5 скрейпов + 30 постов', () => {
    const onboarding =
      20 * UNIT_COSTS.transcribe_castdev +
      UNIT_COSTS.blog_audit +
      5 * UNIT_COSTS.instagram_scrape +
      30 * UNIT_COSTS.content
    expect(onboarding, `онбординг стоит ${onboarding} из ${PLAN_CONFIG.solo.generations}`)
      .toBeLessThan(PLAN_CONFIG.solo.generations)
  })
})

// Каждая дорогая операция обязана иметь гейт. Список — это КОНТРАКТ: добавил
// платный роут, не добавил гейт — тест краснеет здесь, а не в счёте от провайдера.
const METERED_ROUTES: Array<{ file: string; gate: RegExp }> = [
  { file: 'app/api/ai/chat/route.ts',            gate: /gateContentUnit\(|gateMicroAction\(/ },
  { file: 'app/api/ai/plan-stories/route.ts',    gate: /gateContentUnit\(/ },
  { file: 'app/api/jobs/montage/route.ts',       gate: /gateContentUnits\(/ },
  { file: 'app/api/jobs/video-overlay/route.ts', gate: /gateContentUnit\(/ },
  { file: 'app/api/jobs/transcribe/route.ts',    gate: /gateContentUnits\(/ },
  { file: 'app/api/blog-audit/route.ts',         gate: /gateContentUnits\(/ },
  { file: 'app/api/viral-reels/route.ts',        gate: /gateContentUnits\(/ },
  { file: 'app/api/instagram/scrape/route.ts',   gate: /gateContentUnits\(/ },
  { file: 'app/api/ai/generate-image/route.ts',  gate: /gateContentUnits\(/ },
  { file: 'app/api/jobs/research-table/route.ts', gate: /gateContentUnits\(/ },
  { file: 'app/api/ai/analyze-competitors/route.ts', gate: /gateContentUnits\(/ },
  { file: 'app/api/ai/suggest-trends/route.ts',  gate: /gateMicroAction\(/ },
  { file: 'app/api/brand-kit/analyze/route.ts',  gate: /gateMicroAction\(/ },
  { file: 'app/api/ai/edit/route.ts',            gate: /gateMicroAction\(/ },
  { file: 'app/api/ai/edit-carousel/route.ts',   gate: /gateMicroAction\(/ },
  { file: 'app/api/ai/edit-stories/route.ts',    gate: /gateMicroAction\(/ },
  { file: 'app/api/ai/regenerate-fragment/route.ts', gate: /gateMicroAction\(/ },
  { file: 'app/api/ai/suggest-angles/route.ts',  gate: /gateMicroAction\(/ },
  { file: 'app/api/post-hook/route.ts',          gate: /gateMicroAction\(/ },
  { file: 'app/api/carousel/structure/route.ts', gate: /gateMicroAction\(/ },
  { file: 'app/api/ai/transcribe-voice/route.ts', gate: /gateMicroAction\(/ },
]

describe('свип: у каждой платной операции есть гейт', () => {
  for (const { file, gate } of METERED_ROUTES) {
    it(file.replace('app/api/', ''), () => {
      expect(read(file), `нет гейта ${gate}`).toMatch(gate)
    })
  }
})

// Списал юниты — обязан вернуть их, если работа не состоялась. Проверяем сами
// роуты (провал создания джоба) и раннеры (провал самой работы).
describe('свип: списание юнитов имеет парный возврат', () => {
  const REFUNDING = [
    'app/api/jobs/transcribe/route.ts',
    'app/api/blog-audit/route.ts',
    'app/api/viral-reels/route.ts',
    'app/api/instagram/scrape/route.ts',
    'app/api/ai/generate-image/route.ts',
    'lib/jobs/runTranscribeJob.ts',
    'lib/jobs/runBlogAuditJob.ts',
    'lib/jobs/runViralReelJob.ts',
    'lib/jobs/runInstagramScrapeJob.ts',
    'app/api/jobs/research-table/route.ts',
    'lib/jobs/runResearchTableJob.ts',
    'app/api/ai/analyze-competitors/route.ts',
  ]
  for (const f of REFUNDING) {
    it(f, () => {
      expect(read(f), 'нет refundGenerations рядом со списанием').toMatch(/refundGenerations?\(/)
    })
  }

  it('застрявшие метереные джобы возвращают юниты по типу (failStuckJob)', () => {
    const src = read('lib/jobs/failStuckJob.ts')
    for (const type of ['blog_audit', 'viral_reel', 'instagram_scrape']) {
      expect(src, `нет ветки возврата для ${type}`).toMatch(new RegExp(`'${type}'`))
    }
  })

  it('брошенная расшифровка возвращает юниты в чистке 48ч (chain-watch)', () => {
    const src = read('app/api/cron/chain-watch/route.ts')
    expect(src).toMatch(/refundGenerations\(/)
    expect(src, 'нет защиты от двойного возврата').toMatch(/unitsRefunded/)
  })
})

// Цены в интерфейсе — только из UNIT_COSTS.
describe('UI не хардкодит цены', () => {
  it('подписи у кнопок собираются из UNIT_COSTS', () => {
    const hints = read('components/billing/UnitCostHint.tsx')
    for (const key of ['transcribe_castdev', 'blog_audit', 'viral_reels', 'instagram_scrape', 'image_generation']) {
      expect(hints, `UNIT_HINTS не использует UNIT_COSTS.${key}`).toMatch(new RegExp(`UNIT_COSTS\\.${key}`))
    }
  })

  it('страница тарифов показывает прайс-лист из UNIT_COSTS', () => {
    const pricing = read('components/pricing/PricingClient.tsx')
    expect(pricing).toMatch(/UNIT_COSTS\.transcribe_castdev/)
    expect(pricing).toMatch(/UNIT_COSTS\.micro_batch/)
  })

  it('места с ценами используют общий хелпер, а не свои числа', () => {
    const files = [
      'components/projects/ViralReelsManager.tsx',
      'components/projects/InstagramAccountDialog.tsx',
      'components/projects/BlogAuditDialog.tsx',
      'components/carousel/FreeCanvas.tsx',
      'app/(dashboard)/projects/[id]/research/page.tsx',
    ]
    for (const f of files) {
      expect(read(f), `${f} не показывает цену через UNIT_HINTS`).toMatch(/UNIT_HINTS\./)
    }
  })
})

// Учёт расходов: обёртка Claude пишет токены, и это единственная точка — если
// кто-то заведёт свой new Anthropic(), расход снова станет невидимым.
describe('учёт расходов ai_usage', () => {
  it('токены логируются в обёртке client.ts', () => {
    const src = read('lib/ai/client.ts')
    expect(src).toMatch(/logAiUsage/)
    expect(src, 'обёртка должна перехватывать messages.stream').toMatch(/finalMessage\(\)/)
  })

  it('Anthropic инстанцируется ровно один раз во всём репозитории', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        // tests исключены: этот файл сам содержит искомую строку в регекспе
        if (['node_modules', '.next', '.git', 'tests'].includes(e.name)) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name) && /new Anthropic\(/.test(readFileSync(p, 'utf8'))) {
          hits.push(p.replace(ROOT + '/', ''))
        }
      }
    }
    walk(ROOT)
    expect(hits).toEqual(['lib/ai/client.ts'])
  })

  it('Whisper и Apify тоже пишут расход', () => {
    expect(read('lib/jobs/transcribeWindow.ts')).toMatch(/logAiUsage/)
    expect(read('lib/reels/scrapeReel.ts')).toMatch(/logAiUsage/)
    expect(read('lib/instagram/scrapeAccount.ts')).toMatch(/logAiUsage/)
    expect(read('app/api/ai/generate-image/route.ts')).toMatch(/logAiUsage/)
  })
})
