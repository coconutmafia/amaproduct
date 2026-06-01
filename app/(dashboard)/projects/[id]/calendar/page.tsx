'use client'

import { useState, useEffect, useCallback, use, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, CheckCircle2, Calendar as CalIcon } from 'lucide-react'
import type { WarmupPlanData, ContentType } from '@/types'

const COLORS: Record<string, { label: string; dot: string }> = {
  post:     { label: 'Пост',    dot: '#3B82F6' },
  carousel: { label: 'Карусель',dot: '#7C3AED' },
  reels:    { label: 'Рилз',    dot: '#DB2777' },
  stories:  { label: 'Сторис',  dot: '#16A34A' },
  live:     { label: 'Эфир',    dot: '#DC2626' },
  webinar:  { label: 'Вебинар', dot: '#E11D48' },
  email:    { label: 'Email',   dot: '#CA8A04' },
}
const PHASE_COLORS: Record<string, string> = {
  awareness: '#60A5FA', trust: '#818CF8', desire: '#F472B6', close: '#F87171',
  niche: '#34D399', expert: '#22D3EE', product: '#FBBF24', objections: '#FB923C', activation: '#4ADE80',
}
const PHASE_NAMES: Record<string, string> = {
  niche: 'Ниша', expert: 'Эксперт', product: 'Продукт', objections: 'Возражения',
  activation: 'Активация', awareness: 'Знакомство', trust: 'Доверие', desire: 'Желание', close: 'Закрытие',
}
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

interface DayCell {
  date: Date
  dayNum: number
  phase: string
  theme: string
  formats: ContentType[]
  hasContent: boolean
}

