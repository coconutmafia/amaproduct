'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import {
  Sparkles, ChevronLeft, ChevronRight, Download, Loader2,
  Plus, X, Eye, EyeOff, RefreshCw, Check, Calendar, List,
  Zap,
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
  onGenerate: (day: number, contentType: ContentType, phase: WarmupPhase, theme?: string, additionalInstructions?: string) => void
  onGenerateWeekBrief?: () => Promise<void>
  onExport: () => void
  onRemoveType?: (dayNum: number, type: ContentType) => void
  onAddType?: (dayNum: number, type: ContentType) => void
  loading?: boolean
}

const DISPLAY_TYPES: ContentType[] = ['post', 'carousel', 'reels', 'stories', 'live', 'email']

// ── Pastel color config (calendar card style) ─────────────────────────────────
const CONTENT_TYPE_CONFIG: Record<ContentType, {
  label: string
  cardBg: string
  cardText: string
  cardBorder: string
  badgeColor: string // legacy dark bg
  doneColor: string
}> = {
  post:     {
    label: 'Пост',
    cardBg: 'bg-blue-50',        cardText: 'text-blue-600',   cardBorder: 'border-blue-100',
    badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-400/20',
    doneColor:  'bg-blue-500/30 text-blue-300 border-blue-400/40',
  },
  carousel: {
    label: 'Карусель',
    cardBg: 'bg-purple-50',      cardText: 'text-purple-600', cardBorder: 'border-purple-100',
    badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-400/20',
    doneColor:  'bg-purple-500/30 text-purple-300 border-purple-400/40',
  },
  reels:    {
    label: 'Видео',
    cardBg: 'bg-pink-50',        cardText: 'text-pink-600',   cardBorder: 'border-pink-100',
    badgeColor: 'bg-pink-500/20 text-pink-400 border-pink-400/20',
    doneColor:  'bg-pink-500/30 text-pink-300 border-pink-400/40',
  },
  stories:  {
    label: 'Сторис',
    cardBg: 'bg-green-50',       cardText: 'text-green-600',  cardBorder: 'border-green-100',
    badgeColor: 'bg-green-500/20 text-green-400 border-green-400/20',
    doneColor:  'bg-green-500/30 text-green-300 border-green-400/40',
  },
  live:     {
    label: 'Эфир',
    cardBg: 'bg-red-50',         cardText: 'text-red-600',    cardBorder: 'border-red-100',
    badgeColor: 'bg-red-500/20 text-red-400 border-red-400/20',
    doneColor:  'bg-red-500/30 text-red-300 border-red-400/40',
  },
  webinar:  {
    label: 'Вебинар',
    cardBg: 'bg-rose-50',        cardText: 'text-rose-600',   cardBorder: 'border-rose-100',
    badgeColor: 'bg-rose-500/20 text-rose-400 border-rose-400/20',
    doneColor:  'bg-rose-500/30 text-rose-300 border-rose-400/40',
  },
  email:    {
    label: 'Email',
    cardBg: 'bg-amber-50',       cardText: 'text-amber-600',  cardBorder: 'border-amber-100',
    badgeColor: 'bg-yellow-500/20 text-yellow-400 border-yellow-400/20',
    doneColor:  'bg-yellow-500/30 text-yellow-300 border-yellow-400/40',
  },
}

const PHASE_NAMES: Record<string, string> = {
  niche: 'На нишу', expert: 'На эксперта', product: 'На продукт', objections: 'Возражения',
  activation: 'Активация', awareness: 'Знакомство', trust: 'Доверие', desire: 'Желание', close: 'Закрытие',
}

