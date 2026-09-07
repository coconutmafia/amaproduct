#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// A/B №2 (07.09, жалоба Даши «25 единиц за сообщение»): 80% цены чата — запись
// в кэш ~155 тыс. токенов контекста, из которых 53% — СЫРЫЕ расшифровки
// кастдевов, обрезанные до первых 15 тыс. знаков каждая. Гипотеза: убрать сырые
// расшифровки из ПОСТОЯННОГО контекста (таблицы исследования по ним остаются,
// сами расшифровки приходят подбором под вопрос, как matches в проде) — и
// качество не упадёт. Второй вопрос: Sonnet 5 вместо Opus 5 на том же контексте.
//   A — прод сейчас (ALWAYS_INCLUDE с лимитами), Opus 5
//   B — то же без interview_transcript + RAG-подбор под вопрос, Opus 5
//   C — как B, но Sonnet 5
// Два слепых набора для судьи (context-ab-judge.mjs): AB и AC. Кэш промпта
// включён (5 мин) — вопросы одного проекта идут подряд, повторы читают кэш.
// Запуск: node scripts/context-ab2.mjs   (≈ $8–12 API, 20–30 мин)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const OUT = join(ROOT, '..', 'context-ab2-results')
mkdirSync(join(OUT, 'AB'), { recursive: true }); mkdirSync(join(OUT, 'AC'), { recursive: true })

// Зеркало lib/ai/rag.ts
const DEFAULT_RAW_LIMIT = 3000
const RAW_LIMIT = { interview_transcript: 15000, audience_research: 15000, audience_survey: 15000, meanings_map: 15000, my_instagram: 15000, cases_reviews: 15000, blog_lines: 15000, competitors: 12000, tone_of_voice: 8000, unpacking_map: 6000 }
const ALWAYS_INCLUDE = ['my_instagram','competitors','tone_of_voice','meanings_map','unpacking_map','blog_lines','audience_research','interview_transcript','audience_survey','additional','cases_reviews','funnel_description','marketing_strategy','marketing_tactics','product_description','content_reference','chatbot_description','other']
const MASTER_TITLE = 'Общая таблица кастдевов (все интервью)'
const PRICE = { 'claude-opus-5': { in: 5, out: 25, cr: 0.5, cw: 6.25 }, 'claude-sonnet-5': { in: 2, out: 10, cr: 0.2, cw: 2.5 } }

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

