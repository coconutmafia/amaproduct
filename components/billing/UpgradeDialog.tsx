'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Star, Zap, Building2 } from 'lucide-react'
import { PLAN_CONFIG, PAID_PLANS, type PaidPlan } from '@/lib/generations-config'

export type UpgradeReason = 'limit' | 'trial' | 'view_only' | 'paused'

const ICONS: Record<PaidPlan, React.ReactNode> = {
  solo:     <Star className="h-4 w-4" />,
  pro:      <Zap className="h-4 w-4" />,
  producer: <Building2 className="h-4 w-4" />,
}

const REASON_COPY: Record<UpgradeReason, { title: string; desc: string }> = {
  limit:     { title: 'Лимит на этот месяц исчерпан', desc: 'Ты создала все единицы контента в этом месяце. Подключи тариф — и продолжай без пауз.' },
  trial:     { title: 'Пробный период заканчивается', desc: 'Выбери тариф, чтобы не потерять доступ к контенту и генерации.' },
  view_only: { title: 'Пробный период закончился', desc: 'Контент виден, но генерация на паузе. Подключи тариф, чтобы продолжить создавать.' },
  paused:    { title: 'Доступ на паузе', desc: 'Подключи тариф — все твои данные и контент на месте.' },
}

const SHOW_EVENT = 'ama:show-upgrade'

// Open the upgrade dialog from anywhere (e.g. a 402 handler or the trial banner).
// A single <UpgradeDialogHost/> in the dashboard layout listens for this.
export function showUpgrade(reason: UpgradeReason = 'limit') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { reason } }))
  }
}

export function UpgradeDialog({
  open, onOpenChange, reason = 'limit',
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  reason?: UpgradeReason
}) {
  const copy = REASON_COPY[reason] ?? REASON_COPY.limit

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.desc}</DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-3 gap-3">
          {PAID_PLANS.map((key) => {
            const cfg = PLAN_CONFIG[key]
            const hero = key === 'solo'
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 flex flex-col gap-3 ${hero ? 'border-primary/40 ring-1 ring-primary/30 bg-primary/5' : 'border-border'}`}
              >
                {cfg.badge
                  ? <Badge className="self-start bg-primary/15 text-primary border-primary/30 text-[10px]">{cfg.badge}</Badge>
                  : <span className="h-[18px]" />}
                <div className="flex items-center gap-2 text-primary">
                  {ICONS[key]}
                  <span className="font-semibold text-sm">{cfg.label}</span>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-2xl font-bold">{cfg.priceRub.toLocaleString('ru-RU')} ₽</span>
                  <span className="text-muted-foreground text-xs mb-0.5">/мес</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {cfg.unlimited ? 'Безлимит генераций' : `~${cfg.generations} единиц/мес`}
                </p>
                <ul className="space-y-1.5 flex-1">
                  {cfg.features.slice(0, 4).map(f => (
                    <li key={f} className="flex gap-1.5 text-[11px] text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        <Button
          className="w-full"
          onClick={() => { onOpenChange(false); window.location.href = '/pricing' }}
        >
          Выбрать тариф
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// Mounted ONCE in the dashboard layout. Any showUpgrade() call opens it.
export function UpgradeDialogHost() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<UpgradeReason>('limit')

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { reason?: UpgradeReason } | undefined
      setReason(detail?.reason ?? 'limit')
      setOpen(true)
    }
    window.addEventListener(SHOW_EVENT, handler)
    return () => window.removeEventListener(SHOW_EVENT, handler)
  }, [])

  return <UpgradeDialog open={open} onOpenChange={setOpen} reason={reason} />
}
