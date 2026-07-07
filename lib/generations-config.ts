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
