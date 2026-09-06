import type { createAdminClient } from '@/lib/supabase/admin'
import { PLAN_CONFIG, type PaidPlan } from '@/lib/generations-config'
import { tierBudgetUsd } from '@/lib/billing/costCap'
import { recordUnits } from '@/lib/billing/unitLedger'

// Докупка объёма тарифа раньше срока (мандат Матвея 06.09: «если использовала
// раньше — возможность заново оформить»). Разовый платёж, рекуррент не
// трогаем: +единицы тарифа бонусом и +ресурс AI тарифа до конца текущего
// периода (иначе кап закрыл бы доступ раньше единиц).
export async function grantTopup(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  plan: PaidPlan,
): Promise<{ units: number }> {
  const units = PLAN_CONFIG[plan].generations
  await admin.rpc('add_bonus_generations', { p_user_id: userId, p_amount: units })
  const { data: p } = await admin.from('profiles').select('current_period_end, budget_boost_usd, budget_boost_until').eq('id', userId).maybeSingle()
  const until = p?.current_period_end && new Date(p.current_period_end as string).getTime() > Date.now()
    ? new Date(p.current_period_end as string)
    : new Date(Date.now() + 30 * 24 * 3600 * 1000)
  const prevActive = p?.budget_boost_until && new Date(p.budget_boost_until as string).getTime() > Date.now() ? Number(p.budget_boost_usd ?? 0) : 0
  await admin.from('profiles').update({ budget_boost_usd: prevActive + tierBudgetUsd(plan), budget_boost_until: until.toISOString() }).eq('id', userId)
  await recordUnits(userId, 'topup', -units, { plan })
  return { units }
}
