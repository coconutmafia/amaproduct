// ─────────────────────────────────────────────────────────────────────────────
// PURE CONFIG — no server imports, safe to use in Client Components.
// SINGLE SOURCE OF TRUTH for plans, prices, limits and trial length.
// Server-side gating + metering live in lib/generations.ts (which re-exports these).
// ─────────────────────────────────────────────────────────────────────────────

// DB-level access level (profiles.subscription_tier). 'trial' is the free 2-month
// experience; the three paid plans are the approved pricing (PRICING.md).
export type SubscriptionTier = 'trial' | 'solo' | 'pro' | 'producer'
export type PaidPlan = Exclude<SubscriptionTier, 'trial'>

// Subscription lifecycle (profiles.subscription_status).
//  trialing  — inside the free 2-month trial
//  active    — paying, current
//  past_due  — payment failed / awaiting retry
//  view_only — grace week after trial/expiry: content visible, generation off
//  paused    — fully paused (no access to generation), data kept
//  canceled  — user canceled (runs until current_period_end, then paused)
export type SubscriptionStatus =
  | 'trialing' | 'active' | 'past_due' | 'view_only' | 'paused' | 'canceled'

// Back-compat alias for older imports.
export type SubscriptionPlan = SubscriptionTier

export interface PlanInfo {
  label: string
  price: number        // $/mo
  priceRub: number     // ₽/mo
  generations: number  // monthly content-unit limit (fair-use ceiling for pro/producer)
  unlimited: boolean   // true → render "безлимит (fair use)" instead of the number
  projects: number     // -1 = effectively unlimited (grown via add-ons)
  teamSeats: number    // extra project_members (editor/viewer) seats per project, beyond the owner
  competitors: number  // Instagram competitor accounts analysable PER PROJECT (Apify = real $)
  badge: string | null
  paid: boolean
  features: string[]
}

export const PLAN_CONFIG: Record<SubscriptionTier, PlanInfo> = {
  trial: {
    label: 'Пробный период',
    price: 0,
    priceRub: 0,
    generations: 300,
    unlimited: false,
    projects: 3,
    teamSeats: 0,
    competitors: 5,
    badge: null,
    paid: false,
    features: [
      'Полный доступ на 2 месяца',
      '~300 единиц контента в месяц',
      'Весь визуал и методология',
    ],
  },
  solo: {
    label: 'Соло',
    price: 49,
    priceRub: 4900,
    generations: 300,
    unlimited: false,
    projects: 1,
    teamSeats: 0,
    competitors: 5,
    badge: 'Оптимальный',
    paid: true,
    features: [
      '1 проект (блог)',
      '~300 единиц контента в месяц',
      'Весь визуал: слайды, бренд-кит, сторис по фото, видео с текстом',
      'Голос + план прогрева + контент-план + ассистент + тренды + библиотека',
      'Анализ конкурентов и Instagram (до 5)',
    ],
  },
  pro: {
    label: 'Про',
    price: 149,
    priceRub: 14900,
    generations: 2000,
    unlimited: true,
    projects: 3,
    teamSeats: 1,
    competitors: 5,
    badge: null,
    paid: true,
    features: [
      '3 проекта',
      'Безлимит генераций (fair use)',
      'Всё из тарифа Соло',
      'Автопостинг Telegram (при запуске)',
      'Видео-сторис / рилз с титрами (при запуске)',
      'Push-напоминания из контент-плана (при запуске)',
      '+1 место в команду',
      'Приоритетная поддержка',
    ],
  },
  producer: {
    label: 'Продюсер',
    price: 299,
    priceRub: 29900,
    generations: 8000,
    unlimited: true,
    projects: 10,
    teamSeats: 5,
    competitors: 10,
    badge: null,
    paid: true,
    features: [
      '10 проектов (расширяется пакетами)',
      'Безлимит генераций (fair use)',
      'Команда 3–5 + клиентский доступ',
      'Анализ конкурентов до 10 на проект',
      'Автопостинг + видео + push-напоминания (при запуске)',
      'Приоритет + персональный менеджер',
    ],
  },
}

