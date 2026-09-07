#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// A/B №4 (07.09, вечер): КАК СНИЗИТЬ ВЫДУМКИ при том же контексте.
// Разбор 28 выдумок прода за два прогона (AB.B + AD.A): 9 — чужая атрибуция
// реальной цитаты, 7 — придуманные цифры, 9 — цитаты/факты, которых нет, 3 —
// шум судьи. Все три типа — «заполнение пробела». Четыре рычага против прода P
// (слой без сырых расшифровок + подбор, Opus 5, adaptive/high):
//   R — P + жёсткие правила дословности (цитата только дословно и с источником,
//       цифры только как в материалах, нет источника → «в материалах нет»)
//   E — P + глубина рассуждения xhigh (output_config.effort)
//   V — P + проверочный проход: тот же кэш-префикс, второй вызов сверяет каждый
//       факт ответа с материалами и правит/помечает неподтверждённое
//   F — P на claude-fable-5-1 (server-side fallback по умолчанию)
// Слепые наборы для scripts/context-ab-judge.mjs: PR, PE, PV, PF в
// ../context-ab4-results. Запуск: node scripts/context-ab4.mjs (≈ $12 генерация)
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
const OUT = join(ROOT, '..', 'context-ab4-results')
const SETS = ['PR', 'PE', 'PV', 'PF']
for (const s of SETS) mkdirSync(join(OUT, s), { recursive: true })

// Зеркало lib/ai/rag.ts (как в context-ab2.mjs)
const DEFAULT_RAW_LIMIT = 3000
const RAW_LIMIT = { interview_transcript: 15000, audience_research: 15000, audience_survey: 15000, meanings_map: 15000, my_instagram: 15000, cases_reviews: 15000, blog_lines: 15000, competitors: 12000, tone_of_voice: 8000, unpacking_map: 6000 }
const ALWAYS_INCLUDE = ['my_instagram','competitors','tone_of_voice','meanings_map','unpacking_map','blog_lines','audience_research','interview_transcript','audience_survey','additional','cases_reviews','funnel_description','marketing_strategy','marketing_tactics','product_description','content_reference','chatbot_description','other']
const MASTER_TITLE = 'Общая таблица кастдевов (все интервью)'
// $/MTok: in, out, cache read, cache write (5 мин = 1.25×). Fable: чтение кэша $0.25 (claude-api skill).
const PRICE = { 'claude-opus-5': { in: 5, out: 25, cr: 0.5, cw: 6.25 }, 'claude-fable-5-1': { in: 10, out: 50, cr: 0.25, cw: 12.5 } }

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

// system: массив блоков (первый — кэшируемый префикс материалов, дальше — переменные правила)
async function ask(model, systemBlocks, userMsg, extra = {}) {
  // 16k: у Opus 5 (adaptive) и Fable «мысли» входят в max_tokens — при 3000 ответы xhigh/Fable/проверки обрывались (прогон 1, 07.09)
  const body = { model, max_tokens: 16000, system: systemBlocks, messages: [{ role: 'user', content: userMsg }], ...extra }
  const headers = { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
  if (model.startsWith('claude-fable')) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default' }
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) })
    const d = await r.json()
    if (r.ok) {
      if (d.stop_reason === 'refusal') return { text: `[refusal: ${d.stop_details?.category ?? '?'}]`, usage: d.usage, model: d.model }
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      return { text, usage: d.usage, model: d.model, stop: d.stop_reason }
    }
    if (r.status === 400 && body.fallbacks) { delete body.fallbacks; delete headers['anthropic-beta']; console.log('(fable: без fallbacks)'); continue }
    if (r.status === 529 || r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 20000)); continue }
    throw new Error(`anthropic ${r.status}: ${JSON.stringify(d).slice(0, 300)}`)
  }
  throw new Error('anthropic: перегружен после 4 попыток')
}
const usd = (model, u) => {
  const p = PRICE[model] || PRICE['claude-opus-5']
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cr + (u.cache_creation_input_tokens || 0) * p.cw) / 1e6
}
const inTok = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

const scaffold = (projName, block) =>
  `Ты — личный AI-продюсер и SMM-ассистент проекта «${projName}». Ниже — материалы проекта: говори в голосе владельца, отвечай по-русски, конкретно и с опорой ТОЛЬКО на материалы; факты не выдумывай — если данных нет, скажи об этом.\n\n=== МАТЕРИАЛЫ ПРОЕКТА ===\n\n${block}`

