/**
 * AI Content Brain — Integrated Psychology Engine
 * Based on AI_Content_Brain_COMPLETE_MASTER_SYSTEM (v1–v10)
 *
 * Works ADDITIVELY with existing RAG context (TOV, methodology, style examples).
 * Each function returns targeted context — no generic dumps.
 */

// ── CONTENT SCHEMAS ──────────────────────────────────────────────────────────
// 8 universal schemas mapped to warmup phases and content types

const SCHEMAS = {
  success_story: `СХЕМА «ИСТОРИЯ УСПЕХА»: Выбери реального клиента → его точка А (боль, конкретная) → момент решения → шаги → результат с цифрами → вывод применимый к аудитории. Боль должна быть ощутимее победы.`,
  before_after:  `СХЕМА «ДО/ПОСЛЕ»: Сравнивай мировоззрение, не продукт. ДО: что человек думал/делал/терпел. ПОСЛЕ: как изменился его мир. Эмоциональный контраст важнее фактического.`,
  case_pain:     `СХЕМА «КЕЙС ЧЕРЕЗ БОЛЬ»: Начни с боли клиента как своей. "Когда [клиент] пришёл..." → погружение в проблему → поворот → решение → результат. Боль — узнаваемая аудиторией.`,
  objection:     `СХЕМА «ВОЗРАЖЕНИЕ→ПЕРЕВОРОТ»: Назови возражение прямо → поддержи частично → покажи неполную картину → раскрой что не видят → новый вывод. Не убеждай — открывай.`,
  my_method:     `СХЕМА «МОЙ МЕТОД»: Конкретный приём → почему стандартный путь не работает → как пришёл к этому (история) → конкретные шаги → результат. Запрещено: "уникальная система".`,
  myth_bust:     `СХЕМА «МИФ И ПРАВДА»: Распространённое убеждение в нише → поставь под сомнение → доказательство-перевёртыш → почему миф живёт → правда как инсайт для читателя.`,
  educational:   `СХЕМА «РАЗБОР»: Проблема которую не понимают → почему она возникает → механизм (не список советов — логика) → конкретный пример → применение прямо сейчас.`,
  confession:    `СХЕМА «ПРИЗНАНИЕ»: Начни с признания ошибки или слабости → конкретная ситуация → что это стоило → переосмысление → вывод для аудитории. Нельзя: идеальный нарратив без настоящего провала.`,
}

// Best schema(s) per warmup phase
const PHASE_SCHEMAS: Record<string, (keyof typeof SCHEMAS)[]> = {
  awareness:   ['before_after', 'myth_bust', 'educational'],
  trust:       ['success_story', 'case_pain', 'confession'],
  desire:      ['case_pain', 'my_method', 'before_after'],
  close:       ['objection', 'success_story', 'case_pain'],
  niche:       ['myth_bust', 'educational', 'before_after'],
  expert:      ['confession', 'my_method', 'success_story'],
  product:     ['my_method', 'case_pain', 'before_after'],
  objections:  ['objection', 'myth_bust', 'confession'],
  activation:  ['educational', 'myth_bust', 'before_after'],
}

// Warmup plans may store generic phase_1..4; map them to the semantic keys that
// have dedicated schemas / arcs / CTA so they never silently fall back to the
// generic "awareness" default (which weakened briefs/edits for product &
// objection days on plans that use the phase_1..4 convention).
const PHASE_ALIAS: Record<string, string> = {
  phase_1: 'niche', phase_2: 'expert', phase_3: 'product', phase_4: 'objections',
}
const normPhase = (p: string) => PHASE_ALIAS[p] ?? p

/**
 * Returns the best-fit content schema for a given phase.
 * For post/carousel/email — full schema text.
 * For reels/stories — adapted visual/dialogue hint.
 */
export function getSchemaForPhase(phase: string, contentType: string): string {
  const keys = PHASE_SCHEMAS[normPhase(phase)] ?? PHASE_SCHEMAS.awareness
  const primary = SCHEMAS[keys[0]]
  const fallback = SCHEMAS[keys[1]] ?? ''

  const typeNote = contentType === 'reels'
    ? `\nДЛЯ РИЛСА: переведи схему в визуальный язык — не рассказывай, показывай сценами и контрастом.`
    : contentType === 'stories'
    ? `\nДЛЯ СТОРИЗ: разбей схему на интерактивные слайды — каждый слайд один тезис, финальный — CTA.`
    : contentType === 'carousel'
    ? `\nДЛЯ КАРУСЕЛИ: каждый слайд = один шаг схемы. Обложка = обещание инсайта.`
    : ''

  return `СХЕМА КОНТЕНТА (выбери одну — или скомбинируй):
Основная: ${primary}
Запасная: ${fallback}${typeNote}`
}

// ── HOOK ENGINE ──────────────────────────────────────────────────────────────
// Formulas for the first 1–3 lines/seconds — by content type

const HOOKS: Record<string, string[]> = {
  post: [
    `ЦИФРА-ШОК: "[Неожиданная цифра/факт]" — затем раскрываешь почему.`,
    `ПРОТИВОРЕЧИЕ: "Все говорят [общепринятое]. Вот что происходит на самом деле."`,
    `ИДЕНТИФИКАЦИЯ: "Если ты [конкретная ситуация] — читай до конца."`,
    `ПРИЗНАНИЕ: "[N] лет назад я совершил ошибку, которая стоила мне [конкретно]."`,
    `АНТИУБЕЖДЕНИЕ: "[Называешь то что считают правдой]. Это неправда."`,
  ],
  reels: [
    `ВИЗ. ХУК 0–3 СЕК: Необычный ракурс или действие без объяснения → зритель думает "что происходит?"`,
    `РЕЗУЛЬТАТ СНАЧАЛА: Показываешь итог — потом обратный путь к нему.`,
    `ВОПРОС НА ЭКРАНЕ КРУПНО: ответ — в следующей сцене, не сразу.`,
    `ПРЯМОЙ ВЫЗОВ: "Если думаешь что [убеждение] — ты теряешь [конкретно]."`,
  ],
  stories: [
    `ПЕРВАЯ СТОРИС: текст на экране — 2–4 слова крупно (не предложение!), сразу опрос или вопрос.`,
    `ОПРОС-ПРОВОКАЦИЯ: неожиданные варианты → голосуют без чтения текста. Текст подписи — минимум.`,
    `ВИЗУАЛЬНЫЙ КРЮЧОК: автор в кадре + 1–3 слова текста на экране, смысл передаёт голосом.`,
  ],
  carousel: [
    `ОБЕЩАНИЕ ИНСАЙТА: Заголовок = конкретный результат который получит дочитавший.`,
    `ПРОВОКАЦИЯ УБЕЖДЕНИЯ: Ставишь под сомнение общепринятое в нише.`,
    `СЧЁТЧИК-КРЮЧОК: "[N] признаков что [проблема] — и ты не замечаешь."`,
  ],
  email: [
    `ЛИЧНАЯ ИСТОРИЯ с первой строки — без "Привет, я хочу рассказать".`,
    `НЕОЖИДАННЫЙ ВОПРОС: задаёшь вопрос, на который читатель не знает ответа.`,
    `ПРИЗНАНИЕ: начинаешь с ошибки или провала — это останавливает скроллинг.`,
  ],
}

