import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PricingClient } from '@/components/pricing/PricingClient'
import { PLAN_CONFIG } from '@/lib/generations-config'
import type { SubscriptionPlan } from '@/lib/generations-config'

export default async function PricingPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, bonus_generations, generations_used, generations_reset_at')
    .eq('id', session.user.id)
    .single()

  const currentPlan = (profile?.subscription_tier ?? 'free') as SubscriptionPlan

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2">Тарифные планы</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Специально для блогеров и экспертов. Выбери план — и Ava поможет тебе создавать контент, прогревы и стратегии быстрее.
        </p>
      </div>
      <PricingClient
        currentPlan={currentPlan}
        bonusGenerations={profile?.bonus_generations ?? 0}
        generationsUsed={profile?.generations_used ?? 0}
        monthlyLimit={PLAN_CONFIG[currentPlan].generations}
        plans={PLAN_CONFIG}
        resetAt={profile?.generations_reset_at ?? null}
      />
    </div>
  )
}
