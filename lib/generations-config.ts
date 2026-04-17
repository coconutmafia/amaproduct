// ─────────────────────────────────────────────────────────────────────────────
// PURE CONFIG — no server imports, safe to use in Client Components
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'agency'

export const PLAN_CONFIG: Record<SubscriptionPlan, {
  label: string
  price: number
  generations: number
  projects: number
  features: string[]
}> = {
  free: {
    label: 'Free',
    price: 0,
    generations: 5,
    projects: 1,
    features: [
      '5 генераций в месяц',
      '1 проект',
      'Базовая генерация контента',
      'База знаний проекта',
    ],
  },
  starter: {
    label: 'Starter',
    price: 19,
    generations: 80,
    projects: 1,
    features: [
      '80 генераций в месяц',
      '1 проект',
      'Все форматы контента',
      'База знаний проекта',
      'История контента',
    ],
  },
  pro: {
    label: 'Pro',
    price: 49,
    generations: 250,
    projects: 5,
    features: [
      '250 генераций в месяц',
      '5 проектов',
      'Все форматы контента',
      'Style Bank',
      'Анализ аккаунта',
      'История контента',
      'Приоритетная обработка',
    ],
  },
  agency: {
    label: 'Agency',
    price: 129,
    generations: 800,
    projects: -1,
    features: [
      '800 генераций в месяц',
      'Неограниченно проектов',
      'Все форматы контента',
      'Style Bank',
      'Анализ аккаунта',
      'Приоритетная обработка',
      'Ранний доступ к новым функциям',
    ],
  },
}

export const REFERRAL_REWARDS = {
  invitee_signup:      10,
  referrer_l1_signup:  10,
  referrer_l1_payment: 25,
  referrer_l2_signup:   5,
  referrer_l2_payment: 12,
}
