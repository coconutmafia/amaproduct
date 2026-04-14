'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  Users,
  Gift,
  Copy,
  Share2,
  CheckCircle,
  Clock,
  TrendingUp,
  Zap,
  Star,
  ExternalLink,
  MessageCircle,
  Globe,
  ChevronRight,
} from 'lucide-react'
import type { Referral } from '@/types'

interface ReferralData {
  referral_code: string | null
  subscription_tier: string
  subscription_expires_at: string | null
  bonus_days_earned: number
  stats: {
    total: number
    active: number
    rewarded: number
    total_bonus_days: number
  }
  referrals: Array<Referral & { referred_profile: { full_name: string | null; email: string } | null }>
}

const STATUS_CONFIG = {
  registered: { label: 'Зарегистрирован', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  active: { label: 'Активный', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
  rewarded: { label: 'Награда выдана', color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
  expired: { label: 'Истёк', color: 'bg-muted text-muted-foreground border-border' },
}

const TIER_CONFIG = {
  free: { label: 'Free', color: 'text-muted-foreground' },
  pro: { label: 'Pro', color: 'text-primary' },
  agency: { label: 'Agency', color: 'text-yellow-400' },
}

export default function ReferralPage() {
  const [data, setData] = useState<ReferralData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [referralInput, setReferralInput] = useState('')
  const [applyingCode, setApplyingCode] = useState(false)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pro-duct.app'

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/referral')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setData(json)
    } catch {
      toast.error('Ошибка загрузки реферальных данных')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const referralLink = data?.referral_code
    ? `${appUrl}/register?ref=${data.referral_code}`
    : null

  const copyLink = async () => {
    if (!referralLink) return
    await navigator.clipboard.writeText(referralLink)
    setCopied(true)
    toast.success('Ссылка скопирована!')
    setTimeout(() => setCopied(false), 2000)
  }

  const copyCode = async () => {
    if (!data?.referral_code) return
    await navigator.clipboard.writeText(data.referral_code)
    toast.success('Код скопирован!')
  }

  const shareToTelegram = () => {
    if (!referralLink) return
    const text = encodeURIComponent(`🚀 Попробуй PRO-DUCT — AI-продюсер для блогеров!\nСоздаёт посты, рилсы и контент-план автоматически.\nРегистрируйся со скидкой 20%: `)
    window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`, '_blank')
  }

  const shareToVK = () => {
    if (!referralLink) return
    window.open(`https://vk.com/share.php?url=${encodeURIComponent(referralLink)}`, '_blank')
  }

  const applyReferralCode = async () => {
    if (!referralInput.trim()) return
    setApplyingCode(true)
    try {
      const res = await fetch('/api/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referralCode: referralInput.trim().toUpperCase() }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Ошибка применения кода')
      } else {
        toast.success(`Код применён! Скидка ${json.discount_percent}% на первый платёж 🎉`)
        setReferralInput('')
        fetchData()
      }
    } catch {
      toast.error('Ошибка применения кода')
    } finally {
      setApplyingCode(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground text-sm">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Gift className="h-6 w-6 text-primary" />
          Реферальная программа
        </h1>
        <p className="text-muted-foreground mt-1">
          Приглашай блогеров — получай бонусные дни. Они получают скидку 20%.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: Share2,
            step: '1',
            title: 'Поделись ссылкой',
            desc: 'Отправь свою уникальную реферальную ссылку другим блогерам',
            color: 'text-blue-400',
          },
          {
            icon: Users,
            step: '2',
            title: 'Друг регистрируется',
            desc: 'Он получает скидку 20% на первую подписку',
            color: 'text-green-400',
          },
          {
            icon: Zap,
            step: '3',
            title: 'Ты получаешь награду',
            desc: '+30 дней бесплатного доступа за каждого активного реферала',
            color: 'text-yellow-400',
          },
        ].map(({ icon: Icon, step, title, desc, color }) => (
          <Card key={step} className="border-border bg-card">
            <CardContent className="p-4 flex gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-accent`}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Шаг {step}</p>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Всего приглашено', value: data?.stats.total || 0, icon: Users, suffix: '' },
          { label: 'Активных', value: data?.stats.active || 0, icon: CheckCircle, suffix: '' },
          { label: 'Бонусных дней', value: data?.stats.total_bonus_days || 0, icon: Gift, suffix: ' дн.' },
          { label: 'Ваш тариф', value: TIER_CONFIG[data?.subscription_tier as keyof typeof TIER_CONFIG]?.label || 'Free', icon: Star, suffix: '' },
        ].map(({ label, value, icon: Icon, suffix }) => (
          <Card key={label} className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{value}{suffix}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Referral link card */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              Твоя реферальная ссылка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Code badge */}
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-xl bg-secondary border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground mb-0.5">Код</p>
                <p className="text-lg font-bold text-primary tracking-widest font-mono">
                  {data?.referral_code || '—'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyCode}
                className="h-full border-border"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>

            {/* Full link */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Полная ссылка</p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={referralLink || '—'}
                  className="bg-input border-border text-xs font-mono"
                />
                <Button
                  onClick={copyLink}
                  size="sm"
                  className="shrink-0 gradient-accent text-white hover:opacity-90"
                >
                  {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Share buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={shareToTelegram}
                className="flex-1 border-border text-xs gap-1.5"
              >
                <MessageCircle className="h-3.5 w-3.5 text-blue-400" />
                Telegram
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={shareToVK}
                className="flex-1 border-border text-xs gap-1.5"
              >
                <Globe className="h-3.5 w-3.5 text-blue-500" />
                VKontakte
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!referralLink) return
                  if (navigator.share) {
                    navigator.share({ title: 'PRO-DUCT AI', url: referralLink })
                  } else {
                    copyLink()
                  }
                }}
                className="flex-1 border-border text-xs gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Поделиться
              </Button>
            </div>

            {/* Incentive hint */}
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-3">
              <p className="text-xs text-yellow-400 font-semibold mb-0.5">💡 Совет</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Расскажи в своих Stories или посте, как PRO-DUCT помогает тебе в прогревах.
                Искренний отзыв конвертирует лучше любой рекламы.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Apply a code / rewards info */}
        <div className="space-y-4">
          {/* Apply code */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Ввести реферальный код</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Если тебя пригласил другой пользователь — введи его код и получи скидку 20% на первую подписку.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Например: AB3C9XYZ"
                  value={referralInput}
                  onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                  className="bg-input border-border font-mono uppercase"
                  maxLength={8}
                />
                <Button
                  onClick={applyReferralCode}
                  disabled={applyingCode || referralInput.length < 6}
                  className="shrink-0 gradient-accent text-white hover:opacity-90"
                >
                  {applyingCode ? '...' : 'Применить'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Reward tiers */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-400" />
                Награды
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { milestone: 1, reward: '+30 дней', desc: 'За первого реферала' },
                { milestone: 3, reward: '+30 дней', desc: 'За каждого следующего' },
                { milestone: 5, reward: 'Pro навсегда', desc: 'Скидка 50% на Pro план' },
                { milestone: 10, reward: 'Agency', desc: 'Бесплатный Agency на 1 мес.' },
              ].map(({ milestone, reward, desc }) => {
                const current = data?.stats.active || 0
                const achieved = current >= milestone
                return (
                  <div
                    key={milestone}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                      achieved
                        ? 'border-green-500/30 bg-green-500/10'
                        : 'border-border bg-secondary/30'
                    }`}
                  >
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      achieved ? 'bg-green-500 text-white' : 'bg-secondary text-muted-foreground'
                    }`}>
                      {achieved ? '✓' : milestone}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{reward}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                    {achieved && (
                      <Badge className="text-[10px] bg-green-500/15 text-green-400 border-green-500/25">
                        Получено
                      </Badge>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Referrals list */}
      {(data?.referrals?.length || 0) > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Приглашённые пользователи ({data?.stats.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data?.referrals.map((referral) => {
                const statusConf = STATUS_CONFIG[referral.status as keyof typeof STATUS_CONFIG]
                return (
                  <div
                    key={referral.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-secondary/20"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
                      {(referral.referred_profile?.full_name || referral.referred_profile?.email || '?')
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {referral.referred_profile?.full_name || 'Пользователь'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {referral.referred_profile?.email || '—'} ·{' '}
                        {new Date(referral.created_at).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {referral.referrer_reward_given ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <Gift className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">+{referral.referrer_reward_value}д.</span>
                        </div>
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <Badge className={`text-[10px] border ${statusConf?.color}`}>
                        {statusConf?.label}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {(data?.referrals?.length || 0) === 0 && (
        <Card className="border-dashed border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent opacity-60">
              <Users className="h-7 w-7 text-white" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground">Пока нет приглашённых</p>
              <p className="text-sm text-muted-foreground mt-1">
                Поделись ссылкой — и сразу начнёшь зарабатывать бонусные дни
              </p>
            </div>
            <Button
              onClick={copyLink}
              className="gradient-accent text-white hover:opacity-90 mt-2"
            >
              <Copy className="mr-2 h-4 w-4" />
              Скопировать ссылку
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
