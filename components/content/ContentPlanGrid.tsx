'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sparkles, ChevronLeft, ChevronRight, Download, Loader2,
  Plus, X, Eye, EyeOff, RefreshCw, Check,
} from 'lucide-react'
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

const DISPLAY_TYPES: ContentType[] = ['post', 'carousel', 'reels', 'stories', 'live', 'email']

const CONTENT_TYPE_CONFIG: Record<ContentType, { label: string; color: string; doneColor: string }> = {
  post:     { label: 'Пост',    color: 'bg-blue-500/20 text-blue-400 border-blue-400/20',     doneColor: 'bg-blue-500/30 text-blue-300 border-blue-400/40' },
  carousel: { label: 'Карусель',color: 'bg-purple-500/20 text-purple-400 border-purple-400/20', doneColor: 'bg-purple-500/30 text-purple-300 border-purple-400/40' },
  reels:    { label: 'Рилс',   color: 'bg-orange-500/20 text-orange-400 border-orange-400/20', doneColor: 'bg-orange-500/30 text-orange-300 border-orange-400/40' },
  stories:  { label: 'Сториз', color: 'bg-pink-500/20 text-pink-400 border-pink-400/20',       doneColor: 'bg-pink-500/30 text-pink-300 border-pink-400/40' },
  live:     { label: 'Эфир',   color: 'bg-red-500/20 text-red-400 border-red-400/20',          doneColor: 'bg-red-500/30 text-red-300 border-red-400/40' },
  webinar:  { label: 'Вебинар',color: 'bg-green-500/20 text-green-400 border-green-400/20',    doneColor: 'bg-green-500/30 text-green-300 border-green-400/40' },
  email:    { label: 'Email',  color: 'bg-yellow-500/20 text-yellow-400 border-yellow-400/20', doneColor: 'bg-yellow-500/30 text-yellow-300 border-yellow-400/40' },
}

const PHASE_NAMES: Record<string, string> = {
  niche: 'На нишу', expert: 'На эксперта', product: 'На продукт', objections: 'Возражения',
  activation: 'Активация', awareness: 'Знакомство', trust: 'Доверие', desire: 'Желание', close: 'Закрытие',
}