export function getHookEngine(contentType: string): string {
  const formulas = HOOKS[contentType] ?? HOOKS.post
  return `ХУК-ДВИЖОК (первые 1–3 строки/секунды — они решают всё):
${formulas.map((f, i) => `${i + 1}. ${f}`).join('\n')}
Правило: хук не объясняет — он создаёт вопрос в голове, на который читатель/зритель должен получить ответ.`
}

// ── EMOTIONAL MECHANICS BY PHASE ─────────────────────────────────────────────

const PHASE_EMOTIONS: Record<string, string> = {
  awareness: `ЭМОЦИОНАЛЬНАЯ ДУГА «ОСОЗНАНИЕ»:
Любопытство → Узнавание → Лёгкий дискомфорт ("это про меня") → Желание узнать больше
Триггеры: Идентификация, Контраст (каким мог бы быть vs. каким является), Любопытство
Запрещено: упоминать продукт, давать прямые советы, продавать`,

  trust: `ЭМОЦИОНАЛЬНАЯ ДУГА «ДОВЕРИЕ»:
Скептицизм → Удивление ("этот человек говорит то, что обычно скрывают") → Симпатия → Доверие
Триггеры: Уязвимость (признание ошибок), Конкретные кейсы с цифрами, Принадлежность ("мы одинаковые")
Запрещено: хвастовство без истории, перечисление регалий без контекста`,

  desire: `ЭМОЦИОНАЛЬНАЯ ДУГА «ЖЕЛАНИЕ»:
Узнавание текущей боли → Видение возможного "я" → Эмоциональный контраст → Нарастающее желание
Триггеры: Трансформация (путь от А к Б), Облегчение ("можно иначе"), Принадлежность ("другие уже там")
Запрещено: прямое описание продукта как решения, упоминание цены`,

  close: `ЭМОЦИОНАЛЬНАЯ ДУГА «ЗАКРЫТИЕ»:
Напоминание боли → Признание страха → Снятие возражения → Ясный путь вперёд
Триггеры: Безопасность (убрать риск), Реальная срочность, Социальное доказательство
Запрещено: давление, "только сегодня!", агрессивные CTA`,

  niche: `ЭМОЦИОНАЛЬНАЯ ДУГА «НИША»:
Незнание → Осознание проблемы → "Почему это важно именно мне" → Желание узнать больше
Триггеры: Новое знание, Страх упустить важное, Любопытство к решению`,

  expert: `ЭМОЦИОНАЛЬНАЯ ДУГА «ЭКСПЕРТ»:
Скептицизм → Интерес к истории → Симпатия → "Хочу больше от этого человека"
Триггеры: Уязвимость, История с настоящим провалом, Принадлежность`,

  product: `ЭМОЦИОНАЛЬНАЯ ДУГА «ПРОДУКТ»:
Любопытство → Понимание механизма → "Это логично" → Желание попробовать
Триггеры: Ясность (как это работает), Облегчение ("это не сложно"), Конкретное доказательство`,

  objections: `ЭМОЦИОНАЛЬНАЯ ДУГА «ВОЗРАЖЕНИЯ»:
Признание ("я знаю что ты думаешь...") → Сочувствие → Переворот → Новый взгляд
Триггеры: Безопасность, Понимание (меня слышат), Ясность без давления`,

  activation: `ЭМОЦИОНАЛЬНАЯ ДУГА «АКТИВАЦИЯ»:
Любопытство → Вовлечение → Маленький успех (микро-действие) → Желание продолжать
Триггеры: Игра, Лёгкость первого шага, Социальное подтверждение`,
}

export function getEmotionalMechanics(phase: string): string {
  return PHASE_EMOTIONS[normPhase(phase)] ?? PHASE_EMOTIONS.awareness
}

// ── CTA ENGINE BY PHASE ──────────────────────────────────────────────────────

const CTA_ENGINE: Record<string, string> = {
  awareness:   `CTA: мягкий вопрос или приглашение к разговору. "Узнал себя?", "Сохрани — пригодится", "Какой вариант твой?" НЕ продавай.`,
  trust:       `CTA: социальный, диалог. "Был ли похожий опыт?", "Отметь кому важно", "Напиши мне — обсудим"`,
  desire:      `CTA: намёк на продолжение. "Завтра расскажу как именно", "Хочешь детали? Пиши [слово]"`,
  close:       `CTA: конкретный следующий шаг без давления. "Ссылка в шапке", "Пиши [слово] — пришлю детали", "Места ограничены"`,
  niche:       `CTA: образовательный. "Сохрани и перечитай", "Задай вопрос — отвечу всем"`,
  expert:      `CTA: диалог. "Напиши как у тебя", "Буду рада услышать"`,
  product:     `CTA: уточнение. "Есть вопросы по формату? Пиши в директ"`,
  objections:  `CTA: безопасность. "Сомневаешься — напиши, разберём вместе"`,
  activation:  `CTA: лёгкое действие. "Ответь на вопрос ниже", "Голосуй", "Напиши одно слово"`,
}

export function getCTAEngine(phase: string): string {
  return CTA_ENGINE[normPhase(phase)] ?? CTA_ENGINE.awareness
}

// ── NICHE EMOTIONAL DICTIONARY ────────────────────────────────────────────────
// Maps project.niche keyword → emotional vocabulary layer

