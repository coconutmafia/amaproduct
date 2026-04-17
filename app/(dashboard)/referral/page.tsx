'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  Users, Gift, Copy, Share2, CheckCircle, Clock,
  Zap, ChevronRight, Sparkles, TrendingUp,
} from 'lucide-react'
import { REFERRAL_REWARDS, PLAN_CONFIG } from '@/lib/generations-config'
import type { SubscriptionPlan } from '@/lib/generations-config'

interface ReferralStats {
  user_id: string
  referral_code: string | null
  subscription_tier: string
  bonus_generations: number
  generations_used: number
  generations_reset_at: string
  monthly_limit: number
  total_referrals: number
  level1_referrals: number
  level2_referrals: number
  paid_referrals: number
  total_gens_earned: number
}

interface ReferralRow {
  id: string
  level: 1 | 2
  status: 'registered' | 'paid' | 'expired'
  signup_bonus_given: boolean
  payment_bonus_given: boolean
  created_at: string
}

export default function ReferralPage() {
  const [stats, setStats]       = useState<ReferralStats | null>(null)
  const [referrals, setReferrals] = useState<ReferralRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [copied, setCopied]     = useState(false)
  const [refInput, setRefInput] = useState('')
  const [applyingRef, setApplyingRef] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/referral')
    if (res.ok) {
      const data = await res.json()
      setStats(data.stats)
      setReferrals(data.referrals || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const refLink = stats?.referral_code ? `${appUrl}/register?ref=${stats.referral_code}` : ''

  const copyLink = () => {
    if (!refLink) return
    navigator.clipboard.writeText(refLink)
    setCopied(true)
    toast.success('Ссылка скопирована!')
    setTimeout(() => setCopied(false), 2000)
  }

  const applyReferral = async () => {
    if (!refInput.trim()) return
    setApplyingRef(true)
    try {
      const res = await fetch('/api/referral?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: refInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      toast.success(`Код применён! +${data.bonus_received} генераций начислено`)
      setRefInput('')
      load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка применения кода')
    } finally {
      setApplyingRef(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const plan = (stats?.subscription_tier ?? 'free') as SubscriptionPlan
  const planCfg = PLAN_CONFIG[plan]
  const monthlyUsed = stats?.generations_used ?? 0
  const monthlyLimit = stats?.monthly_limit ?? 5
  const bonusRemaining = stats?.bonus_generations ?? 0
  const monthlyPct = Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100))
  const resetDate = stats?.generations_reset_at
    ? new Date(stats.generations_reset_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : '—'

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Реферальная программа</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Приглашай друзей — зарабатывай бонусные генерации
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего приглашено</p>
            <p className="text-2xl font-bold">{stats?.total_referrals ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.level1_referrals ?? 0} прямых · {stats?.level2_referrals ?? 0} ур.2
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Оплатили</p>
            <p className="text-2xl font-bold text-green-600">{stats?.paid_referrals ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">перешли на платный план</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Заработано генераций</p>
            <p className="text-2xl font-bold text-primary">{stats?.total_gens_earned ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">за всё время</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Бонус на счету</p>
            <p className="text-2xl font-bold text-amber-600">{bonusRemaining}</p>
            <p className="text-xs text-muted-foreground mt-1">генераций сейчас</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Referral link block */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              Твоя реферальная ссылка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats?.referral_code ? (
              <>
                <div className="flex gap-2">
                  <Input value={refLink} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={copyLink}>
                    {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs font-mono tracking-widest">
                    {stats.referral_code}
                  </Badge>
                  <span className="text-xs text-muted-foreground">— код для ручного ввода</span>
                </div>
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    Приглашённый получает <span className="text-foreground font-medium">+{REFERRAL_REWARDS.invitee_signup} генераций</span> сразу
                  </div>
                  <div className="flex items-center gap-2">
                    <Gift className="h-3.5 w-3.5 text-primary shrink-0" />
                    Ты получаешь <span className="text-foreground font-medium">+{REFERRAL_REWARDS.referrer_l1_signup} генераций</span> при регистрации
                  </div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    Ты получаешь <span className="text-foreground font-medium">+{REFERRAL_REWARDS.referrer_l1_payment} генераций</span> при первой оплате
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-border">
                    <Users className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span>2 уровень: когда твой реферал кого-то пригласит — ты тоже получишь
                      <span className="text-foreground font-medium"> +{REFERRAL_REWARDS.referrer_l2_signup}</span> /
                      <span className="text-foreground font-medium"> +{REFERRAL_REWARDS.referrer_l2_payment}</span> генераций</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Реферальный код не найден. Обновите страницу.</p>
            )}
          </CardContent>
        </Card>

        {/* Apply referral code */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Применить реферальный код
            </CardTitle>
            <CardDescription className="text-xs">
              Если вас пригласил друг — введите его код и получите бонусные генерации
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Например: AMA3X9PQ"
                value={refInput}
                onChange={e => setRefInput(e.target.value.toUpperCase())}
                className="font-mono"
                maxLength={8}
              />
              <Button onClick={applyReferral} disabled={applyingRef || !refInput.trim()}>
                {applyingRef ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : 'Применить'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Код можно применить только один раз и только для своего аккаунта.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Generations counter */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              Использование генераций
            </CardTitle>
            <Badge variant="outline" className="text-xs capitalize">{planCfg.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Месячный лимит</span>
              <span className="font-medium">{monthlyUsed} / {monthlyLimit}</span>
            </div>
            <Progress value={monthlyPct} className="h-2" />
            <p className="text-xs text-muted-foreground">Сброс {resetDate}</p>
          </div>
          {bonusRemaining > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/20 p-3">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <Gift className="h-4 w-4" />
                Бонусных генераций
              </div>
              <span className="font-bold text-amber-700 dark:text-amber-400">+{bonusRemaining}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Referrals list */}
      {referrals.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Приглашённые ({referrals.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {referrals.map(ref => (
                <div key={ref.id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs">
                      {ref.level === 1 ? 'Ур. 1' : 'Ур. 2'}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(ref.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ref.signup_bonus_given && (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50 dark:bg-green-400/10">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        +{ref.level === 1 ? REFERRAL_REWARDS.referrer_l1_signup : REFERRAL_REWARDS.referrer_l2_signup} при регистрации
                      </Badge>
                    )}
                    {ref.payment_bonus_given ? (
                      <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-400/10">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        +{ref.level === 1 ? REFERRAL_REWARDS.referrer_l1_payment : REFERRAL_REWARDS.referrer_l2_payment} при оплате
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 mr-1" />
                        Ожидает оплаты
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pricing teaser */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">Нужно больше генераций?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Тарифы от $19/мес — до 800 генераций в месяц
            </p>
          </div>
          <Button variant="default" size="sm" asChild>
            <a href="/pricing">
              Посмотреть тарифы <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
