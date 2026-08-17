import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { friendlyError } from '@/lib/friendlyError'

// ─────────────────────────────────────────────────────────────────────────────
// Инцидент 17.08 (Кристина Маринич): «Обновить карту — генерит, но не
// обновляется». Три сложенных дефекта, каждый закреплён стражем, чтобы класс
// не вернулся:
//  1) бейдж «добавлено кастдевов: N» сравнивал created_at карты, а upsert при
//     обновлении его не менял → бейдж не гас НИКОГДА;
//  2) сборка шла в SSE-запросе и умирала вместе с мобильной вкладкой;
//  3) кап 9000 симв/материал отдавал в промпт только шапку больших разборов.
// ─────────────────────────────────────────────────────────────────────────────

const routeSrc = () => readFileSync(join(process.cwd(), 'app/api/ai/research-analyze/route.ts'), 'utf8')

describe('карта смыслов переживает закрытие вкладки (после инцидента 17.08)', () => {
  it('generate_meanings работает в after() и отвечает 202', () => {
    const src = routeSrc()
    expect(src).toContain("import { NextResponse, after } from 'next/server'")
    expect(src).toMatch(/after\(async \(\) => \{/)
    expect(src).toContain('{ started: true }, { status: 202 }')
    // SSE-стрим для карты убран — вернуть его = вернуть смерть сборки на мобиле
    expect(src).not.toContain("send({ type: 'done' })")
  })

  it('meanings_status реализован и не жрёт rate-limit поллингом', () => {
    const src = routeSrc()
    expect(src).toContain("step === 'meanings_status'")
    // rateLimit оборачивается условием, пропускающим статус-шаг
    expect(src).toMatch(/if \(step !== 'meanings_status'\) \{[\s\S]{0,200}rateLimit/)
  })

  it('клиент поллит статус, а не читает SSE', () => {
    const client = readFileSync(join(process.cwd(), 'components/projects/KnowledgePageClient.tsx'), 'utf8')
    expect(client).toContain("step: 'meanings_status'")
    expect(client).toContain('Страницу можно закрыть')
  })

  it('бюджет входа: динамический кап вместо жёстких 9000 на материал', () => {
    const src = routeSrc()
    expect(src).toContain('MEANINGS_PER_MATERIAL_CAP = 24000')
    expect(src).toContain('MEANINGS_TOTAL_BUDGET')
    expect(src).toMatch(/Math\.floor\(MEANINGS_TOTAL_BUDGET \/ Math\.max\(1, materials\.length\)\)/)
  })

  it('ошибка сборки пишется в материал ЧЕЛОВЕЧЕСКИМ текстом, без сырого стека', () => {
    const src = routeSrc()
    // старый вариант вкладывал err.stack в raw_content материала — регресс
    expect(src).not.toMatch(/Стек: \$\{err/)
  })
})

describe('upsert материалов бампает created_at при обновлении (гасит бейдж)', () => {
  it('update-ветка upsertProjectMaterial ставит свежий created_at', () => {
    const src = readFileSync(join(process.cwd(), 'lib/supabase/upsertMaterial.ts'), 'utf8')
    expect(src).toMatch(/\.update\(\{[\s\S]{0,300}created_at:\s*new Date\(\)\.toISOString\(\)/)
  })
})

describe('payment_required больше не маскируется под другую ошибку (кейс Иры 16.08)', () => {
  it('friendlyError переводит payment_required в «подключи тариф»', () => {
    expect(friendlyError(new Error('payment_required'))).toContain('тариф')
    expect(friendlyError(new Error('payment_required'), 'Не удалось получить данные профиля'))
      .not.toContain('Не удалось получить данные')
  })
  it('мастер проектов обрабатывает 402 адресно (заполни вручную)', () => {
    const src = readFileSync(join(process.cwd(), 'components/projects/ProjectWizard.tsx'), 'utf8')
    expect(src).toContain("data.code === 'payment_required'")
    expect(src).toContain('вручную')
  })
  it('autofill: маршрут не отдаёт сырой err.message и шлёт телеметрию', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/projects/autofill/route.ts'), 'utf8')
    expect(src).toContain('captureException')
    expect(src).toContain('maxDuration = 300')
    expect(src).not.toMatch(/NextResponse\.json\(\{ error: msg \}/)
  })
})