const NICHE_DICT: Record<string, string> = {
  fitness: `ЭМОЦ. СЛОВАРЬ НИШИ (Фитнес/Здоровье):
Страхи: "снова сорвусь", "тело не меняется", "это не для меня", "недостаточно силы воли"
Желания: энергия без кофе, сила которую видно, уважение к себе в зеркале, лёгкость движений
Слова-маркеры: сила, срыв, плато, привычка, до/после, система, без голодовки
Запрещено: "идеальное тело", "быстрый результат за N дней"`,

  psychology: `ЭМОЦ. СЛОВАРЬ НИШИ (Психология/Коучинг):
Страхи: "я схожу с ума", "со мной что-то не так", "опять по кругу", "никто не поймёт"
Желания: понять себя, отношения без боли, реагировать иначе, внутренний покой
Слова-маркеры: паттерн, триггер, граница, принятие, осознанность, детская история
Запрещено: "исцелишься за N сессий", упрощённые обещания`,

  business: `ЭМОЦ. СЛОВАРЬ НИШИ (Бизнес/Запуски/Деньги):
Страхи: "недостаточно эксперт", "что подумают", "снова вложу и прогорю", "не масштабируется"
Желания: клиенты которые приходят сами, деньги без выгорания, система а не хаос, признание
Слова-маркеры: выручка, масштаб, ниша, воронка, личный бренд, аудитория, запуск
Запрещено: "пассивный доход", "лёгкие деньги", завышенные обещания`,

  beauty: `ЭМОЦ. СЛОВАРЬ НИШИ (Бьюти/Стиль):
Страхи: "выгляжу старше", "деньги на ветер", "мода не для меня", "не своя в образе"
Желания: выглядеть как хочу а не как принято, уверенность в образе, своя эстетика
Слова-маркеры: образ, стиль, ухоженность, уверенность, индивидуальность, внешность
Запрещено: стандарты красоты, "надо исправить"`,

  education: `ЭМОЦ. СЛОВАРЬ НИШИ (Образование/Обучение):
Страхи: "поздно начинать", "я не способный", "потрачу время и не применю"
Желания: навык который работает сразу, понять а не запомнить, видеть прогресс
Слова-маркеры: навык, практика, результат через N недель, применить, понять логику
Запрещено: "легко освоишь за 3 дня", нереальные сроки`,
}

function detectNicheKey(niche: string): string | null {
  const n = niche.toLowerCase()
  // Ниша может быть описана и по-русски, и по-английски (блоги не только русские)
  if (/фитнес|спорт|здоров|похуд|трениров|диет|тело|fitness|workout|health|weight|training/.test(n)) return 'fitness'
  if (/психолог|коуч|терапи|личност|отношен|эмоци|psycholog|coach|therap|mindset|relationship/.test(n)) return 'psychology'
  if (/бизнес|маркет|деньг|финанс|продаж|запуск|доход|монетиз|business|marketing|money|financ|sales|launch/.test(n)) return 'business'
  // 'styling|stylist', а не 'style': голое 'style' ловило 'lifestyle' и уводило
  // lifestyle-блог в бьюти-словарь
  if (/красот|стиль|бьюти|мода|уход|визаж|имидж|beauty|styling|stylist|fashion|makeup|skincare/.test(n)) return 'beauty'
  if (/обучен|образован|курс|учеб|навык|профес|educat|course|learning|teach|skill/.test(n)) return 'education'
  return null
}

export function getNicheEmotions(niche: string): string {
  if (!niche) return ''
  const key = detectNicheKey(niche)
  return key ? NICHE_DICT[key] : ''
}

// ── HUMANIZATION ENGINE ───────────────────────────────────────────────────────
// These rules make AI-generated text feel human — always relevant

export const HUMANIZATION_ENGINE = `ДВИЖОК ГУМАНИЗАЦИИ — что делает текст живым:
✦ НЕСОВЕРШЕННЫЕ МОМЕНТЫ: "Я откладывала это три недели." "Было стыдно." "Я сомневалась до последнего."
✦ СЕНСОРНЫЕ ДЕТАЛИ: запах, звук, телесное ощущение. "Голос дрожал на первом звонке клиента."
✦ ВНУТРЕННИЕ СОМНЕНИЯ: "Часть меня хотела сдаться." "Я не была уверена что это сработает."
✦ РАЗГОВОРНЫЙ РИТМ: Неполные предложения. Паузы через точку. Повторы для акцента.
✦ ИМЕНА И ЦИФРЫ: не "клиент" — "Маша, 34 года, бухгалтер, написала в 2 ночи".
✦ НЕ ОБЪЯСНЯЙ ЭМОЦИИ: не "я почувствовала радость" — а "руки тряслись когда открывала статистику".`

// ── RETENTION MECHANICS ───────────────────────────────────────────────────────

export const RETENTION_ENGINE = `ДВИЖОК УДЕРЖАНИЯ:
✦ ОТКРЫТАЯ ПЕТЛЯ: задай вопрос в начале — отвечай в конце ("почему это работает — объясню дальше")
✦ ПАТТЕРН-РАЗРЫВ: неожиданное предложение после ряда логичных ("А потом всё рухнуло.")
✦ ЛЕСТНИЦА ЛЮБОПЫТСТВА: каждый абзац намекает на следующий
✦ КОНТРАСТ ТОНАЛЬНОСТИ: чередуй серьёзное → лёгкое → снова серьёзное`

// ── EXPANDED AI ANTI-PATTERNS ────────────────────────────────────────────────
// In addition to the BANNED_PHRASES in system.ts

// ── PLATFORM REACH-SAFETY ────────────────────────────────────────────────────
// Instagram/Meta doesn't publish a literal "banned word list", but they DO
// publicly confirm reduced reach ("engagement bait") and policy strikes for
// two categories relevant to this niche (health/nutrition + income/marketing
// coaching): absolute guarantee claims, and generic vote-bait CTAs. The
// product's own lead-gen CTA ("напиши СТРАТЕГИЮ в комментарии") is a SPECIFIC,
// value-tied ask — different from generic bait — and must stay untouched.
export const PLATFORM_SAFE_LANGUAGE = `БЕЗОПАСНОСТЬ ОХВАТОВ (Instagram/Meta ограничивает показы за это — не выдумка, это подтверждённая политика площадки):

1. НЕ ДАВАЙ АБСОЛЮТНЫХ ГАРАНТИЙ РЕЗУЛЬТАТА — площадка занижает охват контента с обещаниями стопроцентного эффекта, особенно в темах здоровья и денег.
   ❌ "Гарантированный результат" / "100% сработает у каждого" / "вылечивает" / "избавит от [диагноз] навсегда"
   ❌ "Гарантированный доход" / "заработок без усилий" / "стабильные Х₽ уже через неделю"
   ❌ (англ.) "guaranteed results" / "works for 100% of people" / "guaranteed income" / "effortless money"
   ✅ Вместо гарантии — конкретный кейс с цифрами ("у Х получилось за 3 месяца") или честная вероятность ("не всем подходит, но у большинства моих клиентов...")

2. НЕ ИСПОЛЬЗУЙ ОБЩИЙ ENGAGEMENT-BAIT — Meta официально подтверждает, что понижает охват постов с призывами лайкать/отмечать без содержательной причины.
   ❌ "Лайкни, если согласен" / "Отметь друга, который..." / "Двойной тап, если..." / "Сохрани, чтобы не потерять"
   ❌ (англ.) "Like if you agree" / "Tag a friend who..." / "Double tap if..." / "Save this so you don't lose it"
   ✅ ЭТО НЕ КАСАЕТСЯ конкретного предметного призыва этого продукта ("Напиши СТРАТЕГИЯ в комментарии — пришлю разбор") — это адресный лид-магнит, а не пустая накрутка вовлечения, его оставляй как есть.

3. Диагнозы и медицинские термины — если ниша про здоровье, формулируй как личный опыт/наблюдение, а не как медицинское утверждение ("я заметила, что..." вместо "это лечит...").`

