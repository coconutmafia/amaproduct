'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { BarChart3, Loader2, Users, Sparkles, DollarSign, Gift } from 'lucide-react'

interface Row {
  id: string
  email: string
  name: string | null
  role: string
  tier: string
  trialEndsAt: string | null
  trialActive: boolean
  generationsUsed: number
  bonus: number
  projects: number
  materials: number
  contentItems: number
  estCostUsd: number
  createdAt: string
}
interface Totals { users: number; generations: number; contentItems: number; estCostUsd: number; trialsActive: number }

export default function AdminAnalyticsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/analytics')
      if (res.status === 403) { toast.error('Только для администратора'); setLoading(false); return }
      const data = await res.json() as { rows: Row[]; totals: Totals }
      setRows(data.rows || []); setTotals(data.totals)
    } catch { toast.error('Ошибка загрузки') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const setTrial = async (userId: string, months: number) => {
    setBusyId(userId)
    try {
      const res = await fetch('/api/admin/analytics', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, months }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(months > 0 ? `Триал на ${months} мес выдан` : 'Триал снят')
      await load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка') }
    finally { setBusyId(null) }
  }

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU') : '—'

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Аналитика пользователей</h1>
      </div>

      {/* Totals */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Users,    label: 'Пользователей', value: totals.users },
            { icon: Sparkles, label: 'Генераций',     value: totals.generations },
            { icon: Gift,     label: 'Активных триалов', value: totals.trialsActive },
            { icon: DollarSign, label: 'Расходы API (оценка)', value: `$${totals.estCostUsd}` },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs"><s.icon className="h-3.5 w-3.5" />{s.label}</div>
              <p className="text-xl font-bold text-foreground mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Пользователей нет</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{r.name || r.email}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{r.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    r.role === 'admin' ? 'bg-purple-100 text-purple-700'
                    : r.trialActive ? 'bg-green-100 text-green-700'
                    : r.tier === 'free' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {r.role === 'admin' ? 'admin' : r.trialActive ? `триал до ${fmtDate(r.trialEndsAt)}` : r.tier}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { l: 'Проекты', v: r.projects },
                  { l: 'Материалы', v: r.materials },
                  { l: 'Контент', v: r.contentItems },
                  { l: 'Генерации', v: r.generationsUsed },
                ].map((m, i) => (
                  <div key={i} className="rounded-lg bg-secondary/40 py-1.5">
                    <p className="text-sm font-bold text-foreground">{m.v}</p>
                    <p className="text-[10px] text-muted-foreground">{m.l}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-muted-foreground">≈ ${r.estCostUsd} API · рег. {fmtDate(r.createdAt)}</span>
                {r.role !== 'admin' && (
                  <div className="flex gap-1.5">
                    {r.trialActive ? (
                      <button onClick={() => setTrial(r.id, 0)} disabled={busyId === r.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40">
                        {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Снять триал'}
                      </button>
                    ) : (
                      <button onClick={() => setTrial(r.id, 2)} disabled={busyId === r.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-primary/40 text-primary hover:bg-primary/10">
                        {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Триал 2 мес'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Стоимость API — оценка (~$0.18 за генерацию). Реальная уточнится по мере использования и появления данных по токенам.
      </p>
    </div>
  )
}
