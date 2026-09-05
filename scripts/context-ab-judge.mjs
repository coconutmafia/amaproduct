#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Автосудья для A/B контекста (04.09): Матвей справедливо заметил, что Августа
// не может слепо оценивать ответы про ЧУЖИЕ проекты (Станислав) — контекста
// не знает. Судья сравнивает пары по фактам ИЗ МАТЕРИАЛОВ проекта: у него есть
// полный блок материалов, и он проверяет, какой ответ точнее опирается на них
// и не выдумывает. Это не замена вкусу Августы — это измерение, есть ли
// ПОТЕРЯ ФАКТОВ при триме. Вход: папка с ab-blind.md + ab-key.json.
// Запуск: node scripts/context-ab-judge.mjs --dir ../context-ab-results
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs'
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
const DIR = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : join(ROOT, '..', 'context-ab-results')

const blind = readFileSync(join(DIR, 'ab-blind.md'), 'utf8')
const { key, costs } = JSON.parse(readFileSync(join(DIR, 'ab-key.json'), 'utf8'))

// Разбор пар из слепого файла
// Разбор по заголовкам пар: разделитель «---» встречается и ВНУТРИ ответов
// модели, поэтому режем по «## Пара N», а ответы — по первым вхождениям
// «### Ответ 1/2». Хвост «---» последней пары отбрасываем.
const pairs = []
for (const block of blind.split(/^## Пара /m).slice(1)) {
  const head = block.match(/^(\d+) — (.+?)\n\n\*\*Вопрос:\*\* ([\s\S]+?)\n\n### Ответ 1\n\n/)
  if (!head) continue
  const rest = block.slice(head[0].length)
  const i2 = rest.indexOf('\n### Ответ 2\n\n')
  if (i2 < 0) continue
  const a1 = rest.slice(0, i2).trim()
  const a2 = rest.slice(i2 + '\n### Ответ 2\n\n'.length).replace(/\n---\n*$/, '').trim()
  pairs.push({ pair: Number(head[1]), project: head[2].trim(), question: head[3].trim(), a1, a2 })
}
console.log(`пар для суда: ${pairs.length}`)

async function rest(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}
async function ask(system, userMsg, max = 1200) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-5', max_tokens: max, system, messages: [{ role: 'user', content: userMsg }] }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
  return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
}

// Материалы проекта — судье целиком (он должен знать правду)
const matsCache = new Map()
async function materialsFor(projectName) {
  if (matsCache.has(projectName)) return matsCache.get(projectName)
  const proj = (await rest(`projects?select=id,name&name=eq.${encodeURIComponent(projectName)}&limit=1`))[0]
  const mats = proj ? await rest(`project_materials?select=title,material_type,raw_content&project_id=eq.${proj.id}&limit=500`) : []
  const block = mats.filter(m => m.raw_content).map(m => `[${m.material_type}] ${m.title}:\n${String(m.raw_content).slice(0, 15000)}`).join('\n\n---\n\n')
  matsCache.set(projectName, block)
  return block
}

const JUDGE_SYSTEM = `Ты — строгий аудитор качества ответов AI-ассистента блогера. Тебе дают материалы проекта (правда), вопрос и два ответа. Оцени КАЖДЫЙ ответ по 4 критериям от 1 до 5:
1. ФАКТЫ: опирается на материалы проекта (имена, цифры, цитаты, продукты) — а не на общие рассуждения.
2. ТОЧНОСТЬ: нет выдуманных фактов/цитат/имён, которых нет в материалах (выдумка = грубая ошибка, снижай сильно).
3. ПОЛНОТА: покрывает вопрос по существу, ничего важного из материалов не упущено.
4. ПОЛЬЗА: блогер может взять и применить.
Затем вердикт: "1", "2" или "равны" — какой ответ лучше В ЦЕЛОМ, с одной фразой почему.
Верни ТОЛЬКО JSON без markdown, строки внутри БЕЗ кавычек и переносов: {"a1":{"facts":n,"accuracy":n,"completeness":n,"useful":n,"invented":["короткий пример выдумки без кавычек"]},"a2":{...},"verdict":"1|2|равны","why":"одна фраза"}`

const results = []
for (const p of pairs) {
  process.stdout.write(`пара ${p.pair} (${p.project}): `)
  const mats = await materialsFor(p.project)
  const user = `=== МАТЕРИАЛЫ ПРОЕКТА (правда) ===\n${mats}\n\n=== ВОПРОС ===\n${p.question}\n\n=== ОТВЕТ 1 ===\n${p.a1}\n\n=== ОТВЕТ 2 ===\n${p.a2}`
  let verdict = null
  try {
    const raw = await ask(JUDGE_SYSTEM, user, 2000)
    const jm = raw.match(/\{[\s\S]*\}/)
    verdict = JSON.parse(jm ? jm[0] : raw)
  } catch (e) { console.log('❌', e.message.slice(0, 80)); continue }
  const k = key.find(x => x.pair === p.pair)
  const which = v => v === 'равны' ? 'равны' : (v === '1' ? k.answer1 : k.answer2)
  const winner = which(verdict.verdict)
  const scoreOf = (side) => { const s = k.answer1.startsWith(side) ? verdict.a1 : verdict.a2; return s.facts + s.accuracy + s.completeness + s.useful }
  results.push({ pair: p.pair, project: p.project, question: p.question, winner, scoreA: scoreOf('A'), scoreB: scoreOf('B'), invented: { A: (k.answer1.startsWith('A') ? verdict.a1 : verdict.a2).invented, B: (k.answer1.startsWith('B') ? verdict.a1 : verdict.a2).invented }, why: verdict.why })
  console.log(`→ ${winner} | A=${scoreOf('A')}/20 B=${scoreOf('B')}/20 | ${verdict.why.slice(0, 90)}`)
}

const wins = { A: 0, B: 0, tie: 0 }
for (const r of results) wins[r.winner.startsWith('A') ? 'A' : r.winner.startsWith('B') ? 'B' : 'tie']++
const avgA = (results.reduce((s, r) => s + r.scoreA, 0) / results.length).toFixed(1)
const avgB = (results.reduce((s, r) => s + r.scoreB, 0) / results.length).toFixed(1)
const invA = results.reduce((s, r) => s + (r.invented.A?.length || 0), 0)
const invB = results.reduce((s, r) => s + (r.invented.B?.length || 0), 0)
const inA = Math.round(costs.reduce((s, c) => s + c.A_in, 0) / costs.length)
const inB = Math.round(costs.reduce((s, c) => s + c.B_in, 0) / costs.length)
console.log(`\n=== ИТОГ ===`)
console.log(`победы: A (полный) ${wins.A}, B (ядро+RAG) ${wins.B}, равны ${wins.tie}`)
console.log(`средний балл /20: A ${avgA}, B ${avgB} | выдумок: A ${invA}, B ${invB}`)
console.log(`вход на вызов: A ~${inA} ток., B ~${inB} ток. (×${(inA / inB).toFixed(1)} дешевле)`)
writeFileSync(join(DIR, 'ab-judge.json'), JSON.stringify({ results, wins, avgA, avgB, invA, invB, inA, inB }, null, 2))
console.log(`подробно: ${join(DIR, 'ab-judge.json')}`)
