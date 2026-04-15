import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/referral — get current user's referral code + stats
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get profile with referral code
    const { data: profile } = await supabase
      .from('profiles')
      .select('referral_code, subscription_tier, subscription_expires_at, bonus_days_earned')
      .eq('id', user.id)
      .single()

    // Get referrals list
    const { data: referrals } = await supabase
      .from('referrals')
      .select(`
        id,
        status,
        referrer_reward_value,
        referrer_reward_given,
        referred_discount_percent,
        created_at,
        activated_at,
        rewarded_at,
        referred_id
      `)
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false })

    // Compute stats
    const total = referrals?.length || 0
    const active = referrals?.filter((r) => ['active', 'rewarded'].includes(r.status)).length || 0
    const rewarded = referrals?.filter((r) => r.referrer_reward_given).length || 0
    const totalBonusDays = referrals?.reduce((sum, r) => {
      return sum + (r.referrer_reward_given ? r.referrer_reward_value : 0)
    }, 0) || 0

    // Fetch referred user emails separately for display
    const referredIds = (referrals || []).map((r) => r.referred_id).filter(Boolean)
    let referredProfiles: Array<{ id: string; full_name: string | null; email: string }> = []

    if (referredIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', referredIds)
      referredProfiles = profiles || []
    }

    const referralsWithProfiles = (referrals || []).map((r) => {
      const referred = referredProfiles.find((p) => p.id === r.referred_id)
      return {
        ...r,
        referred_profile: referred
          ? { full_name: referred.full_name, email: referred.email }
          : null,
      }
    })

    return NextResponse.json({
      referral_code: profile?.referral_code || null,
      subscription_tier: profile?.subscription_tier || 'free',
      subscription_expires_at: profile?.subscription_expires_at || null,
      bonus_days_earned: profile?.bonus_days_earned || 0,
      stats: { total, active, rewarded, total_bonus_days: totalBonusDays },
      referrals: referralsWithProfiles,
    })
  } catch (error) {
    console.error('Referral GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch referral data' }, { status: 500 })
  }
}

// POST /api/referral — register a referral when new user signs up with a code
// Body: { referralCode: string }
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { referralCode, utmSource, utmMedium } = body

    if (!referralCode) {
      return NextResponse.json({ error: 'referralCode required' }, { status: 400 })
    }

    // Check if already referred
    const { data: existingReferral } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_id', user.id)
      .maybeSingle()

    if (existingReferral) {
      return NextResponse.json({ error: 'Already referred' }, { status: 409 })
    }

    // Find the referrer by code
    const { data: referrer } = await supabase
      .from('profiles')
      .select('id, referral_code')
      .eq('referral_code', referralCode.toUpperCase())
      .maybeSingle()

    if (!referrer) {
      return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 })
    }

    // Can't refer yourself
    if (referrer.id === user.id) {
      return NextResponse.json({ error: 'Cannot use your own referral code' }, { status: 400 })
    }

    // Create referral record
    const { data: referral, error } = await supabase
      .from('referrals')
      .insert({
        referrer_id: referrer.id,
        referred_id: user.id,
        referral_code: referralCode.toUpperCase(),
        status: 'registered',
        referrer_reward_type: 'bonus_days',
        referrer_reward_value: 30,
        referred_discount_percent: 20,
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
      })
      .select()
      .single()

    if (error) throw error

    // Update referred user's profile with referred_by
    await supabase
      .from('profiles')
      .update({ referred_by: referrer.id })
      .eq('id', user.id)

    return NextResponse.json({ referral, discount_percent: 20 })
  } catch (error) {
    console.error('Referral POST error:', error)
    return NextResponse.json({ error: 'Failed to register referral' }, { status: 500 })
  }
}

// PATCH /api/referral — activate reward (called when referred user upgrades to paid)
// Body: { action: 'activate' | 'reward', referredUserId: string }
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only admin can trigger reward activation
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { action, referredUserId } = body

    const { data: referral } = await supabase
      .from('referrals')
      .select('*')
      .eq('referred_id', referredUserId)
      .maybeSingle()

    if (!referral) return NextResponse.json({ error: 'Referral not found' }, { status: 404 })

    if (action === 'activate') {
      await supabase
        .from('referrals')
        .update({ status: 'active', activated_at: new Date().toISOString() })
        .eq('id', referral.id)
    } else if (action === 'reward') {
      // Give reward to referrer
      await supabase
        .from('referrals')
        .update({
          status: 'rewarded',
          referrer_reward_given: true,
          rewarded_at: new Date().toISOString(),
        })
        .eq('id', referral.id)

      // Add bonus days to referrer's profile
      const { data: referrerProfile } = await supabase
        .from('profiles')
        .select('bonus_days_earned, subscription_expires_at')
        .eq('id', referral.referrer_id)
        .single()

      if (referrerProfile) {
        const currentExpiry = referrerProfile.subscription_expires_at
          ? new Date(referrerProfile.subscription_expires_at)
          : new Date()

        const newExpiry = new Date(currentExpiry)
        newExpiry.setDate(newExpiry.getDate() + referral.referrer_reward_value)

        await supabase
          .from('profiles')
          .update({
            bonus_days_earned: (referrerProfile.bonus_days_earned || 0) + referral.referrer_reward_value,
            subscription_expires_at: newExpiry.toISOString(),
          })
          .eq('id', referral.referrer_id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Referral PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update referral' }, { status: 500 })
  }
}
