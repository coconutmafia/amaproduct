// Лимиты загрузки медиа. Поднимаются переменными Vercel БЕЗ правки кода:
// поставить env → redeploy. ПОРЯДОК ВАЖЕН: сначала поднять глобальный
// «Upload file size limit» в Supabase Dashboard → Project Settings → Storage
// (на Pro по умолчанию остаётся 50 МБ!), иначе Storage отобьёт файл раньше
// наших понятных ошибок.
//
// Потолок ВИДЕО — не сторадж, а время Vercel-функции (maxDuration=300s,
// ffmpeg timeout 240s; кодирование ~реалтайм×2-3 на серверном CPU):
//  - NEXT_PUBLIC_MAX_VIDEO_MB   — видео в сторис/overlay (1 проход ffmpeg).
//    Дефолт 48 (проверенный конверт); рекомендация ≤100.
//  - NEXT_PUBLIC_MAX_MONTAGE_MB — авто-монтаж рилса (Whisper + 2-3 прохода).
//    Дефолт 48; рекомендация ≤80.
// Аудио расшифровки уже env-управляемо в research/page.tsx
// (NEXT_PUBLIC_MAX_AUDIO_MB, дефолт 50) — размер там безопасен при любом
// значении: джоб режет файл окнами по 10 минут.
// Поднял лимит → прогони живой смоук файлом У ПОТОЛКА до анонса клиентам.
export const MAX_VIDEO_MB = Number(process.env.NEXT_PUBLIC_MAX_VIDEO_MB) || 48
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024
export const MAX_MONTAGE_MB = Number(process.env.NEXT_PUBLIC_MAX_MONTAGE_MB) || 48
export const MAX_MONTAGE_BYTES = MAX_MONTAGE_MB * 1024 * 1024
