'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { CreditCard } from 'lucide-react'

// Opens the Stripe Billing Portal (change card / see invoices / cancel). Rendered
// only for Stripe payers — Продамус subscribers manage theirs via the Продамус
// email link (see the hint next to this button's render site in settings).
export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false)

  const open = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const d = await res.json().catch(() => ({} as { url?: string; error?: string }))
      if (res.ok && d.url) {
        window.location.href = d.url
        return
      }
      toast.error(d.error === 'no_subscription'
        ? 'Активная подписка не найдена'
        : 'Не удалось открыть управление подпиской — попробуй позже')
    } catch {
      toast.error('Сеть недоступна — попробуй ещё раз')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={open} disabled={loading} className="gap-2">
      <CreditCard className="h-3.5 w-3.5" />
      {loading ? 'Открываю…' : 'Управлять подпиской'}
    </Button>
  )
}
