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
