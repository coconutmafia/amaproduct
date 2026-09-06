import type { createAdminClient } from '@/lib/supabase/admin'

// Биллинговый период единиц = месяц ОТ ОПЛАТЫ (мандат Матвея 06.09), а не
// календарный: раньше оплата 25-го давала 300 единиц за 5 дней + ещё 300 с
// 1-го числа — почти двойной объём и до 2× себестоимости на один платёж.
// Вызывается вебхуками обеих платёжек при НОВОМ периоде (успешная оплата):
// счётчики в ноль, следующий сброс — в дату следующего списания.
export async function startBillingPeriod(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  periodEnd: Date,
): Promise<void> {
  const base = { generations_used: 0, micro_actions_count: 0, generations_reset_at: periodEnd.toISOString() }
  // period_started_at — миграция 047; до неё пишем без колонки (кап считает по календарю)
  const { error } = await admin.from('profiles').update({ ...base, period_started_at: new Date().toISOString() }).eq('id', userId)
  if (error) await admin.from('profiles').update(base).eq('id', userId)
}
