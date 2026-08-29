#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// A/B: полный стабильный контекст vs «ядро + RAG-подбор под вопрос».
//
// Зачем (29.08): чат = 93% AI-затрат, и его цена растёт с объёмом материалов —
// расшифровки/таблицы/конкуренты (81-88% объёма) едут в КАЖДЫЙ запрос целиком,
// хотя полностью лежат в эмбеддингах (project_chunks). Гипотеза: если тяжёлые
// типы приходят RAG-подбором под конкретный вопрос, качество не падает, а
// себестоимость тяжёлых проектов падает кратно. Качество решает Матвей ВСЛЕПУЮ:
// скрипт пишет пары ответов в случайном порядке (ab-blind.md) и ключ отдельно
// (ab-key.json). Без зелёного вердикта трим НЕ включается.
//
// Механика — зеркало lib/ai/rag.ts (ALWAYS_INCLUDE, RAW_LIMIT, порог/количество
// match_project_chunks) и прод-чата (модель, matches к последнему сообщению).
// Запуск:  node scripts/context-ab.mjs [--out dir]     (~$7 на 24 вызова)
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
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(ROOT, '..', 'context-ab-results')
mkdirSync(OUT, { recursive: true })

// Зеркало rag.ts: типы, которые едут в стабильный контекст целиком, и их лимиты
const RAW_LIMIT = {
  interview_transcript: 15000, audience_research: 15000, audience_survey: 15000,
  meanings_map: 15000, my_instagram: 15000, cases_reviews: 15000, blog_lines: 15000,
  competitors: 12000, tone_of_voice: 8000, unpacking_map: 6000,
}
const DEFAULT_RAW_LIMIT = 3000
const ALWAYS_INCLUDE = ['my_instagram','competitors','tone_of_voice','meanings_map','unpacking_map','blog_lines','audience_research','interview_transcript','audience_survey','additional','cases_reviews','funnel_description','marketing_strategy','marketing_tactics','product_description','content_reference','chatbot_description','other']
// Тяжёлые типы, уходящие из стабильной части в RAG-подбор (гипотеза трима):
// именно они дали 81-88% объёма в замерах (Станислав 500k из 571k знаков).
const HEAVY = new Set(['interview_transcript','audience_research','audience_survey','competitors','additional','other'])

const PROJECTS = [
  { id: '6cda43a0-4331-0000-0000-000000000000', name: '' }, // заполняется ниже по email
]

const QUESTIONS = [
  'Что сильнее всего болит у моей аудитории? Дай 5 болей и подкрепи каждую цитатой из кастдевов.',
  'Напиши пост, который разбирает главное возражение моей аудитории — опирайся на реальные слова клиентов из интервью.',
  'Чем я отличаюсь от конкурентов? Конкретно, с именами конкурентов из моих материалов.',
  'Придумай 5 тем для сторис на неделю под мой продукт — от вопросов, которые реально задают клиенты.',
  'Какие сегменты аудитории у меня есть и какой контент нужен каждому из них?',
  'Какой кейс из моих материалов самый сильный для прогрева и почему? Собери из него план поста.',
]

async function rest(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

function materialsBlock(mats, filter) {
  const parts = []
  for (const m of mats) {
    if (!m.raw_content || !['ready', 'done', null, undefined, ''].includes(m.processing_status ?? null) && m.processing_status !== 'ready') continue
    if (!filter(m.material_type)) continue
    const limit = RAW_LIMIT[m.material_type] ?? DEFAULT_RAW_LIMIT
    parts.push(`[${m.material_type}] ${m.title}:\n${String(m.raw_content).slice(0, limit)}`)
  }
  return parts.join('\n\n---\n\n')
}

async function embed(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
  })
  const d = await r.json()
  return d.data?.[0]?.embedding ?? null
}

async function matchChunks(projectId, embedding) {
  // Тот же RPC, порог и количество, что в проде (rag.ts: 0.4 / 14)
  const r = await fetch(`${U}/rest/v1/rpc/match_project_chunks`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ query_embedding: embedding, project_id: projectId, match_threshold: 0.4, match_count: 14 }),
  })
  if (!r.ok) return []
  return r.json()
}

async function ask(system, userMsg) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-5', max_tokens: 3000,
      system, messages: [{ role: 'user', content: userMsg }],
    }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
  const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  return { text, usage: d.usage }
}

const scaffold = (projName, block) =>
  `Ты — личный AI-продюсер и SMM-ассистент проекта «${projName}». Ниже — материалы проекта: говори в голосе владельца, отвечай по-русски, конкретно и с опорой ТОЛЬКО на материалы; факты не выдумывай — если данных нет, скажи об этом.\n\n=== МАТЕРИАЛЫ ПРОЕКТА ===\n\n${block}`

