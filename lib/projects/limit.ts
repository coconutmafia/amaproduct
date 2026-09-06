// Лимит проектов на тарифе — одно место для UI (мастер, список проектов).
// Зеркало функции project_limit() из миграции 035 (страж:
// tests/smoke/project-limit-ux.test.ts сверяет числа с SQL).
//
// Инцидент 06.09 (Полина Шедько, Соло): второй проект отбивал ТРИГГЕР базы, а
// мастер показывал «Упс, ошибка сервиса — это на нашей стороне» — клиентка
// «в который раз» заполняла все поля и спрашивала, не нужен ли другой тариф.
import { PLAN_CONFIG, type SubscriptionPlan } from '@/lib/generations-config'

export const PLAN_LABEL: Record<string, string> = {
  trial: 'Пробный период', starter: 'Старт', solo: 'Соло', pro: 'Про', producer: 'Продюсер',
}

export function projectLimitFor(tier: string | null | undefined): number {
  const cfg = PLAN_CONFIG[(tier || 'trial') as SubscriptionPlan]
  const n = cfg?.projects
  return typeof n === 'number' && n > 0 ? n : 3
}

const projWord = (n: number) => {
  const a = Math.abs(n) % 100, b = a % 10
  if (a >= 11 && a <= 19) return 'проектов'
  if (b === 1) return 'проект'
  if (b >= 2 && b <= 4) return 'проекта'
  return 'проектов'
}

/** Честное объяснение вместо «ошибка сервиса»: что за лимит и куда идти. */
export function projectLimitMessage(tier: string | null | undefined, count: number): string {
  const limit = projectLimitFor(tier)
  const label = PLAN_LABEL[tier || 'trial'] ?? tier ?? 'твоём тарифе'
  const have = count >= limit ? (limit === 1 ? 'он у тебя уже есть' : `у тебя уже ${count}`) : `у тебя ${count}`
  const next = tier === 'pro'
    ? 'Больше проектов — на «Продюсер» (10).'
    : tier === 'producer'
      ? 'Напиши нам — расширим.'
      : 'Чтобы вести ещё один, нужен «Про» (3 проекта) или «Продюсер» (10).'
  return `На тарифе «${label}» доступно ${limit} ${projWord(limit)} — ${have}. ${next}`
}

export const isProjectLimitError = (msg: string) => /project_limit_reached/i.test(msg || '')