// R: правила против трёх типов выдумок (атрибуция, цифры, несуществующие цитаты)
const RULES = `=== ЖЕЛЕЗНЫЕ ПРАВИЛА ФАКТОВ (нарушение = брак) ===
1. ЦИТАТА — только дословно, как написано в материалах, и только с тем источником, где она стоит: [кастдев/интервью], [таблица исследования], [карта смыслов], [отзыв], [Instagram]. Фразу из карты смыслов или из твоих формулировок НЕЛЬЗЯ подавать как слова ученицы/клиентки. Имя рядом с цитатой — только если в материалах это имя стоит рядом с этой фразой; иначе пиши «одна из участниц кастдева» без имени.
2. ЦИФРЫ (цены, длительности, просмотры, подписчики, доходы, сроки, возраст) — только те, что буквально написаны в материалах, и только в том контексте. Нет цифры — не пиши цифру, скажи словами без числа.
3. ФАКТЫ О ПРОДУКТЕ, МЕТОДЕ, КЕЙСАХ, ЛЮДЯХ — только то, что названо в материалах. Нельзя додумывать детали (что происходило на занятии, почему ушла, что именно меняли), даже правдоподобные.
4. Не хватает факта для ответа — так и напиши: «в материалах этого нет», и предложи, где взять. Это лучше, чем заполнить пробел.
5. Перед отправкой перечитай ответ и убери всё, чему не найдёшь дословную опору в материалах.`

// V: проверочный проход — тот же кэш-префикс, сверка ответа с материалами
const VERIFY = (q, answer) => `Ты — редактор-фактчекер этого же проекта. Ниже ВОПРОС и ЧЕРНОВИК ответа ассистента. Сверь каждый факт черновика с материалами проекта выше (и с фрагментами в вопросе):
— цитата не дословная или приписана не тому источнику/человеку → исправь на дословную из материалов или сними имя («одна из участниц кастдева»); если такой цитаты нет вообще — убери её;
— цифра, которой нет в материалах, или взята из другого контекста → убери цифру или замени на ту, что есть;
— деталь о продукте/методе/кейсе/человеке, которой нет в материалах → убери или перепиши без домысла.
Стиль, структуру и голос черновика сохрани; не добавляй новых утверждений. Верни ТОЛЬКО исправленный ответ целиком, без пояснений и пометок.

=== ВОПРОС ===
${q}

=== ЧЕРНОВИК ===
${answer}`

const dasha = (await rest(`profiles?select=id&email=eq.daria.shitova0601@gmail.com`))[0]
const avg = (await rest(`profiles?select=id&email=ilike.avavasilik*`))[0]
const projDasha = (await rest(`projects?select=id,name&owner_id=eq.${dasha.id}&limit=1`))[0]
const projAvg = (await rest(`projects?select=id,name&owner_id=eq.${avg.id}&name=ilike.*Августа*&limit=1`))[0]

const REUSE_P = process.argv.includes('--reuse-p')
const LABEL = { P: 'A (прод: без сырых + подбор, Opus 5)', R: 'B (правила дословности)', E: 'B (effort xhigh)', V: 'B (проверочный проход)', F: 'B (Fable 5.1)' }
const sets = Object.fromEntries(SETS.map((s) => [s, { blind: [], key: [], costs: [] }]))
const totals = Object.fromEntries(['P', 'R', 'E', 'V', 'F'].map((k) => [k, { usd: 0, inTok: 0, out: 0, n: 0 }]))
let pairNo = 0