export const CONTENT_BRAIN_ANTI_PATTERNS = `❌ Идеальный герой без провала — читатель не верит
❌ "Я разработала уникальную систему / авторский метод"
❌ Мотивационные абстракции без конкретики: "поверь в себя", "ты можешь всё"
❌ Перечисление регалий без истории их получения
❌ Финал поста как рекламный слоган
❌ "Меня часто спрашивают..." — вступление-разгон, удали
❌ Советы в стиле списка без объяснения почему это работает
❌ Обещания без доказательств: "это изменит вашу жизнь"
❌ Корпоративный язык в личном блоге: "данный подход позволяет"
❌ Слово "эксперт" применительно к самому блогеру`

// ── CONTENT LANGUAGE ─────────────────────────────────────────────────────────
// Язык КОНТЕНТА (не интерфейса): что настройка проекта говорит генераторам.
// Клиенты русскоговорящие, но блоги ведут и на en/es/de (решение Матвея 13.08):
// разговор с ассистентом — на языке пользователя, контент — на языке блога.
// NULL/неизвестно = поведение до миграции 038 — язык выводится из языка TOV
// (так живёт испанский контент Katia Ustina без настройки — не ломать!).
// 'it' добавлен 03.09 (кастдевы итальянского фотографа, вопрос Кристины) —
// первым классом, свипом по ВСЕМ веткам es/de, а не одной кнопкой.
export type ContentLanguage = 'ru' | 'en' | 'es' | 'de' | 'it'

const CONTENT_LANGUAGES: ContentLanguage[] = ['ru', 'en', 'es', 'de', 'it']

export function resolveContentLanguage(
  project?: { content_language?: string | null } | null
): ContentLanguage | null {
  const raw = (project?.content_language ?? '').toString().trim().toLowerCase()
  return (CONTENT_LANGUAGES as string[]).includes(raw) ? (raw as ContentLanguage) : null
}

// Названия для директив в промптах (по-русски — промпты русские).
const LANGUAGE_NAME_RU: Record<ContentLanguage, string> = {
  ru: 'РУССКИЙ',
  en: 'АНГЛИЙСКИЙ',
  es: 'ИСПАНСКИЙ',
  de: 'НЕМЕЦКИЙ',
  it: 'ИТАЛЬЯНСКИЙ',
}

/**
 * Директива языка контента для системного промпта.
 * null → ДОСЛОВНО старое правило (язык TOV, иначе русский) — обратная
 * совместимость для всех существующих проектов без настройки.
 * Явный язык → жёсткое правило: КОНТЕНТ только на нём, разговор — на языке
 * пользователя (клиент может общаться по-русски, а блог вести на английском).
 */
export function getContentLanguageDirective(lang: ContentLanguage | null): string {
  if (!lang) return 'Язык ответа: тот, на котором написан TOV. Если TOV нет — русский.'
  return `ЯЗЫК КОНТЕНТА: ${LANGUAGE_NAME_RU[lang]} — это язык, на котором блогер ведёт блог (настройка проекта).
ВЕСЬ генерируемый контент — посты, сценарии рилз (реплики и текст на экране), сторис, слайды каруселей, хуки, заголовки, CTA, письма — пиши ТОЛЬКО на этом языке, даже если материалы проекта (кастдевы, стратегия, распаковка) написаны на другом.
Разговор с пользователем (пояснения, вопросы, варианты «как зайти») веди на языке его сообщений — но сам контент выдавай на языке блога.
Цитаты аудитории из материалов при использовании в контенте переводи на язык блога естественно, без кальки.`
}

/**
 * Эвристика языка уже написанного текста — для роутов, которые пере-
 * структурируют готовый контент (карусель, пост-хук, раскадровка сторис) и не
 * знают проекта. Возвращает en/es/de → включается родная ветка анти-AI-запретов;
 * null → русская (кириллица или непонятно). Осторожно с ложной латиницей:
 * URL/@хэндлы/**акценты** не считаются буквами (русский текст со ссылкой — не
 * английский). es/de распознаются по своим символам (¿¡ñ / äöüß) и плотности
 * служебных слов; при равенстве очков побеждает английский.
 */
