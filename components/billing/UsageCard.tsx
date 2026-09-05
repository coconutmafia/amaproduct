'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gauge, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PLAN_CONFIG, type SubscriptionTier } from '@/lib/generations-config'
import { fmtDateLocalRu } from '@/lib/dates'
import type { UsageSummary } from '@/lib/billing/usageSummary'

// «Тариф и расход» — прозрачная шкала для клиента (мандат Матвея 04.09):
// сколько единиц списано и на что хватит остатка, плюс ВТОРАЯ шкала — ресурс
// AI. Без неё лимит выглядел как произвол: Даша при 29/300 единиц упёрлась в
// исчерпанный ресурс и не понимала, за что. Данные — одна правда из
// /api/account/usage; цены — из UNIT_COSTS через сервер (никакого хардкода).

function Bar({ pct, tone }: { pct: number; tone: 'ok' | 'warn' | 'over' }) {
  const color = tone === 'over' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-400' : 'bg-green-500'
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  )
}
const tone = (pct: number): 'ok' | 'warn' | 'over' => pct >= 100 ? 'over' : pct >= 70 ? 'warn' : 'ok'

export function UsageCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [showPrices, setShowPrices] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/account/usage')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: UsageSummary) => { if (alive) setData(d) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  if (failed) return null
  if (!data) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Считаю расход…
        </CardContent>
      </Card>
    )
  }

  const plan = PLAN_CONFIG[data.tier as SubscriptionTier] ?? PLAN_CONFIG.trial
  const unitsPct = data.units.unlimited ? 0 : Math.round(data.units.used / Math.max(1, data.units.limit) * 100)
  const resetLabel = data.units.resetAt
    ? fmtDateLocalRu(new Date(data.units.resetAt).getTime(), { day: 'numeric', month: 'long' })
    : null
  const budgetOver = data.budget.tracked && data.budget.exhausted
  const unitsOver = !data.units.unlimited && data.units.remaining <= 0
  const remaining = data.units.remaining

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" /> Тариф и расход
          </CardTitle>
          <span className="text-xs text-muted-foreground">{plan.label}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Шкала 1 — единицы контента */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">Единицы контента</span>
            <span className={`tabular-nums ${unitsOver ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
              {data.units.unlimited
                ? `${data.units.used} · безлимит`
                : `${data.units.used} из ${data.units.limit}${data.units.bonus > 0 ? ` + ${data.units.bonus} бонусных` : ''}`}
            </span>
          </div>
          {!data.units.unlimited && <Bar pct={unitsPct} tone={tone(unitsPct)} />}
          {resetLabel && !data.units.unlimited && (
            <p className="text-[11px] text-muted-foreground">Обновится {resetLabel}</p>
          )}
        </div>

        {/* Что именно закрыло доступ — прямым текстом */}
        {(budgetOver || unitsOver) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 leading-snug">
            {budgetOver && !unitsOver
              ? 'Ресурс тарифа на этот месяц исчерпан — генерация на паузе до обновления лимита.'
              : 'Единицы контента на этот месяц закончились.'}{' '}
            <Link href="/pricing" className="font-semibold underline underline-offset-2">Тариф выше</Link> откроет больше.
          </div>
        )}

        {/* На что ушло */}
        {!compact && data.breakdown.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">На что ушёл ресурс в этом месяце</p>
            {data.breakdown.slice(0, 6).map(b => (
              <div key={b.key} className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground flex-1 truncate">{b.label} — {b.count} {b.unit}</span>
                <span className="w-24 shrink-0"><Bar pct={b.sharePct} tone="ok" /></span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{b.sharePct}%</span>
              </div>
            ))}
          </div>
        )}

        {/* На что хватит остатка — из UNIT_COSTS */}
        {!data.units.unlimited && remaining > 0 && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            Остатка ≈ на <b className="text-foreground">{data.fits.content}</b> постов или рилзов,
            или <b className="text-foreground">{data.fits.chatMessages}</b> сообщений ассистенту,
            или <b className="text-foreground">{data.fits.transcribeHours}</b> ч расшифровок — если тратить только на что-то одно.
          </p>
        )}

        {/* Лента списаний — «каждая задача фиксируется» (мандат 04.09) */}
        {!compact && data.ledger && data.ledger.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Последние списания</p>
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {data.ledger.slice(0, 15).map(l => (
                <div key={l.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                    {fmtDateLocalRu(new Date(l.created_at).getTime(), { day: 'numeric', month: 'short' })}
                  </span>
                  <span className="flex-1 truncate text-foreground">{l.label}</span>
                  <span className={`shrink-0 tabular-nums ${l.units < 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {l.units < 0 ? '+' : '−'}{Math.abs(l.units).toLocaleString('ru-RU')} ед.
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Прайс действий */}
        {!compact && (
          <div>
            <button type="button" onClick={() => setShowPrices(v => !v)} className="text-[11px] text-primary font-medium inline-flex items-center gap-1">
              Что сколько стоит {showPrices ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showPrices && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {data.prices.map(p => (
                  <div key={p.key} className="flex justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground truncate">{p.label}</span>
                    <span className="shrink-0 text-foreground tabular-nums">{p.units} ед. <span className="text-muted-foreground">{p.per}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
