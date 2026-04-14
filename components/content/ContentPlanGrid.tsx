'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Sparkles, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ContentItem, ContentType, WarmupPhase } from '@/types'

interface DayContent {
  day: number
  date: string
  dayOfWeek: string
  items: ContentItem[]
  plannedTypes?: ContentType[]
  phase?: WarmupPhase
  theme?: string
}

interface ContentPlanGridProps {
  projectId: string
  warmupPlanId?: string
  weekNumber: number
  days: DayContent[]
  onWeekChange: (delta: number) => void
  onGenerate: (day: number, contentType: ContentType, phase: WarmupPhase) => void
  onExport: () => void
  loading?: boolean
}

const CONTENT_TYPE_CONFIG: Record<ContentType, { label: string; color: string; shortLabel: string }> = {
  post: { label: 'Пост', color: 'bg-blue-500/20 text-blue-400 border-blue-400/20', shortLabel: 'П' },
  carousel: { label: 'Карусель', color: 'bg-purple-500/20 text-purple-400 border-purple-400/20', shortLabel: 'К' },
  reels: { label: 'Рилс', color: 'bg-orange-500/20 text-orange-400 border-orange-400/20', shortLabel: 'R' },
  stories: { label: 'Сториз', color: 'bg-pink-500/20 text-pink-400 border-pink-400/20', shortLabel: 'С' },
  live: { label: 'Эфир', color: 'bg-red-500/20 text-red-400 border-red-400/20', shortLabel: 'Э' },
  webinar: { label: 'Вебинар', color: 'bg-green-500/20 text-green-400 border-green-400/20', shortLabel: 'В' },
  email: { label: 'Email', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-400/20', shortLabel: 'E' },
}

const PHASE_COLORS: Record<string, string> = {
  awareness: 'bg-blue-500/10 border-blue-500/20',
  trust: 'bg-green-500/10 border-green-500/20',
  desire: 'bg-yellow-500/10 border-yellow-500/20',
  close: 'bg-red-500/10 border-red-500/20',
}

const DAYS_RU = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

export function ContentPlanGrid({
  projectId,
  warmupPlanId,
  weekNumber,
  days,
  onWeekChange,
  onGenerate,
  onExport,
  loading,
}: ContentPlanGridProps) {
  const [generatingDay, setGeneratingDay] = useState<string | null>(null)

  async function handleGenerate(day: DayContent, contentType: ContentType) {
    const key = `${day.day}-${contentType}`
    setGeneratingDay(key)
    try {
      await onGenerate(day.day, contentType, day.phase || 'awareness')
    } finally {
      setGeneratingDay(null)
    }
  }

  async function handleGenerateWeek() {
    toast.info('Генерация недели запущена...')
    for (const day of days) {
      for (const type of (day.plannedTypes || ['post'])) {
        await onGenerate(day.day, type, day.phase || 'awareness')
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    toast.success('Неделя сгенерирована!')
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8 border-border" onClick={() => onWeekChange(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[120px] text-center">
            Неделя {weekNumber}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8 border-border" onClick={() => onWeekChange(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border text-xs h-8"
            onClick={handleGenerateWeek}
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            Сгенерировать неделю
          </Button>
          <Button variant="outline" size="sm" className="border-border text-xs h-8" onClick={onExport}>
            <Download className="mr-1 h-3 w-3" />
            Экспорт
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-2">
        {/* Day headers */}
        {DAYS_RU.map((day) => (
          <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-2">
            {day}
          </div>
        ))}

        {/* Day cells */}
        {days.map((day) => (
          <div
            key={day.day}
            className={`min-h-[140px] rounded-xl border p-2 space-y-1.5 transition-colors ${
              day.phase ? PHASE_COLORS[day.phase] : 'border-border bg-card/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">Д{day.day}</span>
              <span className="text-[9px] text-muted-foreground">{day.date}</span>
            </div>

            {day.theme && (
              <p className="text-[9px] text-muted-foreground leading-tight line-clamp-2">{day.theme}</p>
            )}

            {/* Planned types */}
            {day.plannedTypes?.map((type) => {
              const config = CONTENT_TYPE_CONFIG[type]
              const existingItem = day.items.find((i) => i.content_type === type)
              const genKey = `${day.day}-${type}`
              const isGenerating = generatingDay === genKey

              return (
                <button
                  key={type}
                  onClick={() => !existingItem && handleGenerate(day, type)}
                  disabled={!!existingItem || isGenerating}
                  className={`w-full flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-medium border transition-all ${
                    existingItem
                      ? `${config.color} opacity-70`
                      : `hover:opacity-80 ${config.color} cursor-pointer`
                  }`}
                >
                  {isGenerating ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-2.5 w-2.5" />
                  )}
                  <span>{config.label}</span>
                  {existingItem?.is_approved && (
                    <span className="ml-auto">✓</span>
                  )}
                </button>
              )
            })}

            {!day.plannedTypes && (
              <div className="text-[9px] text-muted-foreground text-center py-2">—</div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {Object.entries(CONTENT_TYPE_CONFIG).map(([key, { label, color }]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold ${color}`}>{label[0]}</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