// ── Content renderer ──────────────────────────────────────────────────────────
function renderContent(item: ContentItem) {
  const sd = item.structured_data as Record<string, unknown> | null

  // Post — plain text
  if (item.content_type === 'post' || item.body_text) {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {item.body_text || '(нет текста)'}
      </div>
    )
  }

  // Reels
  if (item.content_type === 'reels' && sd?.reels) {
    const r = sd.reels as Record<string, unknown>
    const scenes = (r.scenes as Record<string, unknown>[] | undefined) || []
    return (
      <div className="space-y-3 text-sm">
        {!!r.title && <p className="font-semibold text-foreground">{String(r.title)}</p>}
        {!!r.hook_text && <p className="text-muted-foreground italic">Крючок: {String(r.hook_text)}</p>}
        {scenes.map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-1 bg-secondary/20">
            <p className="text-xs font-bold text-muted-foreground">Сцена {String(s.scene)} · {String(s.timing)}</p>
            {!!(s.visual as Record<string, unknown>)?.action && <p>{String((s.visual as Record<string, unknown>).action)}</p>}
            {!!(s.audio as Record<string, unknown>)?.speech && <p className="text-primary/80 text-xs">💬 {String((s.audio as Record<string, unknown>).speech)}</p>}
            {!!s.text_overlay && <p className="text-xs text-muted-foreground">Титр: {String(s.text_overlay)}</p>}
          </div>
        ))}
        {!!r.description_text && <p className="text-xs text-muted-foreground pt-1">Подпись: {String(r.description_text)}</p>}
      </div>
    )
  }

  // Stories
  if (item.content_type === 'stories' && sd?.stories_series) {
    const series = sd.stories_series as Record<string, unknown>
    const stories = (series.stories as Record<string, unknown>[] | undefined) || []
    return (
      <div className="space-y-3 text-sm">
        {!!series.goal && <p className="text-muted-foreground text-xs">Цель: {String(series.goal)}</p>}
        {stories.map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-1 bg-secondary/20">
            <p className="text-xs font-bold text-muted-foreground">Сториз {String(s.story_number)}</p>
            {!!(s.text as Record<string, unknown>)?.main_text && <p>{String((s.text as Record<string, unknown>).main_text)}</p>}
            {!!(s.interactive as Record<string, unknown>)?.question && (
              <p className="text-xs text-primary/80">
                📊 {String((s.interactive as Record<string, unknown>).question)}
                {((s.interactive as Record<string, unknown>).options as string[] | undefined)?.length
                  ? ` (${((s.interactive as Record<string, unknown>).options as string[]).join(' / ')})`
                  : ''}
              </p>
            )}
            {!!s.cta && <p className="text-xs text-muted-foreground">CTA: {String(s.cta)}</p>}
          </div>
        ))}
      </div>
    )
  }

  // Carousel
  if (item.content_type === 'carousel' && sd?.carousel) {
    const c = sd.carousel as Record<string, unknown>
    const cover = c.cover as Record<string, unknown> | undefined
    const slides = (c.slides as Record<string, unknown>[] | undefined) || []
    const last = c.last_slide as Record<string, unknown> | undefined
    return (
      <div className="space-y-3 text-sm">
        {cover && (
          <div className="border border-primary/30 rounded-lg p-3 bg-primary/5">
            <p className="text-xs font-bold text-primary mb-1">Обложка</p>
            <p className="font-semibold">{String(cover.headline ?? '')}</p>
            {!!cover.subheadline && <p className="text-muted-foreground text-xs">{String(cover.subheadline)}</p>}
          </div>
        )}
        {slides.map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3 bg-secondary/20">
            <p className="text-xs font-bold text-muted-foreground mb-1">Слайд {String(s.slide)}</p>
            <p className="font-medium">{String(s.headline ?? '')}</p>
            {!!s.body && <p className="text-muted-foreground text-xs mt-1">{String(s.body)}</p>}
          </div>
        ))}
        {last && (
          <div className="border border-border rounded-lg p-3 bg-secondary/20">
            <p className="text-xs font-bold text-muted-foreground mb-1">Последний слайд</p>
            <p>{String(last.text ?? '')}</p>
            {!!last.action && <p className="text-primary text-xs mt-1">→ {String(last.action)}</p>}
          </div>
        )}
      </div>
    )
  }

  // Live / Email — could be JSON or plain text
  if (sd) {
    // Live
    const live = sd.live as Record<string, unknown> | undefined
    if (live) {
      const blocks = (live.structure as Record<string, unknown>[] | undefined) || []
      return (
        <div className="space-y-3 text-sm">
          {!!live.title && <p className="font-semibold">{String(live.title)}</p>}
          {!!live.goal && <p className="text-xs text-muted-foreground">Цель: {String(live.goal)}</p>}
          {blocks.map((b, i) => (
            <div key={i} className="border border-border rounded-lg p-3 bg-secondary/20">
              <p className="text-xs font-bold text-muted-foreground">{String(b.block ?? '')} · {String(b.duration_min ?? '')} мин</p>
              <p className="mt-1">{String(b.content ?? '')}</p>
              {!!b.interactive && <p className="text-xs text-primary/80 mt-1">📊 {String(b.interactive)}</p>}
            </div>
          ))}
          {!!live.promo_text && <p className="text-xs text-muted-foreground">Анонс: {String(live.promo_text)}</p>}
        </div>
      )
    }

    // Email
    const email = sd.email as Record<string, unknown> | undefined
    if (email) {
      return (
        <div className="space-y-2 text-sm">
          {!!email.subject && <p><span className="text-xs text-muted-foreground">Тема: </span><span className="font-semibold">{String(email.subject)}</span></p>}
          {!!email.preheader && <p className="text-xs text-muted-foreground">Прехедер: {String(email.preheader)}</p>}
          {!!email.body && <p className="whitespace-pre-wrap leading-relaxed mt-2">{String(email.body)}</p>}
          {!!email.cta_text && <p className="text-primary text-xs">→ {String(email.cta_text)}</p>}
          {!!email.ps && <p className="text-xs text-muted-foreground mt-1">P.S. {String(email.ps)}</p>}
        </div>
      )
    }
  }

  // Fallback
  return <div className="text-sm text-muted-foreground whitespace-pre-wrap">{JSON.stringify(sd || item.body_text, null, 2)}</div>
}