export default function CalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [cells, setCells] = useState<Map<string, DayCell>>(new Map())
  const [monthOffset, setMonthOffset] = useState(0)
  const [selected, setSelected] = useState<DayCell | null>(null)
  const [baseMonth, setBaseMonth] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: plan } = await supabase
        .from('warmup_plans').select('*').eq('project_id', id)
        .in('status', ['approved', 'active']).order('created_at', { ascending: false }).limit(1).maybeSingle()

      const map = new Map<string, DayCell>()
      let firstDate: Date | null = null

      if (plan?.plan_data) {
        const pd = plan.plan_data as WarmupPlanData & { meta?: { start_date?: string } }
        const startStr = pd.meta?.start_date || plan.name?.match(/старт (\d{4}-\d{2}-\d{2})/)?.[1]
        const base = startStr ? new Date(startStr + 'T00:00:00') : new Date()
        firstDate = base

        // content_items by day_number
        const { data: items } = await supabase
          .from('content_items').select('day_number, content_type').eq('project_id', id)
        const contentDays = new Set((items ?? []).map(i => i.day_number).filter(Boolean))

        for (const phase of (pd.warmup_plan?.phases ?? [])) {
          for (const dp of (phase.daily_plan ?? [])) {
            const d = dp as unknown as Record<string, unknown>
            const dayNum = dp.day
            const date = new Date(base); date.setDate(date.getDate() + dayNum - 1)
            const savedFmt = (d.formats as ContentType[]) || (d.format as ContentType[]) || []
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            map.set(key, {
              date, dayNum,
              phase: phase.phase as string,
              theme: (d.meaning as string) || (d.theme as string) || '',
              formats: savedFmt.length > 0 ? savedFmt : ['post', 'stories', 'reels'],
              hasContent: contentDays.has(dayNum),
            })
          }
        }
      }
      setCells(map)
      setBaseMonth(firstDate ? new Date(firstDate.getFullYear(), firstDate.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [id, supabase])

  useEffect(() => { load() }, [load])

  const viewMonth = useMemo(() => {
    const b = baseMonth ?? new Date()
    return new Date(b.getFullYear(), b.getMonth() + monthOffset, 1)
  }, [baseMonth, monthOffset])

  // Build the calendar grid for viewMonth (Mon-first)
  const grid = useMemo(() => {
    const year = viewMonth.getFullYear(), month = viewMonth.getMonth()
    const first = new Date(year, month, 1)
    const startWeekday = (first.getDay() + 6) % 7 // Mon=0
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cellsArr: (DayCell | null)[] = []
    for (let i = 0; i < startWeekday; i++) cellsArr.push(null)
    for (let dn = 1; dn <= daysInMonth; dn++) {
      const key = `${year}-${month}-${dn}`
      cellsArr.push(cells.get(key) ?? { date: new Date(year, month, dn), dayNum: 0, phase: '', theme: '', formats: [], hasContent: false })
    }
    while (cellsArr.length % 7 !== 0) cellsArr.push(null)
    return cellsArr
  }, [viewMonth, cells])

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${id}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><CalIcon className="h-4 w-4 text-primary" /> Календарь</h1>
          <p className="text-xs text-muted-foreground">Визуальный план контента по дням</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : cells.size === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Плана ещё нет. Создай план прогрева и контент-план — и он появится здесь.
          <div className="mt-3"><Link href={`/projects/${id}/content-plan`} className="text-primary font-medium">Открыть контент-план →</Link></div>
        </div>
      ) : (
        <>
          {/* Month nav */}
          <div className="flex items-center justify-between">
            <button onClick={() => setMonthOffset(o => o - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
            <p className="text-sm font-bold text-foreground">{MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}</p>
            <button onClick={() => setMonthOffset(o => o + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map(w => <div key={w} className="text-[10px] font-medium text-muted-foreground py-1">{w}</div>)}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell, i) => {
              if (!cell) return <div key={i} />
              const planned = cell.dayNum > 0
              return (
                <button key={i}
                  onClick={() => planned && setSelected(cell)}
                  className={`aspect-square rounded-lg border p-1 flex flex-col items-center justify-start gap-0.5 text-[11px] transition-all ${
                    planned ? 'border-border bg-white hover:border-primary/40 active:scale-95' : 'border-transparent bg-secondary/20'
                  }`}>
                  <span className={`font-semibold ${planned ? 'text-foreground' : 'text-muted-foreground/40'}`}>{cell.date.getDate()}</span>
                  {planned && (
                    <>
                      {cell.phase && <span className="w-4 h-1 rounded-full" style={{ backgroundColor: PHASE_COLORS[cell.phase] ?? '#CBD5E1' }} />}
                      <div className="flex flex-wrap gap-0.5 justify-center">
                        {cell.formats.slice(0, 3).map(f => <span key={f} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORS[f]?.dot ?? '#999' }} />)}
                      </div>
                      {cell.hasContent && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                    </>
                  )}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {Object.entries(COLORS).slice(0, 4).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.dot }} />{c.label}
              </span>
            ))}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-green-500" />есть контент</span>
          </div>
        </>
      )}

      {/* Day detail sheet */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={() => setSelected(null)}>
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{selected.date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                {selected.phase && <p className="text-xs" style={{ color: PHASE_COLORS[selected.phase] }}>{PHASE_NAMES[selected.phase] ?? selected.phase}</p>}
              </div>
              {selected.hasContent && <span className="text-[11px] text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> готово</span>}
            </div>
            {selected.theme && <p className="text-sm text-foreground/80 leading-snug">{selected.theme}</p>}
            <div className="flex flex-wrap gap-1.5">
              {selected.formats.map(f => (
                <span key={f} className="text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ backgroundColor: (COLORS[f]?.dot ?? '#999') + '22', color: COLORS[f]?.dot ?? '#666' }}>{COLORS[f]?.label ?? f}</span>
              ))}
            </div>
            <Link href={`/projects/${id}/content-plan`} className="block text-center text-sm font-medium text-white gradient-accent rounded-xl py-2.5 mt-2">
              Открыть в контент-плане →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
