import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PricingClient } from '@/components/pricing/PricingClient'
import { PLAN_CONFIG, PAID_PLANS, type PaidPlan } from '@/lib/generations-config'
import { isReturningCustomer } from '@/lib/billing/planState'
import { prodamusLinkNoDemo, prodamusTopupLink } from '@/lib/billing/prodamus'
import type { SubscriptionPlan } from '@/lib/generations-config'

export default async function PricingPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, payment_provider, provider_subscription_id, current_period_end, bonus_generations, generations_used, generations_reset_at')
    .eq('id', session.user.id)
    .single()

  const currentPlan = (profile?.subscription_tier ?? 'trial') as SubscriptionPlan
  // Возвращающийся клиент (06.09): картой РФ продаём только через продукт без
  // демо — пока ссылки нет в env, кнопка на витрине выключена. Докупка — тоже
  // по своей ссылке. Stripe (зарубежная карта) без демо уже работает.
  const returning = profile ? isReturningCustomer(profile) : false
  const ruReady = Object.fromEntries(PAID_PLANS.map((p: PaidPlan) => [p, {
    buy: returning ? !!prodamusLinkNoDemo(p) : true,
    topup: !!prodamusTopupLink(p),
  }])) as Record<PaidPlan, { buy: boolean; topup: boolean }>

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2">Тарифные планы</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Специально для блогеров и экспертов. Выбери план — и Ava поможет тебе создавать контент, прогревы и стратегии быстрее.
        </p>
      </div>
      <PricingClient
        userEmail={session.user.email ?? ''}
        currentPlan={currentPlan}
        subscriptionStatus={profile?.subscription_status ?? null}
        returning={returning}
        ruReady={ruReady}
        paymentProvider={profile?.payment_provider ?? null}
        bonusGenerations={profile?.bonus_generations ?? 0}
        generationsUsed={profile?.generations_used ?? 0}
        monthlyLimit={PLAN_CONFIG[currentPlan].generations}
        plans={PLAN_CONFIG}
        resetAt={profile?.generations_reset_at ?? null}
      />
    </div>
  )
}