// ── проекты по владельцам ────────────────────────────────────────────────────
const stan = (await rest(`profiles?select=id&email=eq.sungatulin2112@gmail.com`))[0]
const avg = (await rest(`profiles?select=id&email=ilike.avavasilik*`))[0]
const projStan = (await rest(`projects?select=id,name&owner_id=eq.${stan.id}&limit=1`))[0]
const projAvg = (await rest(`projects?select=id,name&owner_id=eq.${avg.id}&name=ilike.*Августа*&limit=1`))[0]

const blind = []
const key = []
const costs = []
let pairNo = 0

for (const proj of [projStan, projAvg]) {
  const mats = await rest(`project_materials?select=title,material_type,raw_content,processing_status&project_id=eq.${proj.id}&limit=500`)
  const fullBlock = materialsBlock(mats, (t) => ALWAYS_INCLUDE.includes(t))
  const coreBlock = materialsBlock(mats, (t) => ALWAYS_INCLUDE.includes(t) && !HEAVY.has(t))
  console.log(`\n${proj.name}: full ${Math.round(fullBlock.length / 1000)}k знаков, core ${Math.round(coreBlock.length / 1000)}k`)

  for (const q of QUESTIONS) {
    pairNo++
    process.stdout.write(`  пара ${pairNo}: `)
    // A — как прод сейчас: всё в стабильном блоке
    const A = await ask(scaffold(proj.name, fullBlock), q)
    process.stdout.write('A✓ ')
    // B — ядро в системе, тяжёлое приходит подбором под вопрос (как matches в проде)
    const emb = await embed(q)
    const chunks = emb ? await matchChunks(proj.id, emb) : []
    const matchesTxt = chunks.map((c) => `[${c.material_type}] ${c.chunk_text}`).join('\n\n')
    const userB = `${q}\n\n=== Найденные под вопрос фрагменты материалов ===\n${matchesTxt || '(ничего не нашлось)'}`
    const B = await ask(scaffold(proj.name, coreBlock), userB)
    console.log(`B✓ (подбор: ${chunks.length} фрагментов)`)

    const flip = Math.random() < 0.5
    const [first, second] = flip ? [B, A] : [A, B]
    blind.push(`## Пара ${pairNo} — ${proj.name}\n\n**Вопрос:** ${q}\n\n### Ответ 1\n\n${first.text}\n\n### Ответ 2\n\n${second.text}\n`)
    key.push({ pair: pairNo, project: proj.name, question: q, answer1: flip ? 'B (ядро+RAG)' : 'A (полный)', answer2: flip ? 'A (полный)' : 'B (ядро+RAG)' })
    costs.push({
      pair: pairNo,
      A_in: A.usage.input_tokens, A_out: A.usage.output_tokens,
      B_in: B.usage.input_tokens, B_out: B.usage.output_tokens,
    })
  }
}

const costA = costs.reduce((s, c) => s + c.A_in * 5 + c.A_out * 25, 0) / 1e6
const costB = costs.reduce((s, c) => s + c.B_in * 5 + c.B_out * 25, 0) / 1e6
const inA = Math.round(costs.reduce((s, c) => s + c.A_in, 0) / costs.length)
const inB = Math.round(costs.reduce((s, c) => s + c.B_in, 0) / costs.length)

const header = `# A/B: полный контекст vs ядро+RAG (${new Date().toISOString().slice(0, 10)})

Пары ответов в СЛУЧАЙНОМ порядке (ключ отдельно — не подглядывать до вердикта).
Оцени в каждой паре: какой ответ лучше (или «равны») — точность фактов, цитаты,
конкретика, голос. Экономика (справочно, без привязки к 1/2):
вход A в среднем ${inA} ток./вызов, B — ${inB} ток./вызов; суммарно A $${costA.toFixed(2)} vs B $${costB.toFixed(2)} за ${costs.length} вопросов.

`
writeFileSync(join(OUT, 'ab-blind.md'), header + blind.join('\n---\n\n'))
writeFileSync(join(OUT, 'ab-key.json'), JSON.stringify({ key, costs }, null, 2))
console.log(`\nГотово: ${join(OUT, 'ab-blind.md')} (ключ в ab-key.json)`)
console.log(`Вход на вызов: A ~${inA} ток., B ~${inB} ток. Стоимость прогона: $${(costA + costB).toFixed(2)}`)
