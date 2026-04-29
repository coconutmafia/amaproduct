'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, ChevronLeft, ChevronRight, Download, Loader2, Plus, X } from 'lucide-react'
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
  dayBriefs?: Record<string, string>
}

interface ContentPlanGridProps {
  projectId: string
  warmupPlanId?: string
  weekNumber: number
  days: DayContent[]
  onWeekChange: (delta: number) => void
  onGenerate: (day: number, contentType: ContentType, phase: WarmupPhase, theme?: string) => void
  onGenerateWeekBrief?: () => Promise<void>
  onExport: () => void
  onRemoveType?: (dayNum: number, type: ContentType) => void
  onAddType?: (dayNum: number, type: ContentType) => void
  loading?: boolean
}

// No webinar in display types
const DISPLAY_TYPES: ContentType[] = ['post', 'carousel', 'reels', 'stories', 'live', 'email']

const CONTENT_TYPE_CONFIG: Record<ContentType, { label: string; color: string; shortLabel: string }> = {
  post: { label: 'Пост', color: 'bg-blue-500/20 text-blue-400 border-blue-400/20', shortLabel: 'П' },
  carousel: { label: 'Карусель', color: 'bg-purple-500/20 text-purple-400 border-purple-400/20', shortLabel: 'К' },
  reels: { label: 'Рилс', color: 'bg-orange-500/20 text-orange-400 border-orange-400/20', shortLabel: 'Р' },
  stories: { label: 'Сториз', color: 'bg-pink-500/20 text-pink-400 border-pink-400/20', shortLabel: 'С' },
  live: { label: 'Эфир', color: 'bg-red-500/20 text-red-400 border-red-400/20', shortLabel: 'Э' },
  webinar: { label: 'Вебинар', color: 'bg-green-500/20 text-green-400 border-green-400/20', shortLabel: 'В' },
  email: { label: 'Email', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-400/20', shortLabel: 'E' },
}

const PHASE_NAMES: Record<string, string> = {
  niche: 'На нишу',
  expert: 'На эксперта',
  product: 'На продукт',
  objections: 'Возражения',
  activation: 'Активация',
  awareness: 'Знакомство',
  trust: 'Доверие',
  desire: 'Желание',
  close: 'Закрытие',
}

export function ContentPlanGrid({
  projectId,
  warmupPlanId,
  weekNumber,
  days,
  onWeekChange,
  onGenerate,
  onGenerateWeekBrief,
  onExport,
  onRemoveType,
  onAddType,
  loading,
}: ContentPlanGridProps) {
  const [generatingDay, setGeneratingDay] = useState<string | null>(null)
  const [generatingWeekBrief, setGeneratingWeekBrief] = useState(false)
  // Which day's "+" is open
  const [addingToDay, setAddingToDay] = useState<number | null>(null)

  // Suppress unused warning
  void projectId
  void warmupPlanId
  void toast

  async function handleGenerate(day: DayContent, contentType: ContentType) {
    const key = `${day.day}-${contentType}`
    setGeneratingDay(key)
    try {
      // Pick the brief for this specific type if available
      const theme = day.dayBriefs?.[contentType] || day.theme
      await onGenerate(day.day, contentType, day.phase || 'awareness', theme)
    } finally {
      setGeneratingDay(null)
    }
  }

  async function handleGenerateWeekBriefClick() {
    if (!onGenerateWeekBrief) return
    setGeneratingWeekBrief(true)
    try {
      await onGenerateWeekBrief()
    } finally {
      setGeneratingWeekBrief(false)
    }
  }

  return (
    <div className="overflow-x-hidden space-y-4">
      {/* Instructional text */}
      <p className="text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2 border border-border">
        Ты сам можешь добавлять и убирать единицы контента внутри каждого дня — в зависимости от того, сколько контента планируешь делать ежедневно. Нажми <strong className="text-foreground">+</strong> чтобы добавить тип контента, <strong className="text-foreground">×</strong> — чтобы убрать.
      </p>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
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
            onClick={handleGenerateWeekBriefClick}
            disabled={loading || generatingWeekBrief}
          >
            {generatingWeekBrief
              ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Составляю план...</>
              : <><Sparkles className="mr-1 h-3 w-3" /> Составить план недели</>
            }
          </Button>
          <Button variant="outline" size="sm" className="border-border text-xs h-8" onClick={onExport}>
            <Download className="mr-1 h-3 w-3" />
            Скачать
          </Button>
        </div>
      </div>

      {/* Vertical day list */}
      <div className="space-y-2">
        {days.map((day) => {
          const phaseName = day.phase ? PHASE_NAMES[day.phase] : null
          // Default to post+stories+reels if no planned types
          const displayTypes = (day.plannedTypes && day.plannedTypes.length > 0)
            ? day.plannedTypes
            : (['post', 'stories', 'reels'] as ContentType[])
          const isAddOpen = addingToDay === day.day
          // Types available to add (not already planned)
          const availableToAdd = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))

          return (
            <div key={day.day} className="rounded-xl border border-border bg-card">
              <div className="flex items-start gap-3 p-3">
                {/* Day name + date */}
                <div className="w-14 shrink-0 pt-0.5">
                  <p className="text-sm font-bold text-foreground">{day.dayOfWeek}</p>
                  <p className="text-xs text-muted-foreground">{day.date}</p>
                </div>

                {/* Content area */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Theme */}
                  {day.theme && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{day.theme}</p>
                  )}

                  {/* Content type badges */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {displayTypes.map((type) => {
                      const config = CONTENT_TYPE_CONFIG[type]
                      if (!config) return null
                      const existingItem = day.items.find((i) => i.content_type === type)
                      const genKey = `${day.day}-${type}`
                      const isGenerating = generatingDay === genKey
                      const briefText = day.dayBriefs?.[type]

                      return (
                        <div key={type} className="relative group/badge flex items-center">
                          <button
                            onClick={() => !existingItem && handleGenerate(day, type)}
                            disabled={!!existingItem || isGenerating}
                            title={briefText || config.label}
                            className={`flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                              existingItem
                                ? `${config.color} opacity-70 cursor-default`
                                : `${config.color} hover:opacity-80 cursor-pointer`
                            }`}
                          >
                            {isGenerating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3" />
                            )}
                            {config.label}
                            {existingItem?.is_approved && ' ✓'}
                          </button>
                          {/* Remove button — only if no generated content */}
                          {onRemoveType && !existingItem && !isGenerating && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRemoveType(day.day, type) }}
                              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full opacity-0 group-hover/badge:opacity-100 hover:bg-red-500/20 hover:text-red-400 text-muted-foreground transition-all"
                              title="Убрать"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                      )
                    })}

                    {/* Add type button */}
                    {onAddType && availableToAdd.length > 0 && (
                      <button
                        onClick={() => setAddingToDay(isAddOpen ? null : day.day)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
                        title="Добавить тип контента"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}

                    {phaseName && (
                      <Badge className="text-[10px] shrink-0 hidden md:flex">{phaseName}</Badge>
                    )}
                  </div>

                  {/* Inline type selector */}
                  {isAddOpen && availableToAdd.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground self-center">Добавить:</span>
                      {availableToAdd.map(type => {
                        const config = CONTENT_TYPE_CONFIG[type]
                        return (
                          <button
                            key={type}
                            onClick={() => { onAddType!(day.day, type); setAddingToDay(null) }}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${config.color} hover:opacity-80`}
                          >
                            <Plus className="h-2.5 w-2.5" />
                            {config.label}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setAddingToDay(null)}
                        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Отмена
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend — no webinar */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {DISPLAY_TYPES.map((key) => {
          const { label, color } = CONTENT_TYPE_CONFIG[key]
          return (
            <span key={key} className="flex items-center gap-1">
              <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold ${color}`}>{label[0]}</span>
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
