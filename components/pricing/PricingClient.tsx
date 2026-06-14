'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { CheckCircle2, Zap, Star, Building2, Gift } from 'lucide-react'
import type { SubscriptionTier, PaidPlan } from '@/lib/generations-config'
import { PLAN_CONFIG, PAID_PLANS } from '@/lib/generations-config'

const PLAN_ICONS: Record<PaidPlan, React.ReactNode> = {
  solo:     <Star className="h-5 w-5" />,
  pro:      <Zap className="h-5 w-5" />,
  producer: <Building2 className="h-5 w-5" />,
}

const PLAN_COLORS: Record<PaidPlan, string> = {
  solo:     'border-primary/40 ring-1 ring-primary/30', // hero
  pro:      'border-blue-200 dark:border-blue-400/30',
  producer: 'border-amber-200 dark:border-amber-400/30',
}

interface Props {
  currentPlan: SubscriptionTier
  bonusGenerations: number
  generationsUsed: number
  monthlyLimit: number
  plans: typeof PLAN_CONFIG
  resetAt: string | null
}

export function PricingClient({
  currentPlan, bonusGenerations, generationsUsed, monthlyLimit, plans, resetAt,
}: Props) {
  const [upgrading, setUpgrading] = useState<PaidPlan | null>(null)

  const handleUpgrade = async (plan: PaidPlan) => {
    if (plan === currentPlan) return
    setUpgrading(plan)
    // TODO (Фаза 2): redirect to Продамус (РФ) / Stripe (мир) checkout.
    toast.info(`Оплата подключается. Напиши в поддержку для активации тарифа «${plans[plan].label}».`)
    setUpgrading(null)
  }

  const current = plans[currentPlan]
  const unlimited = current.unlimited
  const monthlyPct = unlimited ? 0 : Math.min(100, Math.round((generationsUsed / Math.max(1, monthlyLimit)) * 100))
  const resetDate = resetAt
    ? new Date(resetAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : '—'

  return (
    <div className="space-y-8">
      {/* Current usage */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-sm">Текущий план: <span>{current.label}</span></span>
            </div>
            {bonusGenerations > 0 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-400/10 gap-1">
                <Gift className="h-3 w-3" />
                +{bonusGenerations} бонусных
              </Badge>
            )}
          </div>
          {unlimited ? (
            <p className="text-xs text-muted-foreground">
              Создано в этом месяце: {generationsUsed}. Лимит: безлимит (fair use). Сброс счётчика {resetDate}.
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Создано единиц контента в этом месяце</span>
                <span>{generationsUsed} / {monthlyLimit}</span>
              </div>
              <Progress value={monthlyPct} className="h-1.5" />
              <p className="text-xs text-muted-foreground">Сброс {resetDate}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan cards — Solo is the hero */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PAID_PLANS.map((key) => {
          const cfg = plans[key]
          const isCurrent = key === currentPlan

          return (
            <Card
              key={key}
              className={`overflow-visible flex flex-col ${PLAN_COLORS[key]} ${isCurrent ? 'bg-primary/5' : 'bg-card'}`}
            >
              <CardHeader className="pb-4 pt-5">
                {cfg.badge && (
                  <Badge className="self-start mb-2 bg-primary/15 text-primary border-primary/30 text-xs">{cfg.badge}</Badge>
                )}
                <div className="flex items-center gap-2 mb-2 text-primary">
                  {PLAN_ICONS[key]}
                  <CardTitle className="text-base">{cfg.label}</CardTitle>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold">{cfg.priceRub.toLocaleString('ru-RU')} ₽</span>
                  <span className="text-muted-foreground text-sm mb-1">/мес</span>
                </div>
                <CardDescription className="text-xs">
                  {cfg.unlimited ? 'Безлимит генераций' : `~${cfg.generations} единиц контента`} · {cfg.projects === -1 ? '∞' : cfg.projects} {cfg.projects === 1 ? 'проект' : cfg.projects <= 4 ? 'проекта' : 'проектов'}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col flex-1 gap-4">
                <ul className="space-y-2 flex-1">
                  {cfg.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={isCurrent ? 'outline' : key === 'solo' ? 'default' : 'outline'}
                  disabled={isCurrent || upgrading !== null}
                  onClick={() => handleUpgrade(key)}
                >
                  {upgrading === key
                    ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    : isCurrent
                    ? 'Текущий план'
                    : `Подключить «${cfg.label}»`
                  }
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Bonuses note */}
      <Card>
        <CardContent className="p-5">
          <div className="flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/20 text-xs">
            <Gift className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground mb-1">Бонусные единицы не сгорают</p>
              <p className="text-muted-foreground">Начисляются по промокодам и акциям. Расходуются после исчерпания месячного лимита.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