// ── Content renderer ──────────────────────────────────────────────────────────
function renderContent(item: ContentItem) {
  const sd = item.structured_data as Record<string, unknown> | null

  if (item.content_type === 'post' || item.body_text) {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.body_text || '(нет текста)'}</div>
  }
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
          </div>
        ))}
      </div>
    )
  }
  if (item.content_type === 'stories' && sd?.stories_series) {
    const series = sd.stories_series as Record<string, unknown>
    const stories = (series.stories as Record<string, unknown>[] | undefined) || []
    return (
      <div className="space-y-3 text-sm">
        {stories.map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-1 bg-secondary/20">
            <p className="text-xs font-bold text-muted-foreground">Сториз {String(s.story_number)}</p>
            {!!(s.text as Record<string, unknown>)?.main_text && <p>{String((s.text as Record<string, unknown>).main_text)}</p>}
          </div>
        ))}
      </div>
    )
  }
  if (item.content_type === 'carousel' && sd?.carousel) {
    const c = sd.carousel as Record<string, unknown>
    const cover = c.cover as Record<string, unknown> | undefined
    const slides = (c.slides as Record<string, unknown>[] | undefined) || []
    return (
      <div className="space-y-3 text-sm">
        {cover && <div className="border border-primary/30 rounded-lg p-3 bg-primary/5"><p className="font-semibold">{String(cover.headline ?? '')}</p></div>}
        {slides.map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3 bg-secondary/20">
            <p className="text-xs font-bold text-muted-foreground mb-1">Слайд {String(s.slide)}</p>
            <p className="font-medium">{String(s.headline ?? '')}</p>
            {!!s.body && <p className="text-muted-foreground text-xs mt-1">{String(s.body)}</p>}
          </div>
        ))}
      </div>
    )
  }
  if (sd) {
    const email = (sd as Record<string, unknown>).email as Record<string, unknown> | undefined
    if (email) {
      return (
        <div className="space-y-2 text-sm">
          {!!email.subject && <p><span className="text-xs text-muted-foreground">Тема: </span><span className="font-semibold">{String(email.subject)}</span></p>}
          {!!email.body && <p className="whitespace-pre-wrap leading-relaxed mt-2">{String(email.body)}</p>}
        </div>
      )
    }
  }
  return <div className="text-sm text-muted-foreground whitespace-pre-wrap">{JSON.stringify(sd || item.body_text, null, 2)}</div>
}

// ── Calendar content card ─────────────────────────────────────────────────────
interface CardProps {
  type: ContentType
  day: DayContent
  isGenerating: boolean
  isViewing: boolean
  isGenerated: boolean
  isPending: boolean
  brief?: string
  onClickGenerate: () => void
  onClickView: () => void
  onRemove?: () => void
}
function ContentCard({ type, day, isGenerating, isViewing, isGenerated, isPending, brief, onClickGenerate, onClickView, onRemove }: CardProps) {
  const cfg = CONTENT_TYPE_CONFIG[type]
  if (!cfg) return null

  const shortTheme = (brief || day.theme || '').slice(0, 55) + ((brief || day.theme || '').length > 55 ? '…' : '')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative group rounded-xl border p-2.5 cursor-pointer transition-all hover:shadow-sm ${
        isViewing || isPending
          ? `${cfg.cardBg} ${cfg.cardBorder} border ring-2 ring-offset-1 ${cfg.cardText.replace('text-', 'ring-')}`
          : isGenerated
            ? `${cfg.cardBg} ${cfg.cardBorder} border`
            : `bg-white border-dashed border-[#E0E0E0] hover:${cfg.cardBg} hover:${cfg.cardBorder}`
      }`}
      onClick={isGenerated ? onClickView : onClickGenerate}
    >
      {/* Type label */}
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isGenerated || isViewing || isPending ? cfg.cardText : 'text-[#999]'}`}>
          {cfg.label}
        </span>
        {isGenerating ? (
          <Loader2 className={`h-3 w-3 animate-spin ${cfg.cardText}`} />
        ) : isGenerated ? (
          isViewing
            ? <EyeOff className={`h-3 w-3 ${cfg.cardText}`} />
            : <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Sparkles className={`h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity ${cfg.cardText}`} />
        )}
      </div>

      {/* Brief/theme text */}
      {shortTheme && (
        <p className="text-[11px] text-[#666] leading-tight line-clamp-2">{shortTheme}</p>
      )}

      {/* Remove button — only on non-generated types */}
      {onRemove && !isGenerated && !isGenerating && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-white border border-[#E0E0E0] text-[#999] hover:bg-red-50 hover:text-red-400 hover:border-red-200 transition-all shadow-sm"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </motion.div>
  )
}

