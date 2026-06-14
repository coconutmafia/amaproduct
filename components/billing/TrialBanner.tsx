'use client'

import { useEffect, useState } from 'react'
import { X, Clock, Lock } from 'lucide-react'
import { showUpgrade, type UpgradeReason } from '@/components/billing/UpgradeDialog'
import { VIEW_ONLY_GRACE_DAYS } from '@/lib/generations-config'

const DAY = 86_400_000

type Kind = 'soon' | 'view_only' | 'paused'

// Thin top bar that nudges toward a paid plan as the trial winds down. Purely
// informational until BILLING_ENFORCED flips on — it reads trial_ends_at and
// derives the display state, but doesn't itself block anything. Renders null for
// active/paying users, fresh trials (>7 days left), and pre-migration profiles
// (no trial_ends_at column yet).
export function TrialBanner({ status, trialEndsAt }: { status?: string | null; trialEndsAt?: string | null }) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try { if (sessionStorage.getItem('ama_trial_banner_dismissed') === '1') setDismissed(true) } catch { /* ignore */ }
  }, [])

  if (status === 'active') return null

  const ends = trialEndsAt ? new Date(trialEndsAt).getTime() : null
  const now = Date.now()

  let kind: Kind | null = null
  let daysLeft = 0
  if (status === 'paused') kind = 'paused'
  else if (status === 'view_only') kind = 'view_only'
  else if ((status === 'trialing' || !status) && ends) {
    const d = Math.ceil((ends - now) / DAY)
    if (d <= 0) kind = now < ends + VIEW_ONLY_GRACE_DAYS * DAY ? 'view_only' : 'paused'
    else if (d <= 7) { kind = 'soon'; daysLeft = d }
  }
  if (!kind) return null

  // Soft states (a heads-up) can be dismissed for the session; hard states stay.
  const dismissible = kind === 'soon'
  if (dismissible && dismissed) return null

  const plural = (n: number) => (n === 1 ? 'день' : n >= 2 && n <= 4 ? 'дня' : 'дней')
  const text =
    kind === 'soon'      ? `Пробный период заканчивается через ${daysLeft} ${plural(daysLeft)}. Выбери тариф, чтобы не потерять доступ.`
    : kind === 'view_only' ? 'Пробный период закончился — контент виден, но генерация на паузе. Подключи тариф, чтобы продолжить.'
    :                      'Доступ на паузе. Подключи тариф — все твои данные на месте.'

  const tone =
    kind === 'soon'      ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:border-amber-400/20'
    :                      'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-400/10 dark:text-rose-200 dark:border-rose-400/20'

  const reason: UpgradeReason = kind === 'soon' ? 'trial' : kind

  return (
    <div className={`flex items-center gap-2 border-b px-3 py-2 text-xs sm:text-sm ${tone}`}>
      {kind === 'soon' ? <Clock className="h-4 w-4 shrink-0" /> : <Lock className="h-4 w-4 shrink-0" />}
      <span className="flex-1 leading-snug">{text}</span>
      <button
        type="button"
        onClick={() => showUpgrade(reason)}
        className="shrink-0 rounded-md bg-foreground/90 px-2.5 py-1 text-[11px] font-semibold text-background hover:bg-foreground"
      >
        Выбрать тариф
      </button>
      {dismissible && (
        <button
          type="button"
          aria-label="Скрыть"
          onClick={() => { setDismissed(true); try { sessionStorage.setItem('ama_trial_banner_dismissed', '1') } catch { /* ignore */ } }}
          className="shrink-0 rounded p-1 hover:bg-foreground/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