async function rest(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}
function materialsBlock(mats, filter) {
  const parts = []; const seen = new Set()
  for (const m of mats) {
    if (!m.raw_content) continue
    if (m.processing_status && m.processing_status !== 'ready' && m.processing_status !== 'done') continue
    if (m.title === MASTER_TITLE) continue
    if (!filter(m.material_type)) continue
    const raw = String(m.raw_content)
    const key = `${m.material_type}::${m.title}::${raw.length}::${raw.slice(0, 120)}`
    if (seen.has(key)) continue
    seen.add(key)
    const limit = RAW_LIMIT[m.material_type] ?? DEFAULT_RAW_LIMIT
    parts.push(`[${m.material_type}] ${m.title}:\n${raw.slice(0, limit)}`)
  }
  return parts.join('\n\n---\n\n')
}
async function embed(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
  })
  const d = await r.json()
  return d.data?.[0]?.embedding ?? null
}
async function matchChunks(projectId, embedding) {
  const r = await fetch(`${U}/rest/v1/rpc/match_project_chunks`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ query_embedding: embedding, project_id: projectId, match_threshold: 0.4, match_count: 14 }),
  })
  if (!r.ok) return []
  return r.json()
}
async function ask(model, system, userMsg) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 3000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
    const d = await r.json()
    if (r.ok) {
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      return { text, usage: d.usage }
    }
    if (r.status === 529 || r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 15000)); continue }
    throw new Error(`anthropic ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
  }
  throw new Error('anthropic: перегружен после 3 попыток')
}
const usd = (model, u) => {
  const p = PRICE[model]
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cr + (u.cache_creation_input_tokens || 0) * p.cw) / 1e6
}
const scaffold = (projName, block) =>
  `Ты — личный AI-продюсер и SMM-ассистент проекта «${projName}». Ниже — материалы проекта: говори в голосе владельца, отвечай по-русски, конкретно и с опорой ТОЛЬКО на материалы; факты не выдумывай — если данных нет, скажи об этом.\n\n=== МАТЕРИАЛЫ ПРОЕКТА ===\n\n${block}`

const dasha = (await rest(`profiles?select=id&email=eq.daria.shitova0601@gmail.com`))[0]
const avg = (await rest(`profiles?select=id&email=ilike.avavasilik*`))[0]
const projDasha = (await rest(`projects?select=id,name&owner_id=eq.${dasha.id}&limit=1`))[0]
const projAvg = (await rest(`projects?select=id,name&owner_id=eq.${avg.id}&name=ilike.*Августа*&limit=1`))[0]

const sets = { AB: { blind: [], key: [], costs: [] }, AC: { blind: [], key: [], costs: [] } }
let pairNo = 0
const totals = { A: { usd: 0, inTok: 0, n: 0 }, B: { usd: 0, inTok: 0, n: 0 }, C: { usd: 0, inTok: 0, n: 0 } }

for (const proj of [projDasha, projAvg]) {
  const mats = await rest(`project_materials?select=title,material_type,raw_content,processing_status&project_id=eq.${proj.id}&limit=500`)
  const fullBlock = materialsBlock(mats, (t) => ALWAYS_INCLUDE.includes(t))
  const noRawBlock = materialsBlock(mats, (t) => ALWAYS_INCLUDE.includes(t) && t !== 'interview_transcript')
  console.log(`\n${proj.name}: A(полный) ${Math.round(fullBlock.length / 1000)}k знаков, B/C(без расшифровок) ${Math.round(noRawBlock.length / 1000)}k`)
  const qs = proj.id === projAvg.id ? AUGUSTA_QUESTIONS : DASHA_QUESTIONS
  for (const q of qs) {
    pairNo++
    process.stdout.write(`  вопрос ${pairNo}: `)
    const emb = await embed(q)
    const chunks = emb ? await matchChunks(proj.id, emb) : []
    const matchesTxt = chunks.map((c) => `[${c.material_type}] ${c.chunk_text}`).join('\n\n')
    const userWithMatches = `${q}\n\n=== Найденные под вопрос фрагменты материалов ===\n${matchesTxt || '(ничего не нашлось)'}`
    // A и B/C параллельно — экономим стену времени; кэш у каждого свой префикс
    const [A, B, C] = await Promise.all([
      ask('claude-opus-5', scaffold(proj.name, fullBlock), userWithMatches),
      ask('claude-opus-5', scaffold(proj.name, noRawBlock), userWithMatches),
      ask('claude-sonnet-5', scaffold(proj.name, noRawBlock), userWithMatches),
    ])
    const rec = (k, model, r) => { totals[k].usd += usd(model, r.usage); totals[k].inTok += (r.usage.input_tokens || 0) + (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0); totals[k].n++ }
    rec('A', 'claude-opus-5', A); rec('B', 'claude-opus-5', B); rec('C', 'claude-sonnet-5', C)
    console.log(`A✓ B✓ C✓ (подбор: ${chunks.length} фрагментов; вход A ${(A.usage.input_tokens||0)+(A.usage.cache_read_input_tokens||0)+(A.usage.cache_creation_input_tokens||0)} / B ${(B.usage.input_tokens||0)+(B.usage.cache_read_input_tokens||0)+(B.usage.cache_creation_input_tokens||0)} ток.)`)
    for (const [setName, X, labelB] of [['AB', B, 'B (без сырых расшифровок, Opus)'], ['AC', C, 'B (без сырых расшифровок, Sonnet 5)']]) {
      const flip = Math.random() < 0.5
      const [first, second] = flip ? [X, A] : [A, X]
      sets[setName].blind.push(`## Пара ${pairNo} — ${proj.name}\n\n**Вопрос:** ${q}\n\n### Ответ 1\n\n${first.text}\n\n### Ответ 2\n\n${second.text}\n`)
      sets[setName].key.push({ pair: pairNo, project: proj.name, question: q, answer1: flip ? labelB : 'A (полный)', answer2: flip ? 'A (полный)' : labelB })
      sets[setName].costs.push({ pair: pairNo, A_in: (A.usage.input_tokens||0)+(A.usage.cache_read_input_tokens||0)+(A.usage.cache_creation_input_tokens||0), A_out: A.usage.output_tokens, B_in: (X.usage.input_tokens||0)+(X.usage.cache_read_input_tokens||0)+(X.usage.cache_creation_input_tokens||0), B_out: X.usage.output_tokens })
    }
  }
}

for (const setName of ['AB', 'AC']) {
  const s = sets[setName]
  const header = `# A/B №2 ${setName}: полный контекст vs ${setName === 'AB' ? 'без сырых расшифровок (Opus 5)' : 'без сырых расшифровок на Sonnet 5'} (${new Date().toISOString().slice(0, 10)})\n\nПары в СЛУЧАЙНОМ порядке (ключ отдельно).\n\n`
  writeFileSync(join(OUT, setName, 'ab-blind.md'), header + s.blind.join('\n---\n\n'))
  writeFileSync(join(OUT, setName, 'ab-key.json'), JSON.stringify({ key: s.key, costs: s.costs }, null, 2))
}
console.log('\n=== ЭКОНОМИКА (по фактическому usage, с кэшем 5 мин) ===')
for (const k of ['A', 'B', 'C']) console.log(`${k}: средний вход ${Math.round(totals[k].inTok / totals[k].n)} ток., всего $${totals[k].usd.toFixed(2)} за ${totals[k].n} ответов`)
console.log(`Готово: ${OUT}/AB и ${OUT}/AC`)
