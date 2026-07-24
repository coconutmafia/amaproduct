// Server-only module — uses next/headers via createClient
// For client-safe constants import from '@/lib/generations-config'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
export { PLAN_CONFIG, REFERRAL_REWARDS } from '@/lib/generations-config'
export type { SubscriptionPlan } from '@/lib/generations-config'
import { PLAN_CONFIG, PAID_PLANS } from '@/lib/generations-config'
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

  // Metering RPCs run through the service-role client: EXECUTE on
  // consume_generation / add_bonus_generations is revoked from anon/authenticated
  // (migration 032) so a client can't call them directly with a forged p_user_id
  // (self-grant unlimited bonuses / burn another user's quota). The userId here
  // already comes from an authenticated getUser() in the calling route.
  const { data: allowed, error } = await createAdminClient()
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

  const plan = (profile?.subscription_tier ?? 'trial') as SubscriptionPlan
  const monthlyLimit = PLAN_CONFIG[plan]?.generations ?? 300
  const monthlyUsed = profile?.generations_used ?? 0
  const bonusRemaining = profile?.bonus_generations ?? 0
  const remaining = Math.max(0, monthlyLimit - monthlyUsed) + bonusRemaining

  return { allowed: allowed as boolean, remaining, monthlyUsed, monthlyLimit, bonusRemaining }
}

// ──────────────────────────────────────────────────────
// Enforcement switch — OFF until payment is live (post-launch).
// Pre-launch: usage is METERED (counters tick, real data accrues) but nobody is
// ever BLOCKED, so deploying gating cannot lock out the ~50 free-trial users.
// Flip to hard gating by setting env BILLING_ENFORCED='true' once tariffs +
// payment + the upgrade screen are ready. See PRICING.md.
// ──────────────────────────────────────────────────────
export const BILLING_ENFORCED = process.env.BILLING_ENFORCED === 'true'

export interface GateResult extends GenerationCheckResult {
  blocked: boolean // true ONLY when enforcement is live AND access is denied
  // WHY it was blocked — the two cases need different UI copy:
  //   'not_entitled' — no paid plan / trial over → "подключи тариф"
  //   'quota'        — paying, but this month's units are used up → "лимит исчерпан"
  // Telling a brand-new unpaid user "ты создала все единицы контента" (with 0 used)
  // reads as a lie, so callers must not collapse these into one message.
  reason?: 'not_entitled' | 'quota'
}

// Entitlement — is the account allowed to generate at all, independent of the
// monthly quota? Blocks the launch code-gap where a user kept generating for
// free AFTER the 2-month trial expired (consume_generation only ever checked
// the monthly counter, never trial_ends_at / subscription status).
// Fail-OPEN on any read error or missing data so we never lock out a legit user.
export async function isEntitled(userId: string): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: p } = await supabase
      .from('profiles')
      .select('role, subscription_tier, subscription_status, trial_ends_at, current_period_end')
      .eq('id', userId)
      .single()
    if (!p) return true
    if (p.role === 'admin') return true

    const status = (p.subscription_status as string | null) ?? null
    const tier = (p.subscription_tier as string) ?? 'trial'
    const now = Date.now()

    // Active paying subscription (respect period end if we track it).
    if (status === 'active' && (PAID_PLANS as string[]).includes(tier)) {
      if (p.current_period_end && new Date(p.current_period_end as string).getTime() < now) return false
      return true
    }
    // Trial: entitled only while trial_ends_at is in the future.
    if (status === 'trialing' || status === null) {
      if (!p.trial_ends_at) return true // pre-migration row — don't lock out
      return new Date(p.trial_ends_at as string).getTime() > now
    }
    // past_due / view_only / paused / canceled, or expired trial → not entitled.
    return false
  } catch (e) {
    console.error('isEntitled failed (fail-open):', e)
    return true
  }
}

