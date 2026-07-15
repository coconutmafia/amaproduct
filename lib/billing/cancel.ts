// Cross-provider subscription cancellation.
//
// A profile stores ONE provider_subscription_id, but a user who switched regions
// can have a stored id from EITHER provider. When a new subscription arrives we
// must cancel the previous one so the customer isn't billed twice — but we have
// to route the cancel to the RIGHT provider. Feeding a Stripe id to Продамус (or
// vice-versa) silently no-ops and leaves the old subscription billing forever
// (double-charge). Dispatch by id shape: Stripe ids are prefixed (`sub_`/`cus_`),
// Продамус subscription ids are purely numeric.
import { getStripe, stripeConfigured } from './stripe'
import { prodamusDeactivateSubscription } from './prodamus'

export function subscriptionProviderOf(subId: string): 'stripe' | 'prodamus' {
  return /^(sub_|cus_)/.test(String(subId)) ? 'stripe' : 'prodamus'
}

// Best-effort: returns { ok:false } on any failure — the caller logs it and
// continues (a failed cancel just leaves the old sub, the pre-existing state).
export async function cancelSubscriptionAnyProvider(
  subId: string,
  customerEmail?: string,
): Promise<{ ok: boolean; provider: 'stripe' | 'prodamus'; detail?: string }> {
  const provider = subscriptionProviderOf(subId)
  try {
    if (provider === 'stripe') {
      if (!stripeConfigured()) return { ok: false, provider, detail: 'stripe_not_configured' }
      await getStripe().subscriptions.cancel(String(subId))
      return { ok: true, provider }
    }
    const r = await prodamusDeactivateSubscription(String(subId), customerEmail)
    return { ok: r.ok, provider, detail: r.detail }
  } catch (e) {
    return { ok: false, provider, detail: e instanceof Error ? e.message : 'error' }
  }
}