for (const proj of [projDasha, projAvg]) {
  const mats = await rest(`project_materials?select=title,material_type,raw_content,processing_status&project_id=eq.${proj.id}&limit=500`)
  const block = materialsBlock(mats, (t) => ALWAYS_INCLUDE.includes(t) && t !== 'interview_transcript')
  const base = { type: 'text', text: scaffold(proj.name, block), cache_control: { type: 'ephemeral' } }
  const sysP = [base]
  const sysR = [base, { type: 'text', text: RULES }]
  console.log(`\n${proj.name}: слой ${Math.round(block.length / 1000)}k знаков`)
  const qs = proj.id === projAvg.id ? AUGUSTA_QUESTIONS : DASHA_QUESTIONS
  for (const q of qs) {
    pairNo++
    process.stdout.write(`  вопрос ${pairNo}: `)
    const emb = await embed(q)
    const chunks = emb ? await matchChunks(proj.id, emb) : []
    const matchesTxt = chunks.map((c) => `[${c.material_type}] ${c.chunk_text}`).join('\n\n')
    const user = `${q}\n\n=== Найденные под вопрос фрагменты материалов ===\n${matchesTxt || '(ничего не нашлось)'}`
    // --reuse-p: ответы прода из run1 (raw-N.json) — те же P во всех парах, платим только за варианты
    const reused = REUSE_P ? JSON.parse(readFileSync(join(OUT, 'run1', `raw-${pairNo}.json`), 'utf8')) : null
    const [P, R, E, F] = await Promise.all([
      reused ? Promise.resolve({ text: reused.P, usage: reused.Pusage || { input_tokens: 0, output_tokens: 0 }, stop: 'reused' }) : ask('claude-opus-5', sysP, user),
      ask('claude-opus-5', sysR, user),
      ask('claude-opus-5', sysP, user, { output_config: { effort: 'xhigh' } }),
      ask('claude-fable-5-1', sysP, user),
    ])
    const Vraw = await ask('claude-opus-5', sysP, VERIFY(q, P.text))
    const V = { text: Vraw.text, usage: { // цена V = ответ P + проверка
      input_tokens: (P.usage.input_tokens || 0) + (Vraw.usage.input_tokens || 0), output_tokens: (P.usage.output_tokens || 0) + (Vraw.usage.output_tokens || 0),
      cache_read_input_tokens: (P.usage.cache_read_input_tokens || 0) + (Vraw.usage.cache_read_input_tokens || 0), cache_creation_input_tokens: (P.usage.cache_creation_input_tokens || 0) + (Vraw.usage.cache_creation_input_tokens || 0) } }
    const res = { P, R, E, V, F }
    for (const k of Object.keys(res)) { const model = k === 'F' ? 'claude-fable-5-1' : 'claude-opus-5'; totals[k].usd += usd(model, res[k].usage); totals[k].inTok += inTok(res[k].usage); totals[k].out += res[k].usage.output_tokens || 0; totals[k].n++ }
    console.log(`P✓ R✓ E✓ V✓ F✓ (${chunks.length} фрагм.; stop R/E/V/F: ${R.stop}/${E.stop}/${Vraw.stop}/${F.stop}; вход F ${inTok(F.usage)}; F модель ${F.model})`)
    for (const [setName, k] of [['PR', 'R'], ['PE', 'E'], ['PV', 'V'], ['PF', 'F']]) {
      const X = res[k]
      const flip = Math.random() < 0.5
      const [first, second] = flip ? [X, P] : [P, X]
      sets[setName].blind.push(`## Пара ${pairNo} — ${proj.name}\n\n**Вопрос:** ${q}\n\n### Ответ 1\n\n${first.text}\n\n### Ответ 2\n\n${second.text}\n`)
      sets[setName].key.push({ pair: pairNo, project: proj.name, question: q, answer1: flip ? LABEL[k] : LABEL.P, answer2: flip ? LABEL.P : LABEL[k] })
      sets[setName].costs.push({ pair: pairNo, A_in: inTok(P.usage), A_out: P.usage.output_tokens, B_in: inTok(X.usage), B_out: X.usage.output_tokens })
    }
    // черновики — на случай разбора руками
    writeFileSync(join(OUT, `raw-${pairNo}.json`), JSON.stringify({ q, project: proj.name, P: P.text, Pusage: P.usage, R: R.text, E: E.text, V: V.text, F: F.text, stops: { R: R.stop, E: E.stop, V: Vraw.stop, F: F.stop } }, null, 2))
  }
}

for (const setName of SETS) {
  const s = sets[setName]
  writeFileSync(join(OUT, setName, 'ab-blind.md'), `# A/B №4 ${setName}: прод vs ${LABEL[setName[1]]} (${new Date().toISOString().slice(0, 10)})\n\nПары в СЛУЧАЙНОМ порядке (ключ отдельно).\n\n` + s.blind.join('\n---\n\n'))
  writeFileSync(join(OUT, setName, 'ab-key.json'), JSON.stringify({ key: s.key, costs: s.costs }, null, 2))
}
console.log('\n=== ЭКОНОМИКА (фактический usage, кэш 5 мин) ===')
for (const k of Object.keys(totals)) console.log(`${k}: вход ${Math.round(totals[k].inTok / totals[k].n)} ток./ответ, выход ${Math.round(totals[k].out / totals[k].n)}, всего $${totals[k].usd.toFixed(2)} за ${totals[k].n}`)
writeFileSync(join(OUT, 'economics.json'), JSON.stringify(totals, null, 2))
console.log(`Готово: ${OUT}/{${SETS.join(',')}}`)
