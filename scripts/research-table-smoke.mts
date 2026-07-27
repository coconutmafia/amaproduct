// Смоук починки «AI не смог структурировать данные» (25 июля): собирает
// синтетическую расшифровку УРОВНЯ «несколько интервью разом» — такую, что
// таблица заведомо больше старого потолка в 8k токенов, — и гонит её через
// ту же связку, что боевой шаг table1: форс-тул + stream + max_tokens 32000.
// Запуск: npx tsx scripts/research-table-smoke.mts  (тратит ~$0.2-0.4 API)
import { anthropic, MODEL } from '../lib/ai/client'

const QUESTIONS = [
  'Расскажи о себе: возраст, город, чем занимаешься?',
  'Как давно ты в этой теме и с чего началось?',
  'Что для тебя самое сложное сейчас?',
  'Что уже пробовала, чтобы это решить?',
  'Почему прошлые попытки не сработали?',
  'Как выглядит твой идеальный результат?',
  'Что тебя останавливает от покупки таких продуктов?',
  'По каким критериям выбираешь наставника или курс?',
  'Сколько готова вложить в решение и почему?',
  'Что должно случиться, чтобы ты решилась прямо сейчас?',
  'Какой прошлый опыт обучения запомнился и чем?',
  'Кому бы ты порекомендовала такой продукт?',
]
const NAMES = ['Ольга', 'Марина', 'Виктория', 'Дарья']

function answer(name: string, qi: number): string {
  return `Ну смотрите, если честно, у меня с этим вопросом номер ${qi + 1} всё непросто. ` +
    `Я ${name}, и я уже несколько лет пытаюсь разобраться, пробовала разные подходы, курсы, марафоны, и каждый раз получается одно и то же: ` +
    `начинаю с энтузиазмом, делаю недели две, потом появляется работа, ребёнок, быт, и всё съезжает. ` +
    `Самое обидное, что я вижу, как у других получается, и думаю, ну чем я хуже, вроде и опыт есть, и люди меня хвалят. ` +
    `Наверное, мне не хватает какой-то системы и человека рядом, который скажет: делай вот так, не распыляйся. ` +
    `Деньги я готова вкладывать, но мне важно понимать, за что я плачу, потому что был опыт, когда я заплатила приличную сумму и осталась одна с записями уроков. ` +
    `Вот это прям боль, если честно, до сих пор вспоминаю с раздражением.`
}

let transcript = 'Интервью с аудиторией, несколько респондентов подряд.\n\n'
for (const name of NAMES) {
  transcript += `=== Интервью, респондент: ${name} ===\n\n`
  for (let qi = 0; qi < QUESTIONS.length; qi++) {
    transcript += `Интервьюер: ${QUESTIONS[qi]}\n${name}: ${answer(name, qi)}\n\n`
  }
}
console.log(`расшифровка: ~${Math.round(transcript.length / 4)} токенов, ${NAMES.length} респондента × ${QUESTIONS.length} вопросов`)

const TABLE1_SYSTEM = `Ты — аналитик аудиторного исследования.
Твоя задача — структурировать расшифровку интервью в чёткую таблицу.
Всегда возвращай ТОЛЬКО валидный JSON без markdown-обёрток, без пояснений.`

const tableTool = {
  name: 'interview_table',
  description: 'Структурированная таблица аудиторного исследования',
  input_schema: {
    type: 'object' as const,
    properties: {
      respondents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, segment: { type: 'string' },
            answers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  block: { type: 'string' },
                  full_answer: { type: 'string' },
                  key_quotes: { type: 'array', items: { type: 'string' } },
                  emotional_tone: { type: 'string' },
                },
                required: ['question', 'block', 'full_answer'],
              },
            },
          },
          required: ['id', 'name', 'answers'],
        },
      },
    },
    required: ['respondents'],
  },
}

const t0 = Date.now()
const stream = anthropic.messages.stream({
  model: MODEL,
  max_tokens: 32000,
  system: TABLE1_SYSTEM,
  tools: [tableTool],
  tool_choice: { type: 'tool' as const, name: 'interview_table' },
  messages: [{ role: 'user', content: `Проанализируй расшифровку интервью с аудиторией. Определи всех участников и все вопросы, для каждого заполни структуру полно: full_answer подробно, key_quotes 2-3 живые цитаты.\n\nРАСШИФРОВКА:\n${transcript}` }],
})
const final = await stream.finalMessage()
const secs = Math.round((Date.now() - t0) / 1000)
console.log(`stop_reason=${final.stop_reason}, output_tokens=${final.usage.output_tokens}, ${secs}с`)

if (final.stop_reason === 'max_tokens') throw new Error('❌ упёрлись в 32k — потолок всё ещё мал')
const block = final.content.find((b) => b.type === 'tool_use')
if (!block || block.type !== 'tool_use') throw new Error('❌ нет tool_use блока')
const data = block.input as { respondents?: { name: string; answers: unknown[] }[] }
if (!Array.isArray(data.respondents) || data.respondents.length < NAMES.length - 1) {
  throw new Error(`❌ respondents=${data.respondents?.length} (ждали ~${NAMES.length})`)
}
const answers = data.respondents.reduce((n, r) => n + (r.answers?.length || 0), 0)
console.log(`✅ ТАБЛИЦА СОБРАНА: ${data.respondents.length} респондентов, ${answers} ответов, JSON валиден без парс-хаков`)
if (final.usage.output_tokens > 8000) {
  console.log(`✅ И ГЛАВНОЕ: выход ${final.usage.output_tokens} токенов > старого потолка 8000 — старый код здесь ПАДАЛ, новый прошёл`)
} else {
  console.log(`ℹ️ выход ${final.usage.output_tokens} ≤ 8000 — кейс меньше боевого, но связка работает`)
}