export function detectTextLanguage(text: string): 'en' | 'es' | 'de' | 'it' | null {
  const clean = String(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[a-z0-9_.]+/gi, ' ')
    .replace(/\*\*/g, ' ')
  const letters = (clean.match(/[a-zA-Zа-яА-ЯёЁäöüßÄÖÜáéíóúüñÁÉÍÓÚÑ¿¡àèìòùÀÈÌÒÙ]/g) || []).length
  if (letters < 40) return null // слишком коротко, чтобы судить
  const latin = (clean.match(/[a-zA-ZäöüßÄÖÜáéíóúüñÁÉÍÓÚÑàèìòùÀÈÌÒÙ]/g) || []).length
  if (latin / letters <= 0.6) return null
  // Явные символы языка решают сразу
  if (/[¿¡]|ñ/i.test(clean)) return 'es'
  if (/ß/.test(clean)) return 'de'
  const words = clean.toLowerCase().match(/[a-záéíóúüäößàèìòù']+/g) || []
  const esStop = new Set(['que', 'de', 'la', 'el', 'los', 'las', 'una', 'uno', 'para', 'como', 'está', 'esto', 'pero', 'por', 'con', 'más', 'te', 'tu', 'mi', 'es', 'un', 'en', 'no', 'se', 'del', 'al', 'y'])
  // Итальянский — романский сосед испанского: различаем по СВОИМ служебным
  // словам (che/di/non/perché/più) и элизии с апострофом (c'è, l'ho, un'idea).
  const itStop = new Set(['che', 'di', 'non', 'per', 'con', 'una', 'sono', 'questo', 'questa', 'anche', 'più', 'perché', 'ma', 'della', 'del', 'gli', 'come', 'cosa', 'quando', 'però', 'già', 'così', 'è', 'da', 'nel', 'alla'])
  const enStop = new Set(['the', 'and', 'you', 'that', 'this', 'for', 'with', 'was', 'are', 'have', 'not', 'but', 'what', 'when', 'your', 'from', 'they', 'she', 'his', 'her'])
  const deStop = new Set(['und', 'der', 'die', 'das', 'ich', 'nicht', 'mit', 'für', 'ist', 'auf', 'dass', 'ein', 'eine', 'wie', 'aber', 'dem', 'den', 'mir', 'mich', 'dir', 'du', 'wir', 'was', 'sich', 'auch'])
  let esHits = 0, enHits = 0, deHits = 0, itHits = 0
  for (const w of words) {
    if (esStop.has(w)) esHits++
    if (enStop.has(w)) enHits++
    if (deStop.has(w)) deHits++
    if (itStop.has(w)) itHits++
    if (/^[a-z]+'[aeiou]/.test(w)) itHits++ // элизия: c'è, l'anima, un'ora
  }
  if (deHits > enHits && deHits > esHits && deHits > itHits && deHits >= 3) return 'de'
  if (itHits > enHits && itHits > esHits && itHits >= 3) return 'it'
  if (esHits > enHits && esHits >= 3) return 'es'
  return 'en'
}

// ── ANTI-AI-TELLS ─────────────────────────────────────────────────────────────
// Concrete "tells" that instantly read as ChatGPT (flagged by the owner). Example-
// driven on purpose — examples steer the model far better than abstract rules.
export const AI_TELLS_TO_AVOID = `КАК НЕ ВЫДАТЬ ЧТО ТЕКСТ ПИСАЛ AI (считывается мгновенно — соблюдай строго):

1. ТИРЕ «—» НЕ СТАВЬ В ТЕКСТЕ КОНТЕНТА ВООБЩЕ. Это главный палящий признак AI: живые люди так почти не пишут и не говорят, а вслух (рилз/сторис) звучит по-роботски — на место тире просится живое слово. Переформулируй предложение целиком.
   ❌ «Запуск — миллион рублей.»  ✅ «Запустились на миллион рублей.»
   ❌ «А продаж — ноль.»  ✅ «А продаж вообще не было.»
   ❌ «Подписчики были и до этого. Кассы не было.»  ✅ «Подписчики у неё были и раньше, а вот продавать было негде.»
   ❌ «Блог без системы — это кафе без кассы»  ✅ «Блог без системы это как кафе без кассы»
   Правило простое: рука тянется поставить «—» → остановись и перепиши фразу со словами. Тире не должно быть НИ в посте, НИ в сценарии рилза, НИ в сторис.
   В РИЛЗ/ОЗВУЧКЕ пиши РОВНО как человек скажет ВСЛУХ — целыми живыми фразами.

2. СУЩЕСТВИТЕЛЬНЫЕ ЧЕРЕЗ ТОЧКУ — ЖЁСТКИЙ ЗАПРЕТ, НИ ОДНОГО РАЗА. Перечисление коротких безглагольных кусков подряд — один из главных палящих маркеров AI-текста.
   ❌ «Море. Солнце. Новая жизнь.»  ✅ «Море, солнце и вроде бы новая жизнь.»
   ❌ «Ребёнок. Работа. Чужой язык. Чужая страна.»  ✅ «Ребёнок, работа, чужой язык в чужой стране.»
   ❌ «Заходят. Смотрят. Уходят.»  ✅ «Люди заходят, смотрят и уходят.»
   То же с телеграфными «Не А. Не Б. А В.» — переписывай живой связной фразой.

3. ШАБЛОННЫЕ ВОПРОСЫ-ПОДВОДКИ — ЖЁСТКИЙ ЗАПРЕТ. «И знаешь, что самое тупое?», «И знаете, что самое важное?», «И знаешь, почему?», «Знаете, что я поняла?» и любые вариации «И знаешь(те), что/почему…?» — штампованная AI-формулировка, мгновенно палит текст. Переход делай УТВЕРЖДЕНИЕМ или сразу конкретикой:
   ❌ «И знаешь, что самое тупое? Я думала, что справлюсь сама.»  ✅ «Самое тупое: я реально думала, что справлюсь сама.»
   ❌ «И знаете, почему так произошло?»  ✅ «А произошло это потому, что…» (и сразу причина)

4. ПУСТЫЕ ОФФЕРЫ — доноси КОНКРЕТНУЮ пользу, а не «оффер ради оффера».
   ❌ «Напиши СИСТЕМА в комментарии — посмотрю твой блог и скажу конкретно.» (скажу ЧТО конкретно?)
   ✅ «Напиши СИСТЕМА — пришлю разбор: где именно в твоём блоге теряются продажи и что починить первым.»

5. РАЗМЫТЫЕ ФРАЗЫ «НИ О ЧЁМ» — убирай или конкретизируй. ❌ «именно это я разбираю внутри», «разбираем на программе», «погружаемся в трансформацию». Скажи ЧТО и ГДЕ конкретно.
   ❌ «это я разбираю внутри» → ✅ «это мы пошагово выстраиваем в работе: ставим в блоге кассу и путь от просмотра до оплаты».

6. ШТАМПОВАННЫЕ ПОДВОДКИ-СВЯЗКИ — ЖЁСТКИЙ ЗАПРЕТ, НИ ОДНОГО РАЗА (блогеры узнают в них AI мгновенно и злятся):
   ❌ «А теперь давай честно» / «Давай честно» / «Скажу честно» как подводка к мысли
   ❌ «на пальцах» в любом виде («разложу на пальцах», «объясню на пальцах», «давай на пальцах»)
   ❌ «И вот тут самое главное/страшное/интересное/непонятное» и ЛЮБЫЕ вариации «И вот тут самое …» — это утвердительный близнец запрещённого «И знаешь, что самое…?». Переход делай СРАЗУ сутью: не «И вот тут самое главное. Всё решает продукт.», а «Всё в итоге решает продукт.»
   ❌ «ровно то же самое» / «С [чем-то] ровно то же самое» — склей живой связкой: ✅ «и с инфопродуктами всё точно так же», ✅ «та же история и с курсами» — или начни сразу с сути.

7. СЦЕНАРИЙ РИЛЗ / ОЗВУЧКА = УСТНАЯ РЕЧЬ, НЕ ТЕЛЕГРАФ. Мысленно ПРОГОВОРИ каждую реплику вслух: если звучит рублеными обрубками («Три пасты. Один прилавок. Продукт разный.») — так живой человек НЕ говорит, склей в естественное предложение («Три разные пасты стоят на одном прилавке, и продукт у них совершенно разный»). Реплика в кадре — обычно 10-25 слов с естественными связками, как в разговоре с подругой. Правило №2 (существительные через точку) в озвучке действует ЕЩЁ ЖЁСТЧЕ, чем в тексте.`

// ── ANTI-AI-TELLS (ENGLISH) ──────────────────────────────────────────────────
// Английский близнец AI_TELLS_TO_AVOID: паттерны, по которым англоязычный
// читатель мгновенно узнаёт ChatGPT. Источник — задокументированные признаки
// AI-текста (Wikipedia «Signs of AI writing» / WikiProject AI Cleanup) +
// зеркала запретов Августы. Написан ПО-АНГЛИЙСКИ намеренно: модель, пишущая
// английский контент, точнее соблюдает запреты с англоязычными примерами.
// Русская ветка при этом НЕ подключается — её примеры бессмысленны в EN-тексте.
export const AI_TELLS_TO_AVOID_EN = `HOW NOT TO SOUND LIKE AI (English readers spot these instantly — follow strictly):

1. NO EM DASHES ("—") IN CONTENT. This is the single most recognizable giveaway of AI-written English. Real bloggers rarely type them, and in a voiceover they read as robotic pauses. When your hand reaches for a dash, stop and rewrite the sentence with words.
   ❌ "The launch — a complete disaster."  ✅ "The launch turned into a complete disaster."
   ❌ "It's not talent — it's practice."  ✅ "It comes down to practice, not talent."
   No em dashes in posts, reels scripts, stories, or slides. (Hyphens inside compound words like "hand-painted" are fine.)

2. NO STACCATO NOUN FRAGMENTS. Chains of short verbless fragments are a top AI marker, and nobody talks like that out loud.
   ❌ "Sea. Sun. A new life."  ✅ "Sea, sun, and what felt like a new life."
   ❌ "No filters. No scripts. Just me."  ✅ "No filters or scripts, just me."
   ❌ "The result? Silence."  ✅ "And the result was silence."
   Same for "Not A. Not B. Just C." constructions: merge them into one living sentence.

3. NO NEGATIVE PARALLELISM, in any form. The "it's not just X, it's Y" template is the most overused AI construction on Instagram:
   ❌ "It's not just a painting. It's a way of seeing."
   ❌ "This isn't about art. It's about attention."
   ❌ "Not only does it calm you, it changes you."
   State the claim directly instead: ✅ "Painting taught me to notice things I used to walk past."

4. NO TEMPLATE LEAD-INS AND FAKE-CANDID HOOKS. These stamp the text as AI immediately:
   ❌ "Here's the thing:" / "Let's be honest" / "Real talk:" / "And you know what's crazy?" / "But here's what nobody tells you" / "Want to know the best part?" / "Plot twist:" / "Let's dive in" / "Buckle up"
   Make the transition a statement or go straight to the point:
   ❌ "And you know what's crazy? I almost quit."  ✅ "The crazy part: I almost quit."

5. NO AI VOCABULARY. These words and stock phrases read as ChatGPT, not as a person: delve, unlock, unleash, elevate, empower, foster, tapestry, testament, vibrant, game-changer, transformative, journey (figurative), "in today's fast-paced world", "capturing the essence", "a masterpiece" (about your own work), "I'm excited to share", "Don't miss out".
   Use the plain word a person would say: learn, start, improve, change, my work, this piece.

6. NO "-ING" ANALYSIS TAILS glued onto sentences to fake depth:
   ❌ "…, reflecting my deep connection to nature."   ❌ "…, evoking a sense of movement."
   ❌ "…, showcasing the beauty of everyday moments."
   If the thought matters, give it its own sentence with a subject and a verb. If it doesn't, cut it.

7. EMPTY OFFERS — always name the CONCRETE value, never an offer for its own sake.
   ❌ "DM me 'ART' and I'll share the details." (details of WHAT?)
   ✅ "DM me 'ART' and I'll send the list of available paintings with sizes and prices."
   Same for vague "this is exactly what I cover inside" — say WHAT exactly and WHERE.

8. REELS SCRIPT / VOICEOVER = SPOKEN LANGUAGE, NOT TELEGRAPH. Mentally SAY every line out loud: if it sounds like clipped fragments ("Three pastas. One counter. Different product."), a real person would never say it — merge into natural speech ("There are three different pastas on the same counter, and the product is completely different"). A spoken line is usually 10-25 words with natural connectors, like talking to a friend. Rule 2 applies to voiceover even MORE strictly than to written text.`

// ── ANTI-AI-TELLS (ESPAÑOL) ──────────────────────────────────────────────────
// Испанский близнец: те же классы паттернов (тире-драма, staccato, негативный
// параллелизм, фальшивые подводки, AI-словарь, герундий-хвосты, устная речь),
// написан по-испански с испанскими примерами — как EN-ветка.
export const AI_TELLS_TO_AVOID_ES = `CÓMO NO SONAR COMO IA (los lectores lo detectan al instante — cúmplelo estrictamente):

1. NADA DE RAYAS «—» COMO PAUSA DRAMÁTICA. Es una de las marcas más reconocibles del texto de IA; en voz alta suena robótico. Reescribe la frase con palabras.
   ❌ "El lanzamiento — un desastre total."  ✅ "El lanzamiento terminó siendo un desastre total."
   ❌ "No es talento — es práctica."  ✅ "Al final es práctica, no talento."

2. NADA DE FRAGMENTOS STACCATO sin verbo, uno tras otro: nadie habla así.
   ❌ "Mar. Sol. Una vida nueva."  ✅ "Mar, sol y lo que parecía una vida nueva."
   ❌ "Sin filtros. Sin guiones. Solo yo."  ✅ "Sin filtros ni guiones, solo yo."
   Lo mismo con "No A. No B. Solo C." — únelo en una frase viva.

3. NADA DE PARALELISMO NEGATIVO, en ninguna forma:
   ❌ "No es solo un cuadro. Es una forma de ver."
   ❌ "No se trata de arte. Se trata de atención."
   Afirma directo: ✅ "Pintar me enseñó a fijarme en cosas que antes pasaba de largo."

4. NADA DE MULETILLAS DE ARRANQUE NI FALSA CONFIANZA:
   ❌ "Aquí va la verdad:" / "Seamos honestos" / "¿Sabes qué es lo más loco?" / "Y lo mejor de todo?" / "Sumerjámonos" / "Prepárate"
   Haz la transición con una afirmación o ve directo al grano.

5. NADA DE VOCABULARIO DE IA: desbloquear, potenciar, elevar, transformador, revolucionario, "en el mundo actual", "capturar la esencia", "una obra maestra" (sobre tu propio trabajo), "no te lo pierdas".
   Usa la palabra simple que diría una persona: aprender, empezar, mejorar, mi trabajo, esta pieza.

6. NADA DE COLAS DE GERUNDIO pegadas para fingir profundidad:
   ❌ "…, reflejando mi profunda conexión con la naturaleza."  ❌ "…, evocando una sensación de movimiento."
   Si la idea importa, dale su propia frase con sujeto y verbo. Si no, córtala.

7. OFERTAS VACÍAS — nombra SIEMPRE el valor concreto.
   ❌ "Escríbeme 'ARTE' y te cuento los detalles." (¿detalles de QUÉ?)
   ✅ "Escríbeme 'ARTE' y te mando la lista de cuadros disponibles con medidas y precios."

8. GUION DE REELS / VOZ EN OFF = LENGUA HABLADA, NO TELÉGRAFO. Di cada línea en voz alta mentalmente: una línea hablada tiene 10-25 palabras con conectores naturales, como hablando con una amiga. La regla 2 aplica a la voz en off TODAVÍA más estricto.`

// ── ANTI-AI-TELLS (ITALIANO) ─────────────────────────────────────────────────
// Итальянский близнец: те же классы паттернов, на живом итальянском.
export const AI_TELLS_TO_AVOID_IT = `COME NON SEMBRARE UN'IA (i lettori lo capiscono al volo — rispettalo alla lettera):

1. NIENTE LINEETTE «—» COME PAUSA DRAMMATICA. È uno dei segni più riconoscibili del testo IA; letta ad alta voce suona robotica. Riscrivi la frase con le parole.
   ❌ "Il lancio — un disastro totale."  ✅ "Il lancio si è rivelato un disastro totale."
   ❌ "Non è talento — è pratica."  ✅ "Alla fine è pratica, non talento."

2. NIENTE FRAMMENTI STACCATO senza verbo, uno dopo l'altro: nessuno parla così.
   ❌ "Mare. Sole. Una vita nuova."  ✅ "Mare, sole e quella che sembrava una vita nuova."
   ❌ "Senza filtri. Senza copioni. Solo io."  ✅ "Senza filtri né copioni, solo io."
   Vale anche per "Non A. Non B. Solo C." — uniscilo in una frase viva.

3. NIENTE PARALLELISMO NEGATIVO, in nessuna forma:
   ❌ "Non è solo un quadro. È un modo di vedere."
   ❌ "Non si tratta di arte. Si tratta di attenzione."
   Afferma diretto: ✅ "Dipingere mi ha insegnato a notare cose che prima ignoravo."

4. NIENTE FRASI FATTE D'APERTURA NÉ FINTA CONFIDENZA:
   ❌ "Diciamocelo:" / "Sai qual è la cosa assurda?" / "E la parte migliore?" / "Immergiamoci" / "Preparati" / "Spoiler:"
   Fai la transizione con un'affermazione o vai dritto al punto.

5. NIENTE VOCABOLARIO DA IA: sbloccare, potenziare, elevare, trasformativo, rivoluzionario, "nel mondo di oggi", "catturare l'essenza", "un capolavoro" (sul proprio lavoro), "non perdertelo".
   Usa la parola semplice che direbbe una persona: imparare, iniziare, migliorare, il mio lavoro, questo pezzo.

6. NIENTE CODE DI GERUNDIO attaccate per fingere profondità:
   ❌ "…, riflettendo il mio legame profondo con la natura."  ❌ "…, evocando un senso di movimento."
   Se l'idea conta, dalle una frase sua con soggetto e verbo. Se no, tagliala.

7. OFFERTE VUOTE — nomina SEMPRE il valore concreto.
   ❌ "Scrivimi 'ARTE' e ti racconto i dettagli." (dettagli di COSA?)
   ✅ "Scrivimi 'ARTE' e ti mando la lista dei quadri disponibili con misure e prezzi."

8. COPIONE REELS / VOCE FUORI CAMPO = LINGUA PARLATA, NON TELEGRAMMA. Pronuncia ogni riga a mente ad alta voce: una riga parlata ha 10-25 parole con connettivi naturali, come parlando con un'amica. La regola 2 vale per il voiceover ANCORA più severa.`

// ── ANTI-AI-TELLS (DEUTSCH) ──────────────────────────────────────────────────
// Немецкий близнец: те же классы + немецкая специфика (Nominalstil-канцелярит,
// «nicht nur …, sondern …», du-Form как в живых блогах).
export const AI_TELLS_TO_AVOID_DE = `WIE DU NICHT NACH KI KLINGST (Leser erkennen es sofort — halte dich strikt daran):

1. KEINE GEDANKENSTRICHE «—» ODER « – » ALS DRAMA-PAUSE. Das ist eines der klarsten KI-Merkmale; laut gesprochen klingt es roboterhaft. Schreib den Satz mit Wörtern um.
   ❌ "Der Launch — eine komplette Katastrophe."  ✅ "Der Launch wurde zur kompletten Katastrophe."
   ❌ "Es ist kein Talent — es ist Übung."  ✅ "Am Ende ist es Übung, kein Talent."
   (Bindestriche in Komposita wie "selbst-gemischt" sind okay.)

2. KEINE STAKKATO-FRAGMENTE ohne Verb hintereinander: so redet kein Mensch.
   ❌ "Meer. Sonne. Ein neues Leben."  ✅ "Meer, Sonne und etwas, das sich nach einem neuen Leben anfühlte."
   ❌ "Keine Filter. Kein Skript. Nur ich."  ✅ "Ohne Filter und Skript, einfach nur ich."
   Genauso "Nicht A. Nicht B. Nur C." — verbinde es zu einem lebendigen Satz.

3. KEIN NEGATIV-PARALLELISMUS, in keiner Form:
   ❌ "Es geht nicht nur um Kunst. Es geht um Aufmerksamkeit."
   ❌ "Das ist kein Hobby. Das ist eine Lebensweise."
   Sag die Aussage direkt: ✅ "Malen hat mir beigebracht, Dinge zu sehen, an denen ich früher vorbeigelaufen bin."

4. KEINE FLOSKEL-EINSTIEGE UND FAKE-VERTRAULICHKEIT:
   ❌ "Mal ehrlich:" / "Und weißt du was?" / "Das Beste daran?" / "Tauchen wir ein" / "Spoiler:" / "Aber jetzt kommt's:"
   Mach den Übergang als Aussage oder komm direkt zum Punkt.

5. KEIN KI-VOKABULAR: entfesseln, freischalten, transformativ, revolutionär, bahnbrechend, "in der heutigen schnelllebigen Welt", "die Essenz einfangen", "ein Meisterwerk" (über die eigene Arbeit), "verpasse nicht".
   Und KEIN Nominalstil-Beamtendeutsch im persönlichen Blog ("die Umsetzung der Optimierung ermöglicht…") — schreib, wie Menschen reden, in der du-Form wie im echten Blog.

6. KEINE PARTIZIP- UND RELATIV-ANHÄNGSEL als Fake-Tiefe:
   ❌ "…, was meine tiefe Verbindung zur Natur widerspiegelt."
   Wenn der Gedanke wichtig ist, bekommt er einen eigenen Satz mit Subjekt und Verb. Wenn nicht, streich ihn.

7. LEERE ANGEBOTE — nenne IMMER den konkreten Wert.
   ❌ "Schreib mir 'KUNST' und ich erzähle dir mehr." (mehr WOVON?)
   ✅ "Schreib mir 'KUNST' und ich schicke dir die Liste der verfügbaren Bilder mit Größen und Preisen."

8. REELS-SKRIPT / VOICEOVER = GESPROCHENE SPRACHE, KEIN TELEGRAMM. Sprich jede Zeile im Kopf laut aus: eine gesprochene Zeile hat 10-25 Wörter mit natürlichen Verbindungen, wie im Gespräch mit einer Freundin. Regel 2 gilt im Voiceover NOCH strenger.`

/**
 * Анти-AI-запреты по языку контента: en/es/de — родные ветки (решение Матвея
 * 13.08 — блоги клиентов бывают на этих трёх языках, качество = как у русского);
 * ru и null — русская ветка (null = легаси-поведение до миграции 038).
 */
export function getAiTells(lang: ContentLanguage | null): string {
  if (lang === 'en') return AI_TELLS_TO_AVOID_EN
  if (lang === 'es') return AI_TELLS_TO_AVOID_ES
  if (lang === 'de') return AI_TELLS_TO_AVOID_DE
  if (lang === 'it') return AI_TELLS_TO_AVOID_IT
  return AI_TELLS_TO_AVOID
}

// ── VISUAL DESIGN RULES ──────────────────────────────────────────────────────
// Distilled from the owner's lesson «Визуальная концепция профиля» (knowledge
// vault). Injected into visual planning prompts (stories layout, carousel
// structuring) so on-image text follows her methodology, not generic design.
export const VISUAL_RULES = `ПРАВИЛА ОФОРМЛЕНИЯ ВИЗУАЛА (методология эксперта — соблюдай строго):
1. МИНИМУМ ТЕКСТА НА ЭКРАНЕ: максимум 2 коротких предложения на кадр/слайд, без длинных оборотов. Люди пришли не читать — текст должен схватываться за секунду.
2. ЧИТАБЕЛЬНОСТЬ ПРЕВЫШЕ ВСЕГО: текст не мелкий и не гигантский, никогда не «тонкий шрифт на пёстром фоне». Всегда думай, как это увидит человек.
3. ДВА РАЗМЕРА ШРИФТА максимум на одном экране: крупный заголовок + средний текст. Тезисы одного уровня — ОДНИМ размером.
4. АКЦЕНТ ФИРМЕННЫМ ЦВЕТОМ: выделяй 1-2 самых важных слова на кадре (двойными звёздочками **слово**) — это фирменный приём узнаваемости.
5. ПЕРЕЧИСЛЕНИЯ — СТРУКТУРОЙ: не блоком текста, а короткими отдельными строками (каждый тезис с новой строки), мозг любит структуру.
6. ПЕРВЫЙ КАДР ЦЕПЛЯЕТ: первая надпись не пресная — она решает, будут ли смотреть дальше.
7. ВОВЛЕЧЕНИЕ в ~20% кадров: опрос, реакция, вопрос, «жми/ответь» — не в каждом кадре.
8. ЕДИНЫЙ СТИЛЬ: одинаковое оформление между кадрами (шрифты/цвета/манера), БЕЗ чужих элементов, которых нет в стиле блогера. Разнообразие — за счёт раскладки и ракурсов, не за счёт новых шрифтов.`

// ── VIRAL REELS FRAMEWORK ────────────────────────────────────────────────────
// Proven structures behind reels that actually go viral. Injected into reels
// generation so the AI builds scripts on viral mechanics, not generic "show
// don't tell". Adapts patterns to the blogger's voice — never copies.

export function getViralReelsFramework(): string {
  return `─── ДВИЖОК ВИРАЛЬНЫХ РИЛЗ ──────────────────────────────────
Сценарий должен быть построен по законам залетающих рилз, а не как «видео-пересказ поста».

ВИРАЛЬНЫЕ ФОРМАТЫ (выбери ОДИН, наиболее подходящий теме — и держи его до конца):
1. POV / «эффект присутствия»: «POV: ты [ситуация зрителя]» — зритель узнаёт себя в первой секунде.
2. 3 ОШИБКИ / СПИСОК: «3 ошибки в [теме], из-за которых [последствие]» — быстрый перечень, каждая = отдельная сцена.
3. ДО / ПОСЛЕ (трансформация): контраст «было → стало», визуальный скачок между сценами.
4. РАЗРУШЕНИЕ МИФА: «Тебе говорят [миф]. На самом деле [правда]» — переворот в первые 3 сек.
5. ГОВОРЯЩАЯ ГОЛОВА + B-ROLL: автор говорит на камеру, поверх — перебивки (действие, текст, примеры).
6. «ЧТО Я ХОТЕЛА ЗНАТЬ РАНЬШЕ»: личный опыт → инсайт, который зритель забирает себе.
7. ЗАКУЛИСЬЕ / ПРОЦЕСС: показываем как что-то делается изнутри — залипательно и доверительно.

ЗАКОНЫ УДЕРЖАНИЯ (обязательно):
✦ ХУК 0–3 СЕК: на экране крупный текст-крючок + визуальная аномалия. Без «привет, меня зовут».
✦ НЕТ ПАУЗ: каждая сцена 1.5–4 сек, склейка на действии. Зритель не должен заскучать ни на секунду.
✦ ОТКРЫТАЯ ПЕТЛЯ: в хуке обещай ответ/итог, который раскроется в конце → досматривают до конца.
✦ ПАТТЕРН-РАЗРЫВ на 5–7 сек: смена ракурса/локации/темпа, чтобы не пролистнули.
✦ ТЕКСТ НА ЭКРАНЕ: дублирует ключевую мысль каждой сцены (смотрят без звука) — коротко, 3–6 слов.
✦ ЛУП В КОНЦЕ: финал мягко возвращает к началу или даёт повод пересмотреть.
✦ CTA В КОММЕНТАРИИ: призыв написать слово в комментах работает лучше «подпишись».

АДАПТАЦИЯ ПОД НИШУ (если в материалах есть анализ конкурентов / Instagram):
Посмотри какие рилз-форматы и заходы «зашли» у конкурентов в этой нише (по лайкам/комментам/просмотрам в их разборе).
Возьми ПРИНЦИП того, что у них сработало (структуру хука, формат, тему-боль) и адаптируй под голос и историю этого блогера.
НИКОГДА не копируй дословно — только механику виральности.

КРИТИЧНО: сценарий = раскадровка по сценам с таймингом. Не абзац текста. Каждая сцена — что в кадре, что за текст на экране, что говорит автор.
────────────────────────────────────────────────────────────`
}
