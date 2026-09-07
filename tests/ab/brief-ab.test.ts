import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// A/B №3: «память проекта» (бриф + подбор) против прода сегодня (слой без
// сырых расшифровок + подбор). Гоняется ТОЛЬКО вручную: RUN_AB=1 npx vitest run
// tests/ab/brief-ab.test.ts (≈ $10–15 API, 20–30 мин). В CI пропускается.
// Результат — слепые пары для scripts/context-ab-judge.mjs в ../context-ab3-results/AD.

const RUN = !!process.env.RUN_AB
const ROOT = process.cwd()
const OUT = join(ROOT, '..', 'context-ab3-results', 'AD')

const AUGUSTA_QUESTIONS = [
  'Какие три главных страха у моих клиенток-микроблогеров перед покупкой наставничества? Подкрепи каждый цитатой из кастдевов.',
  'Напиши пост про мой продукт «Система из 7 шагов» — от боли клиентки к результату, в моём голосе, с реальным кейсом из материалов.',
  'Чем я отличаюсь от других продюсеров микроблогеров? Конкретно, с опорой на мои материалы, без общих слов.',
  'Придумай 5 сторис на неделю для прогрева к бесплатной стратегии — от вопросов, которые реально задают мои клиентки.',
  'Какие сегменты аудитории у меня есть и что каждому нужно услышать, чтобы написать «хочу воронку»?',
  'Собери план прогревного поста из самого сильного кейса в моих материалах: кто, точка А, что делали, точка Б.',
]
const DASHA_QUESTIONS = [
  'Что сильнее всего болит у моей аудитории перед тем, как прийти на йогу? Дай 5 болей и подкрепи каждую цитатой из кастдевов.',
  'Напиши пост про групповые онлайн-занятия йогой — от главного возражения «нет времени / не получится» к результату, словами моих клиенток из интервью.',
  'Чем я отличаюсь от конкурентов? Конкретно, с именами аккаунтов из моих материалов, без общих слов.',
  'Придумай 5 сторис на неделю для прогрева к групповым занятиям — от вопросов, которые реально задают мои ученицы.',
  'Какие сегменты аудитории у меня есть и какой контент нужен каждому, чтобы записаться на первое занятие?',
  'Собери план прогревного поста из самого сильного результата ученицы в моих материалах: кто, точка А, что делали, точка Б.',
]