// ── Main component ────────────────────────────────────────────────────────────
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
  const [addingToDay, setAddingToDay] = useState<number | null>(null)
  // key = "dayNum-contentType" — which content is expanded for viewing
  const [viewingKey, setViewingKey] = useState<string | null>(null)

  void projectId
  void warmupPlanId
  void toast

  async function handleGenerate(day: DayContent, contentType: ContentType) {
    const key = `${day.day}-${contentType}`
    setGeneratingDay(key)
    setViewingKey(null) // close any viewer while generating
    try {
      const theme = day.dayBriefs?.[contentType] || day.theme
      await onGenerate(day.day, contentType, day.phase || 'awareness', theme)
      // Auto-open the viewer after generation
      setViewingKey(key)
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
        Нажми на тип контента чтобы сгенерировать. После генерации — нажми снова чтобы прочитать.
        <strong className="text-foreground"> +</strong> добавить тип, <strong className="text-foreground">×</strong> убрать.
      </p>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8 border-border" onClick={() => onWeekChange(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[120px] text-center">Неделя {weekNumber}</span>
          <Button variant="outline" size="icon" className="h-8 w-8 border-border" onClick={() => onWeekChange(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" className="border-border text-xs h-8 px-2.5"
            onClick={handleGenerateWeekBriefClick}
            disabled={loading || generatingWeekBrief}
            title="AI пропишет темы для каждого дня на основе плана прогрева — затем нажимай на каждый тип контента чтобы сгенерировать текст"
          >
            {generatingWeekBrief
              ? <><Loader2 className="h-3 w-3 animate-spin shrink-0" /><span className="ml-1">Составляю план...</span></>
              : <><Sparkles className="h-3 w-3 shrink-0" /><span className="ml-1">Создать контент-план</span></>
            }
          </Button>
          <Button variant="outline" size="sm" className="border-border text-xs h-8 px-2.5" onClick={onExport} title="Скачать контент-план">
            <Download className="h-3 w-3 shrink-0" />
            <span className="hidden sm:inline ml-1">Скачать</span>
          </Button>
        </div>
      </div>

      {/* Day list */}
      <div className="space-y-2">
        {days.map((day) => {
          const phaseName = day.phase ? PHASE_NAMES[day.phase] : null
          const displayTypes = (day.plannedTypes && day.plannedTypes.length > 0)
            ? day.plannedTypes
            : (['post', 'stories', 'reels'] as ContentType[])
          const isAddOpen = addingToDay === day.day
          const availableToAdd = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))

          return (
            <div key={day.day} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-start gap-3 p-3">
                {/* Day name + date */}
                <div className="w-14 shrink-0 pt-0.5">
                  <p className="text-sm font-bold text-foreground leading-tight">{day.dayOfWeek}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-none">{day.date}</p>
                </div>

                {/* Content area */}
                <div className="flex-1 min-w-0 space-y-2">
                  {day.theme && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{day.theme}</p>
                  )}

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {displayTypes.map((type) => {
                      const config = CONTENT_TYPE_CONFIG[type]
                      if (!config) return null
                      const existingItem = day.items.find((i) => i.content_type === type)
                      const genKey = `${day.day}-${type}`
                      const isGenerating = generatingDay === genKey
                      const isViewing = viewingKey === genKey
                      const briefText = day.dayBriefs?.[type]

                      return (
                        <div key={type} className="flex items-center gap-0.5">
                          <button
                            onClick={() => {
                              if (isGenerating) return
                              if (existingItem) {
                                // toggle viewer
                                setViewingKey(isViewing ? null : genKey)
                                setAddingToDay(null)
                              } else {
                                handleGenerate(day, type)
                              }
                            }}
                            title={existingItem ? 'Нажми чтобы прочитать контент' : (briefText || `Сгенерировать ${config.label}`)}
                            className={`flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-lg text-xs font-medium border transition-all ${
                              existingItem
                                ? isViewing
                                  ? `${config.doneColor} ring-1 ring-current cursor-pointer`
                                  : `${config.doneColor} hover:opacity-90 cursor-pointer`
                                : `${config.color} hover:opacity-80 cursor-pointer`
                            }`}
                          >
                            {isGenerating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : existingItem ? (
                              isViewing ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />
                            ) : (
                              <Sparkles className="h-3 w-3" />
                            )}
                            {config.label}
                            {existingItem && !isViewing && <Check className="h-2.5 w-2.5 ml-0.5" />}
                          </button>

                          {/* Remove × — only for types without content, always visible on mobile */}
                          {onRemoveType && !existingItem && !isGenerating && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRemoveType(day.day, type) }}
                              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-red-500/20 hover:text-red-400 active:bg-red-500/20 active:text-red-400 transition-all"
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
                      <Badge className="text-[10px] shrink-0 whitespace-nowrap hidden md:flex">{phaseName}</Badge>
                    )}
                  </div>

                  {/* Inline type selector */}
                  {isAddOpen && availableToAdd.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground self-center">Добавить:</span>
                      {availableToAdd.map(type => {
                        const config = CONTENT_TYPE_CONFIG[type]
                        return (
                          <button key={type}
                            onClick={() => { onAddType!(day.day, type); setAddingToDay(null) }}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${config.color} hover:opacity-80`}
                          >
                            <Plus className="h-2.5 w-2.5" />
                            {config.label}
                          </button>
                        )
                      })}
                      <button onClick={() => setAddingToDay(null)} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Отмена
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Inline content viewer ───────────────────────────────── */}
              {viewingKey && viewingKey.startsWith(`${day.day}-`) && (() => {
                const type = viewingKey.replace(`${day.day}-`, '') as ContentType
                const item = day.items.find(i => i.content_type === type)
                const config = CONTENT_TYPE_CONFIG[type]
                if (!item || !config) return null
                const isRegenerating = generatingDay === viewingKey
                return (
                  <div className="border-t border-border bg-secondary/10 p-4 space-y-3">
                    {/* Viewer header */}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${config.doneColor}`}>
                        {config.label} · День {day.day}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs border-border px-2 gap-1"
                          disabled={isRegenerating}
                          onClick={() => handleGenerate(day, type)}
                          title="Перегенерировать"
                        >
                          {isRegenerating
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RefreshCw className="h-3 w-3" />
                          }
                          <span className="hidden sm:inline">Обновить</span>
                        </Button>
                        <button onClick={() => setViewingKey(null)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Content body */}
                    <div className="rounded-lg border border-border bg-card p-3 max-h-[60vh] overflow-y-auto">
                      {renderContent(item)}
                    </div>

                    {/* Hashtags if any */}
                    {item.hashtags && item.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.hashtags.map((h, i) => (
                          <span key={i} className="text-[10px] text-primary/70 bg-primary/5 border border-primary/10 rounded px-1.5 py-0.5">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* Legend */}
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