// The plans shown as choosable cards on the pricing/upgrade screen (trial excluded).
export const PAID_PLANS: PaidPlan[] = ['solo', 'pro', 'producer']

// ─────────────────────────────────────────────────────────────────────────────
// ПРАЙС-ЛИСТ ЕДИНИЦ — сколько юнитов стоит каждая дорогая операция.
// Решение Матвея 25.08 («математика должна быть плюсовой»): раньше юниты ел
// только готовый контент, а главный расход (транскрибация кастдевов, аудиты,
// рилзы, скрейпы, свободный чат, правки, картинки) шёл мимо лимита — клиент
// на solo мог потреблять как продюсер. Теперь ВСЁ дорогое стоит юниты из
// одного месячного лимита. Цены ≈ себестоимость с маржой (замер августа);
// уточняются по данным ai_usage. МЕНЯЕШЬ ЧИСЛО — проверь тексты на кнопках
// (страж unit-costs следит, что цены показываются из этого объекта).
export const UNIT_COSTS = {
  // ── ЗАМЕРЕНО 25.08 на проде, не на глаз ──────────────────────────────────
  // Выручка solo: $49 / 300 единиц = $0.163 за единицу. Цены поставлены так,
  // чтобы себестоимость была ≤40-50% выручки даже в тяжёлом случае.
  content: 2,               // пост/рилз/карусель/сторис: $0.06 (по кэшу) … $0.28 (холодный)
  video_montage: 5,         // Whisper + минуты CPU на ffmpeg (решение 21 июля)
  video_overlay: 1,
  // Расшифровка ЛИНЕЙНА по минутам: медиана 25 мин, но в проде есть файлы по
  // 8 часов — плоская цена за файл давала −488% маржи на длинных. Whisper
  // $0.006/мин → 10 минут ≈ $0.06 при выручке $0.163.
  transcribe_per_10min: 1,
  research_table: 3,        // флагман по ВСЕМ расшифровкам проекта, до $1.39
  meanings_map: 4,          // карта смыслов: до 380k символов входа + 32k выхода
  warmup_plan: 2,           // план прогрева по всем материалам
  week_brief: 2,            // недельные брифы
  competitor_table: 1,      // сводная таблица конкурентов
  blog_audit: 2,            // скрейп + 2 вызова, $0.09
  viral_reels: 1,           // Apify + Whisper + разбор, $0.06
  instagram_scrape: 1,      // Apify + анализ, $0.01
  image_per_variant: 1,     // gpt-image-1 medium $0.063 за КАЖДЫЙ вариант
  chat_batch: 2,            // сообщение ассистенту: 2 шт = 1 единица (решение Матвея)
  micro_batch: 10,          // мелкие правки/подсказки/голос: 10 шт = 1 единица
} as const

// Обратная совместимость: montage-роут и раннер исторически импортируют это имя.
export const VIDEO_MONTAGE_UNITS = UNIT_COSTS.video_montage

// Расшифровка: цена по длительности (минимум одна единица за файл).
export function transcribeUnits(durationSec?: number | null): number {
  const mins = Math.max(1, Math.ceil((Number(durationSec) || 0) / 60))
  return Math.max(1, Math.ceil(mins / 10)) * UNIT_COSTS.transcribe_per_10min
}

// Free trial length (kept in one place — also encoded in migration 016).
export const TRIAL_DAYS = 60

// Grace window after the trial/period ends before the project is paused.
export const VIEW_ONLY_GRACE_DAYS = 7

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY — 2-level referral rewards. The MLM model is being retired in favour of
// "месяц в подарок" + producer partnership (built alongside billing, Фаза 3).
// Kept only so the hidden /referral page + route still compile until then.
// ─────────────────────────────────────────────────────────────────────────────
export const REFERRAL_REWARDS = {
  invitee_signup:      10,
  referrer_l1_signup:  10,
  referrer_l1_payment: 25,
  referrer_l2_signup:   5,
  referrer_l2_payment: 12,
}