// One call for every content-PRODUCING route (a finished content unit, a story
// series, a video overlay). Consumes one unit and reports whether to block.
// Refinement/edits, slide/image rendering of already-counted content, and brand
// setup are NOT metered (fair-use) — don't call this there.
export async function gateContentUnit(userId: string): Promise<GateResult> {
  // Check entitlement BEFORE consuming so an un-entitled user (expired trial /
  // lapsed subscription) isn't charged a unit just to be blocked. Only enforced
  // when BILLING_ENFORCED is live — pre-launch this is inert and metering runs.
  if (BILLING_ENFORCED && !(await isEntitled(userId))) {
    const stats = await getGenerationStats(userId)
    return { ...stats, allowed: false, blocked: true, reason: 'not_entitled' }
  }
  const res = await checkAndConsumeGeneration(userId)
  const blocked = BILLING_ENFORCED && !res.allowed
  return { ...res, blocked, ...(blocked ? { reason: 'quota' as const } : {}) }
}

// Multi-unit gate for expensive content (video montage = VIDEO_MONTAGE_UNITS).
// Checks the FULL price up front (no partial charge when remaining < count),
// then consumes unit-by-unit through the same audited RPC. If a later consume
// fails mid-way (race with another tab), the consumed part is refunded — the
// caller either gets the whole price charged or nothing.
export async function gateContentUnits(userId: string, count: number): Promise<GateResult> {
  if (count <= 1) return gateContentUnit(userId)
  if (BILLING_ENFORCED && !(await isEntitled(userId))) {
    const stats = await getGenerationStats(userId)
    return { ...stats, allowed: false, blocked: true, reason: 'not_entitled' }
  }
  const stats = await getGenerationStats(userId)
  if (stats.remaining < count) {
    const blocked = BILLING_ENFORCED
    return { ...stats, allowed: false, blocked, ...(blocked ? { reason: 'quota' as const } : {}) }
  }
  let consumed = 0
  for (; consumed < count; consumed++) {
    const res = await checkAndConsumeGeneration(userId)
    if (!res.allowed) break
  }
  if (consumed < count) {
    if (consumed > 0) await refundGenerations(userId, consumed)
    const after = await getGenerationStats(userId)
    const blocked = BILLING_ENFORCED
    return { ...after, allowed: false, blocked, ...(blocked ? { reason: 'quota' as const } : {}) }
  }
  const after = await getGenerationStats(userId)
  return { ...after, allowed: true, blocked: false }
}

// Refund `count` units at once (video job failed after charging its price).
export async function refundGenerations(userId: string, count: number): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', userId).single()
    if (profile?.role === 'admin') return
    await createAdminClient().rpc('add_bonus_generations', { p_user_id: userId, p_amount: count })
  } catch (e) {
    console.error('refundGenerations failed:', e)
  }
}

// Refund one generation — called when a consumed generation produced nothing
// (project not found, AI error, etc.). Credited as a bonus generation, which
// is consumed first, so it's effectively a full refund and never goes negative.
export async function refundGeneration(userId: string): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', userId).single()
    if (profile?.role === 'admin') return
    // Atomic increment via RPC — avoids the lost-update race a read-modify-write
    // had under concurrent generations (the content plan fires several at once).
    // Runs through the service-role client (EXECUTE revoked from anon/authenticated
    // in migration 032). Refund is credited as a bonus generation.
    await createAdminClient().rpc('add_bonus_generations', { p_user_id: userId, p_amount: 1 })
  } catch (e) {
    console.error('refundGeneration failed:', e)
  }
}

export async function getGenerationStats(userId: string): Promise<GenerationCheckResult> {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, generations_used, bonus_generations, generations_reset_at')
    .eq('id', userId)
    .single()

  const plan = (profile?.subscription_tier ?? 'trial') as SubscriptionPlan
  const monthlyLimit = PLAN_CONFIG[plan]?.generations ?? 300
  const monthlyUsed = profile?.generations_used ?? 0
  const bonusRemaining = profile?.bonus_generations ?? 0
  const remaining = Math.max(0, monthlyLimit - monthlyUsed) + bonusRemaining
  const allowed = remaining > 0

  return { allowed, remaining, monthlyUsed, monthlyLimit, bonusRemaining }
}
