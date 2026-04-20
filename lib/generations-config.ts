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
      '5 запросов к AI в месяц',
      '1 проект',
      'Генератор контента (посты, Reels, Stories)',
      'Загрузка материалов проекта',
    ],
  },
  starter: {
    label: 'Starter',
    price: 19,
    generations: 80,
    projects: 1,
    features: [
      '80 запросов к AI в месяц',
      '1 проект',
      'Все форматы контента',
      'Загрузка материалов проекта',
      'История созданного контента',
    ],
  },
  pro: {
    label: 'Pro',
    price: 49,
    generations: 250,
    projects: 5,
    features: [
      '250 запросов к AI в месяц',
      '5 проектов',
      'Все форматы контента',
      'Анализ стиля твоего контента',
      'Анализ аккаунта',
      'История созданного контента',
      'Ускоренная обработка запросов',
    ],
  },
  agency: {
    label: 'Agency',
    price: 129,
    generations: 800,
    projects: -1,
    features: [
      '800 запросов к AI в месяц',
      'Неограниченное количество проектов',
      'Все форматы контента',
      'Анализ стиля твоего контента',
      'Анализ аккаунта',
      'Ускоренная обработка запросов',
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
