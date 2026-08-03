// Санитайзер ошибок расшифровки: превращает сырой текст провайдера/инфры в
// честное русское сообщение для клиента и решает, имеет ли смысл повтор.
//
// Зачем (инцидент 31 июля): в jobs.error попало «429 You have no credits
// remaining. Add credits … platform.openai.com/settings/organization/billing» —
// и уехало клиенту как есть: кириллический префикс «Ошибка расшифровки:»
// протаскивал латинский хвост через эвристику friendlyError. Клиент увидел,
// что у сервиса кончились деньги у провайдера, с прямой ссылкой на его биллинг.
//
// Правило: в jobs.error — ТОЛЬКО готовый пользовательский текст; сырая причина
// остаётся в captureException/error_events (диагностика не теряется).
//
// Чистый модуль без серверных импортов — покрыт юнит-тестами
// (tests/smoke/transcribe-errors.test.ts).

export interface SanitizedTranscribeError {
  /** Готовый текст для клиента (русский, без технических хвостов). */
  userMessage: string
  /** true — причина временная (перегруз/сеть/кредиты), повтор имеет смысл. */
  retryable: boolean
}

// Временные причины: у провайдера кончились кредиты/квота, перегруз, сеть,
// 5xx/429. Файл в хранилище оставляем — «Повторить» продолжит с места обрыва.
const RETRYABLE =
  /(no credits|credit balance|insufficient_quota|exceeded your current quota|\b429\b|rate.?limit|overloaded|temporarily unavailable|timed? ?out|ETIMEDOUT|ECONN|fetch failed|network|service unavailable|\b50[0234]\b|internal server error)/i

// Заведомо постоянные причины: битый/пустой/чужой файл — повтор не поможет,
// нужен другой файл.
const PERMANENT_FILE =
  /(ffmpeg|Invalid data|could not find codec|moov atom|Пустой файл|не докачался)/i

const RETRYABLE_MESSAGE =
  'Сервис расшифровки сейчас перегружен или временно недоступен — это на нашей стороне, файл в порядке.'

const PERMANENT_MESSAGE =
  'Не удалось прочитать файл — возможно, он повреждён или это не запись интервью. Пересохрани его в mp3/m4a и загрузи ещё раз.'

const GENERIC_MESSAGE =
  'Расшифровка прервалась из-за ошибки на нашей стороне.'

// Русские тексты, которые пишем сами (transcribeWindow, notMedia) — уже готовы
// для клиента, если не тащат латинский технический хвост.
const CYRILLIC = /[а-яё]/i
const LATIN_TAIL =
  /(ffmpeg|\/var\/task|\/tmp\/|node_modules|Command failed|ENOENT|spawn |exit code|https?:\/\/|openai|anthropic|apify|whisper|\bAPI\b|\b\d{3}\b)/i

/**
 * Сырой текст ошибки шага расшифровки → { userMessage, retryable }.
 * userMessage безопасен для показа клиенту как есть.
 */
export function sanitizeTranscribeError(raw: string | null | undefined): SanitizedTranscribeError {
  const msg = (raw ?? '').trim()
  if (!msg) return { userMessage: GENERIC_MESSAGE, retryable: true }

  // Наши собственные русские тексты без технического хвоста — показываем как
  // есть (например «Пустой файл — возможно, он не докачался из iCloud…»).
  if (CYRILLIC.test(msg) && !LATIN_TAIL.test(msg)) {
    return { userMessage: msg, retryable: !PERMANENT_FILE.test(msg) }
  }

  if (PERMANENT_FILE.test(msg)) return { userMessage: PERMANENT_MESSAGE, retryable: false }
  if (RETRYABLE.test(msg)) return { userMessage: RETRYABLE_MESSAGE, retryable: true }

  // Неизвестная причина: прячем сырец, файл сохраняем — повтор скорее поможет.
  return { userMessage: GENERIC_MESSAGE, retryable: true }
}