// ── Phase dot ─────────────────────────────────────────────────────────────────
const PHASE_COLORS: Record<string, string> = {
  awareness: 'bg-blue-400', trust: 'bg-indigo-400', desire: 'bg-pink-400', close: 'bg-rose-500',
  niche: 'bg-teal-400', expert: 'bg-cyan-400', product: 'bg-amber-400', objections: 'bg-orange-400',
  activation: 'bg-green-400',
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
  const [viewMode, setViewMode] = useState<'week' | 'list'>('week')
  const [generatingDay, setGeneratingDay] = useState<string | null>(null)
  const [generatingWeekBrief, setGeneratingWeekBrief] = useState(false)
  const [addingToDay, setAddingToDay] = useState<number | null>(null)
  const [viewingKey, setViewingKey] = useState<string | null>(null)
  const [pendingBadge, setPendingBadge] = useState<{ day: number; type: ContentType; phase: WarmupPhase; theme?: string } | null>(null)
  const [extraContext, setExtraContext] = useState('')

  void projectId
  void warmupPlanId
  void toast

  const activeDay = pendingBadge?.day ?? (viewingKey ? parseInt(viewingKey.split('-')[0]) : null)

  async function handleGenerate(day: DayContent, contentType: ContentType, additionalInstructions?: string) {
    const key = `${day.day}-${contentType}`
    setGeneratingDay(key)
    setViewingKey(null)
    setPendingBadge(null)
    setExtraContext('')
    try {
      const theme = day.dayBriefs?.[contentType] || day.theme
      await onGenerate(day.day, contentType, day.phase || 'awareness', theme, additionalInstructions || undefined)
      setViewingKey(key)
    } finally {
      setGeneratingDay(null)
    }
  }

  async function handlePendingGenerate() {
    if (!pendingBadge) return
    const key = `${pendingBadge.day}-${pendingBadge.type}`
    setGeneratingDay(key)
    setViewingKey(null)
    const { day: dayNum, type, phase, theme } = pendingBadge
    setPendingBadge(null)
    const extra = extraContext.trim()
    setExtraContext('')
    try {
      await onGenerate(dayNum, type, phase, theme, extra || undefined)
      setViewingKey(key)
    } finally {
      setGeneratingDay(null)
    }
  }

  async function handleGenerateWeekBriefClick() {
    if (!onGenerateWeekBrief) return
    setGeneratingWeekBrief(true)
    try { await onGenerateWeekBrief() } finally { setGeneratingWeekBrief(false) }
  }

  // ── Week view (calendar grid) ───────────────────────────────────────────────
  const WeekView = () => (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {days.map((day) => {
            const phase = day.phase
            const phaseColor = phase ? PHASE_COLORS[phase] : 'bg-gray-300'
            const isActive = day.day === activeDay
            return (
              <div key={day.day} className={`text-center py-2.5 rounded-xl transition-colors ${isActive ? 'bg-[#F9F0F4]' : ''}`}>
                <p className={`text-xs font-bold uppercase tracking-wider ${isActive ? 'text-[#D44E7E]' : 'text-[#888]'}`}>
                  {day.dayOfWeek}
                </p>
                <p className="text-[10px] text-[#aaa] mt-0.5">{day.date.slice(0, 5)}</p>
                {phase && (
                  <div className="flex items-center justify-center gap-1 mt-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${phaseColor}`} />
                    <span className="text-[9px] text-[#aaa] truncate max-w-[60px]">{PHASE_NAMES[phase]}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Day columns */}
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => {
            const displayTypes = (day.plannedTypes && day.plannedTypes.length > 0)
              ? day.plannedTypes
              : (['post', 'stories', 'reels'] as ContentType[])
            const availableToAdd = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))
            const isAddOpen = addingToDay === day.day

            return (
              <div key={day.day} className="space-y-1.5 min-h-[120px]">
                {displayTypes.map((type) => {
                  const existingItem = day.items.find(i => i.content_type === type)
                  const genKey = `${day.day}-${type}`
                  const isGenerating = generatingDay === genKey
                  const isViewing = viewingKey === genKey
                  const isPending = pendingBadge?.day === day.day && pendingBadge?.type === type
                  const brief = day.dayBriefs?.[type]

                  return (
                    <ContentCard
                      key={type}
                      type={type}
                      day={day}
                      isGenerating={isGenerating}
                      isViewing={isViewing}
                      isGenerated={!!existingItem}
                      isPending={isPending}
                      brief={brief}
                      onClickGenerate={() => {
                        if (isGenerating) return
                        if (isPending) { setPendingBadge(null); setExtraContext('') ; return }
                        setPendingBadge({ day: day.day, type, phase: day.phase || 'awareness', theme: brief || day.theme })
                        setViewingKey(null)
                        setAddingToDay(null)
                      }}
                      onClickView={() => {
                        if (isGenerating) return
                        setViewingKey(isViewing ? null : genKey)
                        setPendingBadge(null)
                        setAddingToDay(null)
                      }}
                      onRemove={onRemoveType ? () => onRemoveType(day.day, type) : undefined}
                    />
                  )
                })}

                {/* Add type */}
                {onAddType && availableToAdd.length > 0 && (
                  <div>
                    <button
                      onClick={() => setAddingToDay(isAddOpen ? null : day.day)}
                      className="w-full flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] border border-dashed border-[#DDD] text-[#BBB] hover:border-[#D44E7E]/40 hover:text-[#D44E7E] transition-all"
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                    {isAddOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-1 p-2 rounded-xl border border-[#E8E8E8] bg-white shadow-lg space-y-1 z-20 relative"
                      >
                        {availableToAdd.map(t => {
                          const cfg = CONTENT_TYPE_CONFIG[t]
                          return (
                            <button
                              key={t}
                              onClick={() => { onAddType(day.day, t); setAddingToDay(null) }}
                              className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${cfg.cardBg} ${cfg.cardText}`}
                            >
                              <Plus className="h-2.5 w-2.5" />{cfg.label}
                            </button>
                          )
                        })}
                        <button onClick={() => setAddingToDay(null)} className="text-[10px] text-[#aaa] w-full text-center py-1">Отмена</button>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ── List view (original compact rows) ─────────────────────────────────────
  const ListView = () => (
    <div className="space-y-2">
      {days.map((day) => {
        const phaseName = day.phase ? PHASE_NAMES[day.phase] : null
        const displayTypes = (day.plannedTypes && day.plannedTypes.length > 0)
          ? day.plannedTypes
          : (['post', 'stories', 'reels'] as ContentType[])
        const isAddOpen = addingToDay === day.day
        const availableToAdd = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))

        return (
          <div key={day.day} className="rounded-xl border border-[#ECECEC] bg-white overflow-hidden">
            <div className="flex items-start gap-3 p-3">
              <div className="w-14 shrink-0 pt-0.5">
                <p className="text-sm font-bold text-[#222] leading-tight">{day.dayOfWeek}</p>
                <p className="text-[11px] text-[#999] mt-1">{day.date}</p>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {day.theme && !day.dayBriefs && (
                  <p className="text-xs text-[#888]">{day.theme}</p>
                )}
                {day.dayBriefs && Object.keys(day.dayBriefs).length > 0 && (() => {
                  const types = (day.plannedTypes && day.plannedTypes.length > 0) ? day.plannedTypes : (['post', 'stories', 'reels'] as ContentType[])
                  const briefEntries = types.filter(t => day.dayBriefs?.[t])
                  if (briefEntries.length === 0) return null
                  return (
                    <div className="space-y-1.5">
                      {briefEntries.map(type => {
                        const cfg = CONTENT_TYPE_CONFIG[type]
                        if (!cfg) return null
                        return (
                          <div key={type} className="flex items-start gap-1.5">
                            <span className={`text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded border leading-tight mt-0.5 ${cfg.cardBg} ${cfg.cardText} ${cfg.cardBorder}`}>
                              {cfg.label.toUpperCase()}
                            </span>
                            <p className="text-xs text-[#888] leading-snug">{day.dayBriefs![type]}</p>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {displayTypes.map((type) => {
                    const config = CONTENT_TYPE_CONFIG[type]
                    if (!config) return null
                    const existingItem = day.items.find(i => i.content_type === type)
                    const genKey = `${day.day}-${type}`
                    const isGenerating = generatingDay === genKey
                    const isViewing = viewingKey === genKey
                    const isPending = pendingBadge?.day === day.day && pendingBadge?.type === type
                    return (
                      <div key={type} className="flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            if (isGenerating) return
                            if (existingItem) { setViewingKey(isViewing ? null : genKey); setAddingToDay(null) }
                            else {
                              if (isPending) { setPendingBadge(null); setExtraContext('') }
                              else { setPendingBadge({ day: day.day, type, phase: day.phase || 'awareness', theme: day.dayBriefs?.[type] || day.theme }); setViewingKey(null); setAddingToDay(null) }
                            }
                          }}
                          className={`flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-lg text-xs font-medium border transition-all ${
                            existingItem
                              ? isViewing ? `${config.cardBg} ${config.cardBorder} border ${config.cardText} ring-1 ring-current` : `${config.cardBg} ${config.cardBorder} border ${config.cardText}`
                              : isPending ? `${config.cardBg} ${config.cardBorder} border ${config.cardText} ring-1 ring-current` : `${config.badgeColor}`
                          }`}
                        >
                          {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" />
                            : existingItem ? (isViewing ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />)
                            : <Sparkles className="h-3 w-3" />}
                          {config.label}
                          {existingItem && !isViewing && <Check className="h-2.5 w-2.5 ml-0.5" />}
                        </button>
                        {onRemoveType && !existingItem && !isGenerating && (
                          <button onClick={(e) => { e.stopPropagation(); onRemoveType(day.day, type) }} className="flex h-4 w-4 items-center justify-center rounded-full text-[#aaa] hover:bg-red-500/20 hover:text-red-400 transition-all">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {onAddType && availableToAdd.length > 0 && (
                    <button onClick={() => setAddingToDay(isAddOpen ? null : day.day)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-dashed border-[#DDD] text-[#BBB] hover:border-[#D44E7E]/40 hover:text-[#D44E7E] transition-all">
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                  {phaseName && <Badge className="text-[10px] shrink-0 whitespace-nowrap hidden md:flex">{phaseName}</Badge>}
                </div>
                {isAddOpen && availableToAdd.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#F0F0F0]">
                    <span className="text-[10px] text-[#aaa] self-center">Добавить:</span>
                    {availableToAdd.map(type => {
                      const config = CONTENT_TYPE_CONFIG[type]
                      return (
                        <button key={type} onClick={() => { onAddType!(day.day, type); setAddingToDay(null) }}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${config.cardBg} ${config.cardText} ${config.cardBorder}`}>
                          <Plus className="h-2.5 w-2.5" />{config.label}
                        </button>
                      )
                    })}
                    <button onClick={() => setAddingToDay(null)} className="px-2 py-1 text-xs text-[#aaa] hover:text-[#444] transition-colors">Отмена</button>
                  </div>
                )}
              </div>
            </div>

            {/* Pending panel */}
            {pendingBadge && pendingBadge.day === day.day && (() => {
              const config = CONTENT_TYPE_CONFIG[pendingBadge.type]
              if (!config) return null
              const typeBrief = day.dayBriefs?.[pendingBadge.type]
              const isRegen = day.items.some(i => i.content_type === pendingBadge.type)
              return (
                <div className="border-t border-[#F0F0F0] bg-[#FAFAFA] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${config.cardBg} ${config.cardText} ${config.cardBorder}`}>
                      {isRegen ? `Обновить ${config.label}` : config.label} · День {day.day}
                    </span>
                    <button onClick={() => { setPendingBadge(null); setExtraContext('') }} className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E8E8E8] text-[#aaa] hover:text-[#444] transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {typeBrief && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">Тема</p>
                      <p className="text-sm text-foreground">{typeBrief}</p>
                    </div>
                  )}
                  <VoiceTextarea value={extraContext} onChange={setExtraContext}
                    placeholder={typeBrief ? "Надиктуй детали: историю, кейс, имя клиента..." : "Надиктуй детали: кейс, продукт..."}
                    rows={2} />
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="gradient-accent text-white hover:opacity-90 gap-1.5 flex-1" onClick={handlePendingGenerate} disabled={!!generatingDay}>
                      {generatingDay === `${pendingBadge.day}-${pendingBadge.type}`
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Создаю...</>
                        : isRegen ? <><RefreshCw className="h-3 w-3" /> Обновить</> : <><Sparkles className="h-3 w-3" /> Создать</>}
                    </Button>
                    <button onClick={() => { setPendingBadge(null); setExtraContext('') }} className="text-xs text-[#aaa] hover:text-[#444] transition-colors px-2">Отмена</button>
                  </div>
                </div>
              )
            })()}

            {/* Viewer */}
            {viewingKey && viewingKey.startsWith(`${day.day}-`) && (() => {
              const type = viewingKey.replace(`${day.day}-`, '') as ContentType
              const item = day.items.find(i => i.content_type === type)
              const config = CONTENT_TYPE_CONFIG[type]
              if (!item || !config) return null
              return (
                <div className="border-t border-[#F0F0F0] bg-[#FAFAFA] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${config.cardBg} ${config.cardText} ${config.cardBorder}`}>{config.label} · День {day.day}</span>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs border-[#E8E8E8] px-2 gap-1"
                        onClick={() => { setViewingKey(null); setPendingBadge({ day: day.day, type, phase: day.phase || 'awareness', theme: day.dayBriefs?.[type] || day.theme }); setExtraContext('') }}>
                        <RefreshCw className="h-3 w-3" /><span className="hidden sm:inline">Обновить</span>
                      </Button>
                      <button onClick={() => setViewingKey(null)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E8E8E8] text-[#aaa] hover:text-[#444] transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#ECECEC] bg-white p-3 max-h-[60vh] overflow-y-auto">{renderContent(item)}</div>
                  {item.hashtags && item.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.hashtags.map((h, i) => <span key={i} className="text-[10px] text-primary/70 bg-primary/5 border border-primary/10 rounded px-1.5 py-0.5">{h}</span>)}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )

  // ── Generate/view panel for calendar mode ──────────────────────────────────
  const ActivePanel = () => {
    if (pendingBadge) {
      const day = days.find(d => d.day === pendingBadge.day)
      if (!day) return null
      const config = CONTENT_TYPE_CONFIG[pendingBadge.type]
      if (!config) return null
      const typeBrief = day.dayBriefs?.[pendingBadge.type]
      const isRegen = day.items.some(i => i.content_type === pendingBadge.type)
      return (
        <motion.div
          key="pending"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="rounded-2xl border border-[#E8E8E8] bg-white shadow-sm p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${config.cardBg} ${config.cardText} ${config.cardBorder}`}>
                {config.label}
              </span>
              <span className="text-sm text-[#888]">{day.dayOfWeek}, {day.date}</span>
              {day.phase && <span className="text-[10px] text-[#aaa]">{PHASE_NAMES[day.phase]}</span>}
            </div>
            <button onClick={() => { setPendingBadge(null); setExtraContext('') }} className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#aaa] hover:text-[#444] transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {typeBrief && (
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-3">
              <p className="text-[10px] font-bold text-primary/60 uppercase tracking-wide mb-1">Тема дня</p>
              <p className="text-sm text-[#333]">{typeBrief}</p>
            </div>
          )}
          <VoiceTextarea value={extraContext} onChange={setExtraContext}
            placeholder="Надиктуй детали: кейс, историю, имя клиента — AI вплетёт в контент..."
            rows={2} />
          <div className="flex gap-2">
            <Button className="gradient-accent text-white hover:opacity-90 gap-1.5 flex-1" onClick={handlePendingGenerate} disabled={!!generatingDay}>
              {generatingDay === `${pendingBadge.day}-${pendingBadge.type}`
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Создаю...</>
                : isRegen ? <><RefreshCw className="h-4 w-4" /> Обновить</> : <><Sparkles className="h-4 w-4" /> Создать</>}
            </Button>
            <button onClick={() => { setPendingBadge(null); setExtraContext('') }} className="text-sm text-[#aaa] hover:text-[#444] transition-colors px-3">Отмена</button>
          </div>
        </motion.div>
      )
    }
    if (viewingKey) {
      const [dayNum, type] = viewingKey.split('-')
      const day = days.find(d => d.day === parseInt(dayNum))
      const contentType = type as ContentType
      const item = day?.items.find(i => i.content_type === contentType)
      const config = CONTENT_TYPE_CONFIG[contentType]
      if (!item || !config || !day) return null
      return (
        <motion.div
          key="viewer"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="rounded-2xl border border-[#E8E8E8] bg-white shadow-sm p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${config.cardBg} ${config.cardText} ${config.cardBorder}`}>{config.label}</span>
              <span className="text-sm text-[#888]">{day.dayOfWeek}, {day.date}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-xs border-[#E8E8E8] gap-1"
                onClick={() => { setViewingKey(null); setPendingBadge({ day: day.day, type: contentType, phase: day.phase || 'awareness', theme: day.dayBriefs?.[contentType] || day.theme }); setExtraContext('') }}>
                <RefreshCw className="h-3.5 w-3.5" /> Обновить
              </Button>
              <button onClick={() => setViewingKey(null)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#aaa] hover:text-[#444] transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-[#ECECEC] bg-[#FAFAFA] p-4 max-h-[55vh] overflow-y-auto">{renderContent(item)}</div>
          {item.hashtags && item.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.hashtags.map((h, i) => <span key={i} className="text-[10px] text-primary/70 bg-primary/5 border border-primary/10 rounded px-1.5 py-0.5">{h}</span>)}
            </div>
          )}
        </motion.div>
      )
    }
    return null
  }

  return (
    <div className="space-y-5">
      {/* Instruction */}
      <p className="text-xs text-[#888] bg-[#F7F7F7] rounded-xl px-4 py-2.5 border border-[#ECECEC]">
        Нажми на карточку, чтобы сгенерировать контент. После создания — нажми ещё раз, чтобы прочитать.
      </p>

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Week nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onWeekChange(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#888] hover:bg-[#F7F7F7] hover:text-[#333] transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-[#333] min-w-[90px] text-center">Неделя {weekNumber}</span>
          <button
            onClick={() => onWeekChange(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#888] hover:bg-[#F7F7F7] hover:text-[#333] transition-all"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-[#F7F7F7] rounded-xl p-1 border border-[#ECECEC]">
          {([
            { mode: 'week' as const, icon: Calendar, label: 'Неделя' },
            { mode: 'list' as const, icon: List, label: 'Список' },
          ]).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === mode ? 'bg-white text-[#333] shadow-sm border border-[#E8E8E8]' : 'text-[#888] hover:text-[#555]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateWeekBriefClick}
            disabled={loading || generatingWeekBrief}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl text-xs font-semibold border border-[#E8E8E8] bg-white text-[#555] hover:border-[#D44E7E]/30 hover:text-[#D44E7E] transition-all disabled:opacity-50"
          >
            {generatingWeekBrief
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /><span className="ml-1">Создаю план...</span></>
              : <><Zap className="h-3.5 w-3.5 shrink-0" /><span className="ml-1 hidden sm:inline">Заполнить неделю</span></>}
          </button>
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border border-[#E8E8E8] bg-white text-[#888] hover:text-[#555] transition-all"
            title="Скачать контент-план"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main grid / list */}
      <AnimatePresence mode="wait">
        <motion.div key={viewMode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
          {viewMode === 'week' ? <WeekView /> : <ListView />}
        </motion.div>
      </AnimatePresence>

      {/* Active panel (generate / view) — only shown in week mode */}
      {viewMode === 'week' && (
        <AnimatePresence mode="wait">
          <ActivePanel key={viewingKey || (pendingBadge ? `p-${pendingBadge.day}-${pendingBadge.type}` : 'none')} />
        </AnimatePresence>
      )}

      {/* Type legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
        {DISPLAY_TYPES.map((key) => {
          const { label, cardBg, cardText } = CONTENT_TYPE_CONFIG[key]
          return (
            <span key={key} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-lg ${cardBg} ${cardText}`}>
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