describe.skipIf(!RUN)('A/B №3: память проекта vs прод сегодня', () => {
  it('генерирует брифы и слепые пары', async () => {
    for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { buildRAGContext } = await import('@/lib/ai/rag')
    const { buildSystemPrompt } = await import('@/lib/ai/prompts/system')
    const { collectBriefInput, generateProjectBrief, renderBriefSection, BRIEF_KEEP_TYPES } = await import('@/lib/ai/projectBrief')
    const { anthropic } = await import('@/lib/ai/client')
    const admin = createAdminClient()
    mkdirSync(OUT, { recursive: true })

    const { data: dasha } = await admin.from('profiles').select('id').eq('email', 'daria.shitova0601@gmail.com').single()
    const { data: avg } = await admin.from('profiles').select('id').ilike('email', 'avavasilik%').limit(1).single()
    const { data: pD } = await admin.from('projects').select('*').eq('owner_id', dasha!.id).limit(1).single()
    const { data: pA } = await admin.from('projects').select('*').eq('owner_id', avg!.id).ilike('name', '%Августа%').limit(1).single()

    const ask = async (system: string, user: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const msg = await anthropic.messages.create({
            model: 'claude-opus-5', max_tokens: 3000,
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: user }],
          })
          const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
          const u = msg.usage
          const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
          const usd = ((u.input_tokens || 0) * 5 + (u.output_tokens || 0) * 25 + (u.cache_read_input_tokens || 0) * 0.5 + (u.cache_creation_input_tokens || 0) * 6.25) / 1e6
          return { text, inTok, out: u.output_tokens || 0, usd }
        } catch (e) { if (attempt === 2) throw e; await new Promise(r => setTimeout(r, 15000)) }
      }
      throw new Error('unreachable')
    }

    const blind: string[] = []; const key: unknown[] = []; const costs: unknown[] = []
    const totals = { A: { usd: 0, inTok: 0 }, D: { usd: 0, inTok: 0 }, brief: { usd: 0 } }
    let pairNo = 0
    for (const [project, qs] of [[pD, DASHA_QUESTIONS], [pA, AUGUSTA_QUESTIONS]] as const) {
      const collected = await collectBriefInput(admin, project.id)
      expect(collected).not.toBeNull()
      const t0 = Date.now()
      const gen = await generateProjectBrief(collected!.input)
      totals.brief.usd += (gen.usage.input_tokens * 5 + gen.usage.output_tokens * 25) / 1e6
      writeFileSync(join(OUT, `brief-${project.name.slice(0, 12).replace(/\s+/g, '_')}.txt`), gen.brief)
      console.log(`\n${project.name}: бриф ${gen.brief.length} знаков из ${gen.inputChars} (усечено: ${gen.truncated}), ${Math.round((Date.now() - t0) / 1000)}с, вход ${gen.usage.input_tokens} ток., выход ${gen.usage.output_tokens}`)

      const ctxA = await buildRAGContext('', project.id, undefined, { stableOnly: true, excludeAlways: ['interview_transcript'], client: admin })
      const ctxD = { ...ctxA, projectBrief: renderBriefSection(gen.brief), projectContext: ctxA.projectContext.filter(c => BRIEF_KEEP_TYPES.has(c.material_type)) }
      const sysA = buildSystemPrompt(ctxA, project), sysD = buildSystemPrompt(ctxD, project)
      console.log(`  система: A ${Math.round(sysA.length / 1000)}k знаков, D ${Math.round(sysD.length / 1000)}k`)
      for (const q of qs) {
        pairNo++
        const m = await buildRAGContext(q, project.id, undefined, { matchesOnly: true, client: admin })
        const matchesBlock = [...m.systemKnowledge.map(c => c.chunk_text), ...m.projectContext.map(c => c.chunk_text)].filter(Boolean).join('\n\n').slice(0, 12000)
        const user = matchesBlock ? `${q}\n\n[СПРАВОЧНЫЕ ФРАГМЕНТЫ ПО ЭТОМУ ВОПРОСУ — материалы проекта и методология, используй если уместно]\n${matchesBlock}` : q
        const [A, D] = await Promise.all([ask(sysA, user), ask(sysD, user)])
        totals.A.usd += A.usd; totals.A.inTok += A.inTok; totals.D.usd += D.usd; totals.D.inTok += D.inTok
        console.log(`  вопрос ${pairNo}: вход A ${A.inTok} / D ${D.inTok} ток.`)
        const flip = Math.random() < 0.5
        const [first, second] = flip ? [D, A] : [A, D]
        blind.push(`## Пара ${pairNo} — ${project.name}\n\n**Вопрос:** ${q}\n\n### Ответ 1\n\n${first.text}\n\n### Ответ 2\n\n${second.text}\n`)
        key.push({ pair: pairNo, project: project.name, question: q, answer1: flip ? 'B (память проекта)' : 'A (полный)', answer2: flip ? 'A (полный)' : 'B (память проекта)' })
        costs.push({ pair: pairNo, A_in: A.inTok, A_out: A.out, B_in: D.inTok, B_out: D.out })
      }
    }
    writeFileSync(join(OUT, 'ab-blind.md'), `# A/B №3: прод сегодня vs память проекта (${new Date().toISOString().slice(0, 10)})\n\n` + blind.join('\n---\n\n'))
    writeFileSync(join(OUT, 'ab-key.json'), JSON.stringify({ key, costs }, null, 2))
    console.log(`\n=== ЭКОНОМИКА === A: вход ${Math.round(totals.A.inTok / pairNo)} ток./ответ, $${totals.A.usd.toFixed(2)}; D: ${Math.round(totals.D.inTok / pairNo)} ток./ответ, $${totals.D.usd.toFixed(2)}; брифы $${totals.brief.usd.toFixed(2)}`)
    expect(pairNo).toBe(12)
  }, 3_600_000)
})
