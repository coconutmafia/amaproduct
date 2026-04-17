'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { CheckCircle2, Zap, Star, Building2, Sparkles, Gift } from 'lucide-react'
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
              <span>Использовано в этом месяце</span>
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
              className={`relative flex flex-col ${PLAN_COLORS[key]} ${isCurrent ? 'bg-primary/5' : 'bg-card'}`}
            >
              {badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground text-xs px-3">{badge}</Badge>
                </div>
              )}

              <CardHeader className="pb-4 pt-5">
                <div className="flex items-center gap-2 mb-2 text-primary">
                  {PLAN_ICONS[key]}
                  <CardTitle className="text-base">{cfg.label}</CardTitle>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold">${cfg.price}</span>
                  <span className="text-muted-foreground text-sm mb-1">/мес</span>
                </div>
                <CardDescription className="text-xs">
                  {cfg.generations} генераций · {cfg.projects === -1 ? '∞' : cfg.projects} {cfg.projects === 1 ? 'проект' : 'проектов'}
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

      {/* Cost transparency */}
      <Card className="border-border">
        <CardContent className="p-5">
          <h3 className="font-semibold text-sm mb-3">Почему именно такие тарифы?</h3>
          <div className="grid sm:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="text-foreground font-medium mb-1">Себестоимость</p>
              <p>Каждая генерация стоит ~$0.03–0.05 в API (Claude + OpenAI embeddings). Тарифы покрывают эти расходы с разумной маржой.</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">Бонусные генерации</p>
              <p>Не сгорают в конце месяца. Накапливаются от рефералов и акций. Расходуются после исчерпания месячного лимита.</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">Реферальная программа</p>
              <p>Приглашай коллег — получай +10 при регистрации и +25 при их первой оплате. 2 уровень: +5 и +12.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
