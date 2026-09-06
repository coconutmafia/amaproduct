// «Текущий план» на странице тарифов — только когда подписка реально
// действует. Инцидент 06.09 (видео Матвея, Виктория Абертасова): после
// закрытия «вечных» доступов 30.08 у неё tier=solo, status=view_only, платёжки
// нет — а витрина считала Соло «текущим» и ВЫКЛЮЧАЛА кнопку: человек хотел
// заплатить и не мог. Правило: тариф считается текущим, только если статус
// активный (active / trialing) И подписка привязана к платёжке. Ручной
// триал без платёжки, пауза, view_only — всё покупаемо, включая свой же тариф.
export function hasActivePaidSubscription(
  status: string | null | undefined,
  provider: string | null | undefined,
): boolean {
  return (status === 'active' || status === 'trialing') && !!provider
}

export function isCurrentPlan(
  key: string,
  currentTier: string | null | undefined,
  status: string | null | undefined,
  provider: string | null | undefined,
): boolean {
  return key === currentTier && hasActivePaidSubscription(status, provider)
}

// «Возвращающийся» клиент — уже имел доступ/подписку (закрыт за неоплату,
// пауза, отменил, истёк период). Демо-период — только для НОВЫХ: возвращающийся
// платит сразу (мандат Матвея 06.09: «она сейчас оплачивает реальные деньги»).
// Новый после регистрации: status trialing, period_end null, платёжки нет.
export function isReturningCustomer(p: {
  subscription_status?: string | null
  current_period_end?: string | null
  provider_subscription_id?: string | null
  payment_provider?: string | null
}): boolean {
  if (p.current_period_end) return true
  if (p.provider_subscription_id || p.payment_provider) return true
  return ['view_only', 'paused', 'canceled', 'past_due', 'expired'].includes(p.subscription_status ?? '')
}
