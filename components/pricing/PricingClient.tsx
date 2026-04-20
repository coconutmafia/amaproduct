'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { CheckCircle2, Zap, Star, Building2, Sparkles, Gift, Users } from 'lucide-react'
import type { SubscriptionPlan } from '@/lib/generations-config'
import { PLAN_CONFIG } from '@/lib/generations-config'

const PLAN_ICONS: Record<SubscriptionPlan, React.ReactNode> = {
  free:    <Sparkles className="h-5 w-5" />,
  starter: <Zap className="h-5 w-5" />,
  pro:     <Star className="h-5 w-5" />,
  agency:  <Building2 className="h-5 w-5" />,
}

const PLAN_COLORS: Record<SubscriptionPlan, string> = {
  free:    'border-border',
  starter: 'border-blue-200 dark:border-blue-400/30',
  pro:     'border-primary/40 ring-1 ring-primary/30',
  agency:  'border-amber-200 dark:border-amber-400/30',
}

const PLAN_BADGE: Record<SubscriptionPlan, string | null> = {
  free:    null,
  starter: null,
  pro:     'Популярный',
  agency:  'Для команд',
}

interface Props {
  currentPlan: SubscriptionPlan
  bonusGenerations: number
  generationsUsed: number
  monthlyLimit: number
  plans: typeof PLAN_CONFIG
  resetAt: string | null
}

export function PricingClient({
  currentPlan, bonusGenerations, generationsUsed, monthlyLimit, plans, resetAt,
}: Props) {
  const [upgrading, setUpgrading] = useState<SubscriptionPlan | null>(null)

  const handleUpgrade = async (plan: SubscriptionPlan) => {
    if (plan === currentPlan) return
    setUpgrading(plan)
    // TODO: integrate with Stripe/LemonSqueezy payment link
    // For now show a toast
    toast.info(`Подключение к платёжной системе скоро. Напишите в поддержку для ручной активации ${plan}.`)
    setUpgrading(null)
  }

  const monthlyPct = Math.min(100, Math.round((generationsUsed / monthlyLimit) * 100))
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
              <span className="font-medium text-sm">Текущий план: <span className="capitalize">{plans[currentPlan].label}</span></span>
            </div>
            {bonusGenerations > 0 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-400/10 gap-1">
                <Gift className="h-3 w-3" />
                +{bonusGenerations} бонусных
              </Badge>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Использовано запросов в этом месяце</span>
              <span>{generationsUsed} / {monthlyLimit}</span>
            </div>
            <Progress value={monthlyPct} className="h-1.5" />
            <p className="text-xs text-muted-foreground">Сброс {resetDate}</p>
          </div>
        </CardContent>
      </Card>

      {/* Plan cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(Object.entries(plans) as [SubscriptionPlan, typeof plans[SubscriptionPlan]][]).map(([key, cfg]) => {
          const isCurrent = key === currentPlan
          const badge = PLAN_BADGE[key]

          return (
            <Card
              key={key}
              className={`overflow-visible flex flex-col ${PLAN_COLORS[key]} ${isCurrent ? 'bg-primary/5' : 'bg-card'}`}
            >
              <CardHeader className="pb-4 pt-5">
                {badge && (
                  <Badge className="self-start mb-2 bg-primary/15 text-primary border-primary/30 text-xs">{badge}</Badge>
                )}
                <div className="flex items-center gap-2 mb-2 text-primary">
                  {PLAN_ICONS[key]}
                  <CardTitle className="text-base">{cfg.label}</CardTitle>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold">${cfg.price}</span>
                  <span className="text-muted-foreground text-sm mb-1">/мес</span>
                </div>
                <CardDescription className="text-xs">
                  {cfg.generations} {cfg.generations === 5 ? 'запроса' : 'запросов'} к AI · {cfg.projects === -1 ? '∞' : cfg.projects} {cfg.projects === 1 ? 'проект' : cfg.projects <= 4 ? 'проекта' : 'проектов'}
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
                  variant={isCurrent ? 'outline' : key === 'pro' ? 'default' : 'outline'}
                  disabled={isCurrent || upgrading !== null}
                  onClick={() => handleUpgrade(key)}
                >
                  {upgrading === key
                    ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    : isCurrent
                    ? 'Текущий план'
                    : key === 'free'
                    ? 'Перейти на Free'
                    : `Подключить ${cfg.label}`
                  }
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Bonuses and referral */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4 text-xs">
            <div className="flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/20">
              <Gift className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground mb-1">Бонусные запросы не сгорают</p>
                <p className="text-muted-foreground">Накапливаются от реферальной программы и акций. Расходуются после исчерпания месячного лимита.</p>
              </div>
            </div>
            <div className="flex gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Users className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground mb-1">Приглашай друзей — получай бонусы</p>
                <p className="text-muted-foreground">Поделись своей ссылкой: когда друг зарегистрируется — ты получишь +10 запросов, а при покупке тарифа — ещё +25.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
