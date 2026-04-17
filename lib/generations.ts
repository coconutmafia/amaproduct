// Server-only module — uses next/headers via createClient
// For client-safe constants import from '@/lib/generations-config'
import { createClient } from '@/lib/supabase/server'
export { PLAN_CONFIG, REFERRAL_REWARDS } from '@/lib/generations-config'
export type { SubscriptionPlan } from '@/lib/generations-config'
import { PLAN_CONFIG } from '@/lib/generations-config'
import type { SubscriptionPlan } from '@/lib/generations-config'

// ──────────────────────────────────────────────────────
// Check + consume one generation (server-side)
// ──────────────────────────────────────────────────────
export interface GenerationCheckResult {
  allowed: boolean
  remaining: number
  monthlyUsed: number
  monthlyLimit: number
  bonusRemaining: number
}

export async function checkAndConsumeGeneration(userId: string): Promise<GenerationCheckResult> {
  const supabase = await createClient()

  // Admins have unlimited generations — skip the counter entirely
  const { data: adminCheck } = await supabase
    .from('profiles').select('role').eq('id', userId).single()
  if (adminCheck?.role === 'admin') {
    return { allowed: true, remaining: 999999, monthlyUsed: 0, monthlyLimit: 999999, bonusRemaining: 0 }
  }

  const { data: allowed, error } = await supabase
    .rpc('consume_generation', { p_user_id: userId })

  if (error) {
    console.error('consume_generation error:', error)
    const isProd = process.env.NODE_ENV === 'production'
    return { allowed: !isProd, remaining: 0, monthlyUsed: 0, monthlyLimit: 0, bonusRemaining: 0 }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, generations_used, bonus_generations, generations_reset_at')
    .eq('id', userId)
    .single()

  const plan = (profile?.subscription_tier ?? 'free') as SubscriptionPlan
  const monthlyLimit = PLAN_CONFIG[plan]?.generations ?? 5
  const monthlyUsed = profile?.generations_used ?? 0
  const bonusRemaining = profile?.bonus_generations ?? 0
  const remaining = Math.max(0, monthlyLimit - monthlyUsed) + bonusRemaining

  return { allowed: allowed as boolean, remaining, monthlyUsed, monthlyLimit, bonusRemaining }
}

export async function getGenerationStats(userId: string): Promise<GenerationCheckResult> {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, generations_used, bonus_generations, generations_reset_at')
    .eq('id', userId)
    .single()

  const plan = (profile?.subscription_tier ?? 'free') as SubscriptionPlan
  const monthlyLimit = PLAN_CONFIG[plan]?.generations ?? 5
  const monthlyUsed = profile?.generations_used ?? 0
  const bonusRemaining = profile?.bonus_generations ?? 0
  const remaining = Math.max(0, monthlyLimit - monthlyUsed) + bonusRemaining
  const allowed = remaining > 0

  return { allowed, remaining, monthlyUsed, monthlyLimit, bonusRemaining }
}
