// Правила загрузки материалов — общие для диалога загрузки и роутов (08.09).
//
// Инцидент Любы Тонкич 08.09: 35-минутный созвон (видео + аудио) положен в
// обычную загрузку «Исследование аудитории» → «Ошибка 413». Это не наш роут
// (у него лимит 20 МБ и понятный текст), а потолок Vercel на тело запроса
// 4,5 МБ: файл больше — запрос режется ДО кода, клиент видит голый код. Тот же
// потолок молча бил любой PDF-скан/DOCX больше 4,5 МБ.
//
// Две половины класса:
//  • аудио/видео — не сюда: расшифровка живёт в «Исследовании» (там подписанная
//    ссылка в audio-temp и фоновый джоб); диалог перехватывает такие файлы до
//    отправки и ведёт туда (у Любы файлы без расширения: video1939…/audio1939…);
//  • всё остальное больше DIRECT_UPLOAD_BYTES едет в хранилище напрямую по
//    подписанной ссылке (/api/upload/url), а роут /api/upload получает только
//    storagePath — тело запроса остаётся крошечным.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
/** Выше этого — только прямая загрузка в хранилище (Vercel режет тело на 4,5 МБ). */
export const DIRECT_UPLOAD_BYTES = 3 * 1024 * 1024

const MEDIA_EXT = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|mp4|mov|m4v|webm|mkv|avi|3gp|aiff|wma|caf)$/i
// Экспорт из мессенджеров/диктофонов без расширения: «video1939196410», «audio1939196410»
const MEDIA_BARE_NAME = /^(video|audio|voice|record(ing)?|call)[-_ ]?\d*$/i

export function isMediaFile(name: string, mimeType?: string | null): boolean {
  const t = (mimeType || '').toLowerCase()
  if (t.startsWith('audio/') || t.startsWith('video/')) return true
  const n = (name || '').trim()
  return MEDIA_EXT.test(n) || MEDIA_BARE_NAME.test(n)
}

export const MEDIA_NOT_HERE =
  'Это аудио или видео — здесь оно не расшифровывается. Открой раздел «Исследование» → «AI-транскрибация»: там файл до 200 МБ расшифруется сам и попадёт в материалы.'

export function tooLargeMessage(bytes: number): string {
  return `Файл ${Math.round(bytes / 1024 / 1024)} МБ — больше 20 МБ. Сожми его или раздели на части.`
}

/** Безопасное имя объекта в хранилище (то же правило, что было в /api/upload). */
export function storageObjectName(fileName: string): string {
  return `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}
