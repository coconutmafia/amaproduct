// Сравнение OCR-качества моделей на РЕАЛЬНОМ материале из прода (read-only).
// Зачем: OCR — «сантехника» (юзер видит только извлечённый текст), и есть
// соблазн увести её с флагмана на дешёвую модель. Менять модель БЕЗ этого
// замера нельзя: скрины опросов несут точные цифры (проценты, голоса, охваты),
// и потерянная цифра = испорченный материал исследования.
//
// Скачивает картинку материала из private-бакета `materials`, гонит через
// ТОТ ЖЕ промпт, что прод (lib/ai/ocr.ts → OCR_SYSTEM), на указанных моделях
// и печатает выходы рядом. Эталон — прод-выход текущей модели уже лежит в
// raw_content материала (печатается первым).
//
// Запуск: npx tsx scripts/ocr-model-smoke.mts <material_id> [modelId ...]
//   по умолчанию модели: claude-sonnet-4-6 claude-haiku-4-5
//   (~$0.02-0.10 API за прогон)
import { readFileSync } from 'node:fs'

// .env.local tsx сам не подхватывает — загружаем ДО импорта anthropic-клиента.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '').trim()
}

const { OCR_SYSTEM } = await import('../lib/ai/ocr')
const Anthropic = (await import('@anthropic-ai/sdk')).default

const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const materialId = process.argv[2]
const models = process.argv.length > 3 ? process.argv.slice(3) : ['claude-sonnet-4-6', 'claude-haiku-4-5']
if (!materialId) { console.error('usage: npx tsx scripts/ocr-model-smoke.mts <material_id> [modelId ...]'); process.exit(1) }

const rows = await fetch(`${U}/rest/v1/project_materials?select=title,file_url,file_type,raw_content&id=eq.${materialId}`, {
  headers: { apikey: K, Authorization: `Bearer ${K}` },
}).then(r => r.json())
const mat = rows[0]
if (!mat?.file_url) { console.error('материал не найден или без файла'); process.exit(1) }

const img = await fetch(`${U}/storage/v1/object/authenticated/materials/${mat.file_url}`, {
  headers: { Authorization: `Bearer ${K}`, apikey: K },
})
if (!img.ok) { console.error('не скачалась картинка:', img.status); process.exit(1) }
const buf = Buffer.from(await img.arrayBuffer())
const mediaType = mat.file_type === 'png' ? 'image/png' : mat.file_type === 'webp' ? 'image/webp' : 'image/jpeg'
console.log(`Материал: ${mat.title} (${mat.file_type}, ${(buf.length / 1024).toFixed(0)} КБ)\n`)
console.log(`──────── ЭТАЛОН: прод-выход текущей модели ────────\n${mat.raw_content}\n`)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
for (const model of models) {
  const t0 = Date.now()
  const resp = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system: OCR_SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
      { type: 'text', text: 'Распознай и верни весь текст из этого файла.' },
    ] }],
  })
  const text = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim()
  console.log(`──────── ${model} (${((Date.now() - t0) / 1000).toFixed(1)}с, in ${resp.usage.input_tokens} / out ${resp.usage.output_tokens} ток) ────────\n${text}\n`)
}
