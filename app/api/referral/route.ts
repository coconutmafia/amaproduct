import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { REFERRAL_REWARDS } from '@/lib/generations'

// ──────────────────────────────────────────────────────
// GET — current user's referral stats + list
// ──────────────────────────────────────────────────────
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: stats } = await supabase
      .from('referral_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    const { data: referrals } = await supabase
      .from('referrals')
      .select('id, level, status, signup_bonus_given, payment_bonus_given, created_at')
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false })

    return NextResponse.json({ stats, referrals: referrals || [] })
  } catch (error) {
    console.error('Referral GET error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────
// POST /api/referral?action=register
//   body: { referral_code }  — called right after signup
//
// POST /api/referral?action=payment
//   body: { user_id }        — called when a user upgrades (admin or self)
// ──────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Register referral / apply promo at signup ────
    if (action === 'register') {
      const { referral_code } = await request.json()
      if (!referral_code) return NextResponse.json({ error: 'No referral code' }, { status: 400 })

      const codeUpper = referral_code.toUpperCase().trim()

      // ── Check if it's an admin PROMO code first ──
      const { data: promoCode } = await supabase
        .from('promo_codes')
        .select('id, bonus_generations, max_uses, uses_count, is_active, expires_at')
        .eq('code', codeUpper)
        .single()

      if (promoCode) {
        if (!promoCode.is_active)
          return NextResponse.json({ error: 'Промо-код деактивирован' }, { status: 400 })
        if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date())
          return NextResponse.json({ error: 'Промо-код просрочен' }, { status: 400 })
        if (promoCode.max_uses !== null && promoCode.uses_count >= promoCode.max_uses)
          return NextResponse.json({ error: 'Промо-код исчерпан' }, { status: 400 })

        // Check not already used by this user
        const { data: alreadyUsed } = await supabase
          .from('promo_code_uses')
          .select('id').eq('promo_id', promoCode.id).eq('user_id', user.id).single()
        if (alreadyUsed)
          return NextResponse.json({ error: 'Вы уже использовали этот промо-код' }, { status: 409 })

        // Apply bonus
        await supabase.rpc('add_bonus_generations', {
          p_user_id: user.id, p_amount: promoCode.bonus_generations,
        })
        await supabase.from('promo_code_uses').insert({ promo_id: promoCode.id, user_id: user.id })
        await supabase.from('promo_codes')
          .update({ uses_count: promoCode.uses_count + 1 }).eq('id', promoCode.id)

        return NextResponse.json({
          success: true,
          bonus_received: promoCode.bonus_generations,
          type: 'promo',
        })
      }

      // ── Regular user referral code ───────────────
      const { data: referrerProfile } = await supabase
        .from('profiles')
        .select('id, referred_by')
        .eq('referral_code', codeUpper)
        .single()

      if (!referrerProfile)
        return NextResponse.json({ error: 'Код не найден' }, { status: 404 })
      if (referrerProfile.id === user.id)
        return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 400 })

      // Check invitee not already referred
      const { data: existing } = await supabase
        .from('referrals')
        .select('id')
        .eq('referred_id', user.id)
        .single()
      if (existing)
        return NextResponse.json({ error: 'Already referred' }, { status: 409 })

      // Create level-1 referral
      await supabase.from('referrals').insert({
        referrer_id:        referrerProfile.id,
        referred_id:        user.id,
        referral_code:      referral_code.toUpperCase(),
        level:              1,
        status:             'registered',
        signup_bonus_given: true,
      })

      // Give invitee +10 bonus generations
      await supabase.rpc('add_bonus_generations', {
        p_user_id: user.id,
        p_amount:  REFERRAL_REWARDS.invitee_signup,
      })

      // Give L1 referrer +10 bonus generations
      await supabase.rpc('add_bonus_generations', {
        p_user_id: referrerProfile.id,
        p_amount:  REFERRAL_REWARDS.referrer_l1_signup,
      })

      // Level-2: if referrer was also referred by someone
      const { data: l1row } = await supabase
        .from('referrals')
        .select('referrer_id')
        .eq('referred_id', referrerProfile.id)
        .eq('level', 1)
        .single()

      if (l1row) {
        await supabase.from('referrals').insert({
          referrer_id:        l1row.referrer_id,
          referred_id:        user.id,
          referral_code:      referral_code.toUpperCase(),
          level:              2,
          status:             'registered',
          signup_bonus_given: true,
        })
        await supabase.rpc('add_bonus_generations', {
          p_user_id: l1row.referrer_id,
          p_amount:  REFERRAL_REWARDS.referrer_l2_signup,
        })
      }

      // Store who referred this user
      await supabase
        .from('profiles')
        .update({ referred_by: referrerProfile.id })
        .eq('id', user.id)

      return NextResponse.json({
        success: true,
        bonus_received: REFERRAL_REWARDS.invitee_signup,
      })
    }

    // ── Payment event ────────────────────────────────
    if (action === 'payment') {
      const body = await request.json()
      const paying_user_id: string = body.user_id ?? user.id

      // Allow admin or self-trigger only
      if (paying_user_id !== user.id) {
        const { data: caller } = await supabase
          .from('profiles').select('role').eq('id', user.id).single()
        if (caller?.role !== 'admin')
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Find all pending payment bonuses for this user
      const { data: refs } = await supabase
        .from('referrals')
        .select('id, referrer_id, level')
        .eq('referred_id', paying_user_id)
        .eq('payment_bonus_given', false)

      if (!refs || refs.length === 0)
        return NextResponse.json({ message: 'No pending payment bonuses' })

      for (const ref of refs) {
        const amount = ref.level === 1
          ? REFERRAL_REWARDS.referrer_l1_payment
          : REFERRAL_REWARDS.referrer_l2_payment

        await supabase.rpc('add_bonus_generations', {
          p_user_id: ref.referrer_id,
          p_amount:  amount,
        })

        await supabase
          .from('referrals')
          .update({ status: 'paid', payment_bonus_given: true })
          .eq('id', ref.id)
      }

      return NextResponse.json({ success: true, bonuses_given: refs.length })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Referral POST error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
