'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UsageCard } from '@/components/billing/UsageCard'
import { CheckCircle2, Star, Zap, Building2, Sparkles } from 'lucide-react'
import { PLAN_CONFIG, VISIBLE_PAID_PLANS, nextPlan, planCapacityLine, type PaidPlan, type SubscriptionTier } from '@/lib/generations-config'

export type UpgradeReason = 'limit' | 'budget' | 'needs_plan' | 'trial' | 'view_only' | 'paused'

const ICONS: Record<PaidPlan, React.ReactNode> = {
  starter:  <Sparkles className="h-4 w-4" />,
  solo:     <Star className="h-4 w-4" />,
  pro:      <Zap className="h-4 w-4" />,
  producer: <Building2 className="h-4 w-4" />,
}

// 'limit' и 'needs_plan' — РАЗНЫЕ вещи, и путать их нельзя: неоплатившему юзеру,
// который ничего не создал, «ты создала все единицы контента» читается как враньё.
const REASON_COPY: Record<UpgradeReason, { title: string; desc: string }> = {
  limit:      { title: 'Лимит на этот месяц исчерпан', desc: 'Ты создала все единицы контента в этом месяце. Подключи тариф — и продолжай без пауз.' },
  // 'budget' — второй ограничитель: единицы ещё есть, а ресурс AI тарифа
  // (себестоимость) исчерпан. Даша 04.09: 29/300 единиц и «лимит исчерпан» —
  // без этой ветки текст про «все единицы» читался как враньё.
  budget:     { title: 'Ресурс AI на этот месяц исчерпан', desc: 'Единицы контента ещё остались, но ресурс AI твоего тарифа закончился — его быстрее расходуют длинные диалоги с ассистентом и большая база знаний. Тариф выше даёт больше ресурса.' },
  needs_plan: { title: 'Выбери тариф, чтобы начать', desc: 'Генерация контента доступна по тарифу. Выбери подходящий — подключение занимает минуту.' },
  trial:      { title: 'Пробный период заканчивается', desc: 'Выбери тариф, чтобы не потерять доступ к контенту и генерации.' },
  view_only:  { title: 'Генерация на паузе', desc: 'Контент виден, но создавать новый можно по тарифу. Все твои данные на месте.' },
  paused:     { title: 'Доступ на паузе', desc: 'Подключи тариф — все твои данные и контент на месте.' },
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
  open, onOpenChange, reason = 'limit', currentPlan,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  reason?: UpgradeReason
  /** текущий тариф юзера — подсвечиваем СЛЕДУЮЩУЮ ступень лестницы, а не всегда Соло */
  currentPlan?: SubscriptionTier
}) {
  const copy = REASON_COPY[reason] ?? REASON_COPY.limit
  // Лестница (29.08): человеку, упёршемуся в лимит, показываем очевидный
  // следующий шаг. Без известного тарифа — прежнее поведение (герой Соло).
  const hero: PaidPlan = (currentPlan && nextPlan(currentPlan)) || 'solo'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h/overflow — иначе на телефоне три тарифа не помещаются, модалка
          обрезается и не листается: человек не может выбрать тариф вообще. */}
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.desc}</DialogDescription>
        </DialogHeader>

        {/* Обе шкалы прямо в окне лимита — человек видит, ЧТО именно кончилось */}
        {(reason === 'limit' || reason === 'budget') && <UsageCard compact />}

        <div className={`grid ${VISIBLE_PAID_PLANS.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3`}>
          {VISIBLE_PAID_PLANS.map((key) => {
            const cfg = PLAN_CONFIG[key]
            const isHero = key === hero
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 flex flex-col gap-3 ${isHero ? 'border-primary/40 ring-1 ring-primary/30 bg-primary/5' : 'border-border'}`}
              >
                {isHero
                  ? <Badge className="self-start bg-primary/15 text-primary border-primary/30 text-[10px]">Твой следующий шаг</Badge>
                  : cfg.badge
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
                  {cfg.unlimited ? 'Безлимит генераций' : `${cfg.generations} единиц/мес`}
                </p>
                {!cfg.unlimited && <p className="text-[10px] text-muted-foreground leading-snug">{planCapacityLine(cfg.generations)}</p>}
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
// currentPlan приходит из layout (сервер знает профиль) — диалог подсвечивает
// следующую ступень лестницы для ЭТОГО юзера.
export function UpgradeDialogHost({ currentPlan }: { currentPlan?: SubscriptionTier }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<UpgradeReason>('limit')

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { reason?: UpgradeReason } | undefined
      const r = detail?.reason ?? 'limit'
      setReason(r)
      // 402 limit_reached приходит и за единицы, и за ресурс AI. Уточняем по
      // факту, чтобы заголовок не врал: единицы есть, а ресурс исчерпан → budget.
      if (r === 'limit') {
        fetch('/api/account/usage').then(x => (x.ok ? x.json() : null)).then((u: { budget?: { exhausted?: boolean }; units?: { remaining?: number } } | null) => {
          if (u?.budget?.exhausted && (u.units?.remaining ?? 0) !== 0) setReason('budget')
        }).catch(() => {})
      }
      setOpen(true)
    }
    window.addEventListener(SHOW_EVENT, handler)
    return () => window.removeEventListener(SHOW_EVENT, handler)
  }, [])

  return <UpgradeDialog open={open} onOpenChange={setOpen} reason={reason} currentPlan={currentPlan} />
}
