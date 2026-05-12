'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import {
  Sparkles, ChevronLeft, ChevronRight, Download, Loader2,
  Plus, X, Eye, EyeOff, RefreshCw, Check, Calendar, List, Zap,
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

// ── Color config: hardcoded hex values (Tailwind purges dynamic classes) ──────
interface TypeColors {
  label: string
  /** light background — empty/planned cards */
  bg: string
  /** saturated background — generated / active cards */
  bgDone: string
  /** normal border */
  border: string
  /** active/done border */
  borderDone: string
  /** text */
  text: string
  /** dark text for done state */
  textDone: string
}

const COLORS: Record<ContentType, TypeColors> = {
  post:    { label: 'Пост',    bg: '#DBEAFE', bgDone: '#BFDBFE', border: '#93C5FD', borderDone: '#3B82F6', text: '#1E40AF', textDone: '#1D4ED8' },
  carousel:{ label: 'Карусель',bg: '#EDE9FE', bgDone: '#DDD6FE', border: '#C4B5FD', borderDone: '#7C3AED', text: '#4C1D95', textDone: '#5B21B6' },
  reels:   { label: 'Рилз',    bg: '#FCE7F3', bgDone: '#FBCFE8', border: '#F9A8D4', borderDone: '#DB2777', text: '#831843', textDone: '#9D174D' },
  stories: { label: 'Сторис',  bg: '#DCFCE7', bgDone: '#BBF7D0', border: '#86EFAC', borderDone: '#16A34A', text: '#14532D', textDone: '#15803D' },
  live:    { label: 'Эфир',    bg: '#FEE2E2', bgDone: '#FECACA', border: '#FCA5A5', borderDone: '#DC2626', text: '#7F1D1D', textDone: '#991B1B' },
  webinar: { label: 'Вебинар', bg: '#FFE4E6', bgDone: '#FECDD3', border: '#FDA4AF', borderDone: '#E11D48', text: '#881337', textDone: '#881337' },
  email:   { label: 'Email',   bg: '#FEF9C3', bgDone: '#FDE68A', border: '#FDE047', borderDone: '#CA8A04', text: '#713F12', textDone: '#78350F' },
}

const PHASE_NAMES: Record<string, string> = {
  niche: 'Ниша', expert: 'Эксперт', product: 'Продукт', objections: 'Возражения',
  activation: 'Активация', awareness: 'Знакомство', trust: 'Доверие', desire: 'Желание', close: 'Закрытие',
}
const PHASE_COLORS: Record<string, string> = {
  awareness: '#60A5FA', trust: '#818CF8', desire: '#F472B6', close: '#F87171',
  niche: '#34D399', expert: '#22D3EE', product: '#FBBF24', objections: '#FB923C',
  activation: '#4ADE80',
}

// ── Content renderer ──────────────────────────────────────────────────────────
function renderContent(item: ContentItem) {
  const sd = item.structured_data as Record<string, unknown> | null
  if (item.content_type === 'post' || item.body_text) {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#222]">{item.body_text || '(нет текста)'}</div>
  }
  if (item.content_type === 'reels' && sd?.reels) {
    const r = sd.reels as Record<string, unknown>
    const scenes = (r.scenes as Record<string, unknown>[] | undefined) || []
    return (
      <div className="space-y-3 text-sm">
        {!!r.title && <p className="font-semibold">{String(r.title)}</p>}
        {!!r.hook_text && <p className="text-[#666] italic">Крючок: {String(r.hook_text)}</p>}
        {scenes.map((s, i) => (
          <div key={i} className="border border-[#E8E8E8] rounded-lg p-3 bg-[#F7F7F7] space-y-1">
            <p className="text-xs font-bold text-[#888]">Сцена {String(s.scene)} · {String(s.timing)}</p>
            {!!(s.visual as Record<string, unknown>)?.action && <p>{String((s.visual as Record<string, unknown>).action)}</p>}
            {!!(s.audio as Record<string, unknown>)?.speech && <p className="text-[#D44E7E] text-xs">💬 {String((s.audio as Record<string, unknown>).speech)}</p>}
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
          <div key={i} className="border border-[#E8E8E8] rounded-lg p-3 bg-[#F7F7F7]">
            <p className="text-xs font-bold text-[#888] mb-1">Сториз {String(s.story_number)}</p>
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
        {cover && <div className="border border-[#D44E7E]/20 rounded-lg p-3 bg-[#FFF0F5]"><p className="font-semibold">{String(cover.headline ?? '')}</p></div>}
        {slides.map((s, i) => (
          <div key={i} className="border border-[#E8E8E8] rounded-lg p-3 bg-[#F7F7F7]">
            <p className="text-xs font-bold text-[#888] mb-1">Слайд {String(s.slide)}</p>
            <p className="font-medium">{String(s.headline ?? '')}</p>
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
          {!!email.subject && <p><span className="text-xs text-[#888]">Тема: </span><span className="font-semibold">{String(email.subject)}</span></p>}
          {!!email.body && <p className="whitespace-pre-wrap leading-relaxed mt-2">{String(email.body)}</p>}
        </div>
      )
    }
  }
  return <div className="text-sm text-[#888] whitespace-pre-wrap">{JSON.stringify(sd || item.body_text, null, 2)}</div>
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
  const c = COLORS[type]
  if (!c) return null

  const isActive = isViewing || isPending
  const bg     = isGenerated || isActive ? c.bgDone  : c.bg
  const border = isGenerated || isActive ? c.borderDone : c.border
  const text   = isGenerated || isActive ? c.textDone   : c.text
  const shortTheme = (brief || day.theme || '').slice(0, 52) + ((brief || day.theme || '').length > 52 ? '…' : '')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.93 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative group cursor-pointer rounded-xl p-2.5 transition-all"
      style={{
        backgroundColor: bg,
        border: `1.5px solid ${border}`,
        boxShadow: isActive ? `0 0 0 2px ${border}` : undefined,
      }}
      onClick={isGenerated ? onClickView : onClickGenerate}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: text }}>
          {c.label}
        </span>
        {isGenerating ? (
          <Loader2 className="h-3 w-3 animate-spin" style={{ color: text }} />
        ) : isGenerated ? (
          isViewing
            ? <EyeOff className="h-3 w-3" style={{ color: text }} />
            : <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Sparkles className="h-3 w-3 opacity-50" style={{ color: text }} />
        )}
      </div>
      {shortTheme && (
        <p className="text-[11px] leading-tight line-clamp-2" style={{ color: text, opacity: 0.75 }}>
          {shortTheme}
        </p>
      )}
      {onRemove && !isGenerated && !isGenerating && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-white border border-[#DDD] text-[#999] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all shadow-sm"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function ContentPlanGrid({
  projectId, warmupPlanId, weekNumber, days,
  onWeekChange, onGenerate, onGenerateWeekBrief, onExport,
  onRemoveType, onAddType, loading,
}: ContentPlanGridProps) {
  const viewMode = 'list' as const
  const [generatingDay, setGeneratingDay] = useState<string | null>(null)
  const [generatingWeekBrief, setGeneratingWeekBrief] = useState(false)
  const [addingToDay, setAddingToDay] = useState<number | null>(null)
  const [viewingKey, setViewingKey] = useState<string | null>(null)
  const [pendingBadge, setPendingBadge] = useState<{ day: number; type: ContentType; phase: WarmupPhase; theme?: string } | null>(null)
  const [extraContext, setExtraContext] = useState('')

  void projectId; void warmupPlanId; void toast

  const activeDay = pendingBadge?.day ?? (viewingKey ? parseInt(viewingKey.split('-')[0]) : null)

  async function handleGenerate(day: DayContent, contentType: ContentType, additionalInstructions?: string) {
    const key = `${day.day}-${contentType}`
    setGeneratingDay(key); setViewingKey(null); setPendingBadge(null); setExtraContext('')
    try {
      await onGenerate(day.day, contentType, day.phase || 'awareness', day.dayBriefs?.[contentType] || day.theme, additionalInstructions || undefined)
      setViewingKey(key)
    } finally { setGeneratingDay(null) }
  }

  async function handlePendingGenerate() {
    if (!pendingBadge) return
    const key = `${pendingBadge.day}-${pendingBadge.type}`
    setGeneratingDay(key); setViewingKey(null)
    const { day: dayNum, type, phase, theme } = pendingBadge
    setPendingBadge(null)
    const extra = extraContext.trim(); setExtraContext('')
    try {
      await onGenerate(dayNum, type, phase, theme, extra || undefined)
      setViewingKey(key)
    } finally { setGeneratingDay(null) }
  }

  async function handleGenerateWeekBriefClick() {
    if (!onGenerateWeekBrief) return
    setGeneratingWeekBrief(true)
    try { await onGenerateWeekBrief() } finally { setGeneratingWeekBrief(false) }
  }

  // ── Week grid view ──────────────────────────────────────────────────────────
  function WeekView() {
    return (
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[560px] sm:min-w-[680px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-2 mb-2">
            {days.map((day) => {
              const phaseColor = day.phase ? PHASE_COLORS[day.phase] : '#CBD5E1'
              const isActive = day.day === activeDay
              return (
                <div key={day.day} className="text-center py-2.5 rounded-xl transition-colors"
                  style={{ backgroundColor: isActive ? '#FDF2F7' : undefined }}>
                  <p className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: isActive ? '#D44E7E' : '#888' }}>
                    {day.dayOfWeek}
                  </p>
                  <p className="text-[10px] text-[#aaa] mt-0.5">{day.date.slice(0, 5)}</p>
                  {day.phase && (
                    <div className="flex items-center justify-center gap-1 mt-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: phaseColor }} />
                      <span className="text-[9px] text-[#aaa] truncate max-w-[58px]">{PHASE_NAMES[day.phase]}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Card columns */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((day) => {
              const displayTypes = (day.plannedTypes && day.plannedTypes.length > 0)
                ? day.plannedTypes : (['post', 'stories', 'reels'] as ContentType[])
              const available = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))
              const isAddOpen = addingToDay === day.day

              return (
                <div key={day.day} className="space-y-1.5 min-h-[120px]">
                  {displayTypes.map((type) => {
                    const existing = day.items.find(i => i.content_type === type)
                    const genKey = `${day.day}-${type}`
                    return (
                      <ContentCard
                        key={type} type={type} day={day}
                        isGenerating={generatingDay === genKey}
                        isViewing={viewingKey === genKey}
                        isGenerated={!!existing}
                        isPending={pendingBadge?.day === day.day && pendingBadge?.type === type}
                        brief={day.dayBriefs?.[type]}
                        onClickGenerate={() => {
                          if (generatingDay === genKey) return
                          const isPending = pendingBadge?.day === day.day && pendingBadge?.type === type
                          if (isPending) { setPendingBadge(null); setExtraContext(''); return }
                          setPendingBadge({ day: day.day, type, phase: day.phase || 'awareness', theme: day.dayBriefs?.[type] || day.theme })
                          setViewingKey(null); setAddingToDay(null)
                        }}
                        onClickView={() => {
                          if (generatingDay === genKey) return
                          setViewingKey(viewingKey === genKey ? null : genKey)
                          setPendingBadge(null); setAddingToDay(null)
                        }}
                        onRemove={onRemoveType ? () => onRemoveType(day.day, type) : undefined}
                      />
                    )
                  })}

                  {/* Add type */}
                  {onAddType && available.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setAddingToDay(isAddOpen ? null : day.day)}
                        className="w-full flex items-center justify-center py-1.5 rounded-xl text-[10px] border border-dashed border-[#D4D4D4] text-[#BBB] hover:border-[#D44E7E]/50 hover:text-[#D44E7E] transition-all"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                      {isAddOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute top-full mt-1 left-0 right-0 p-1.5 rounded-xl border border-[#E8E8E8] bg-white shadow-xl z-30 space-y-1"
                        >
                          {available.map(t => {
                            const c = COLORS[t]
                            return (
                              <button key={t}
                                onClick={() => { onAddType(day.day, t); setAddingToDay(null) }}
                                className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                                style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                              >
                                <Plus className="h-2.5 w-2.5" />{c.label}
                              </button>
                            )
                          })}
                          <button onClick={() => setAddingToDay(null)} className="text-[10px] text-[#aaa] w-full text-center py-1">✕</button>
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
  }

  // ── List view ───────────────────────────────────────────────────────────────
  function ListView() {
    return (
      <div className="space-y-2">
        {days.map((day) => {
          const displayTypes = (day.plannedTypes && day.plannedTypes.length > 0)
            ? day.plannedTypes : (['post', 'stories', 'reels'] as ContentType[])
          const isAddOpen = addingToDay === day.day
          const available = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))

          return (
            <div key={day.day} className="rounded-xl border border-[#ECECEC] bg-white overflow-hidden">
              <div className="flex items-start gap-3 p-3">
                <div className="w-14 shrink-0 pt-0.5">
                  <p className="text-sm font-bold text-[#222]">{day.dayOfWeek}</p>
                  <p className="text-[11px] text-[#999] mt-0.5">{day.date}</p>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {day.theme && !day.dayBriefs && <p className="text-xs text-[#888]">{day.theme}</p>}
                  {day.dayBriefs && Object.keys(day.dayBriefs).length > 0 && (() => {
                    const types = (day.plannedTypes?.length ? day.plannedTypes : ['post', 'stories', 'reels']) as ContentType[]
                    const entries = types.filter(t => day.dayBriefs?.[t])
                    if (!entries.length) return null
                    return (
                      <div className="space-y-1.5">
                        {entries.map(type => {
                          const c = COLORS[type]
                          if (!c) return null
                          return (
                            <div key={type} className="flex items-start gap-1.5">
                              <span className="text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-md mt-0.5"
                                style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                                {c.label.toUpperCase()}
                              </span>
                              <p className="text-xs text-[#888] leading-snug">{day.dayBriefs![type]}</p>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {displayTypes.map(type => {
                      const c = COLORS[type]
                      if (!c) return null
                      const existing = day.items.find(i => i.content_type === type)
                      const genKey = `${day.day}-${type}`
                      const isGenerating = generatingDay === genKey
                      const isViewing = viewingKey === genKey
                      const isPending = pendingBadge?.day === day.day && pendingBadge?.type === type
                      const bgColor = existing || isPending ? c.bgDone : c.bg
                      const bColor  = existing || isPending ? c.borderDone : c.border
                      const tColor  = existing || isPending ? c.textDone : c.text
                      return (
                        <div key={type} className="flex items-center gap-0.5">
                          <button
                            onClick={() => {
                              if (isGenerating) return
                              if (existing) { setViewingKey(isViewing ? null : genKey); setAddingToDay(null) }
                              else {
                                if (isPending) { setPendingBadge(null); setExtraContext('') }
                                else { setPendingBadge({ day: day.day, type, phase: day.phase || 'awareness', theme: day.dayBriefs?.[type] || day.theme }); setViewingKey(null); setAddingToDay(null) }
                              }
                            }}
                            className="flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: bgColor, color: tColor, border: `1.5px solid ${bColor}`, boxShadow: isViewing || isPending ? `0 0 0 2px ${bColor}` : undefined }}
                          >
                            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" />
                              : existing ? (isViewing ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />)
                              : <Sparkles className="h-3 w-3" />}
                            {c.label}
                            {existing && !isViewing && <Check className="h-2.5 w-2.5 ml-0.5 text-green-600" />}
                          </button>
                          {onRemoveType && !existing && !isGenerating && (
                            <button onClick={(e) => { e.stopPropagation(); onRemoveType(day.day, type) }}
                              className="flex h-4 w-4 items-center justify-center rounded-full text-[#aaa] hover:bg-red-50 hover:text-red-500 transition-all">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {onAddType && available.length > 0 && (
                      <button onClick={() => setAddingToDay(isAddOpen ? null : day.day)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-dashed border-[#D4D4D4] text-[#BBB] hover:border-[#D44E7E]/50 hover:text-[#D44E7E] transition-all">
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                    {day.phase && <Badge className="text-[10px] shrink-0 hidden md:flex">{PHASE_NAMES[day.phase]}</Badge>}
                  </div>
                  {isAddOpen && available.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#F0F0F0]">
                      <span className="text-[10px] text-[#aaa] self-center">Добавить:</span>
                      {available.map(t => {
                        const c = COLORS[t]
                        return (
                          <button key={t} onClick={() => { onAddType!(day.day, t); setAddingToDay(null) }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                            style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                            <Plus className="h-2.5 w-2.5" />{c.label}
                          </button>
                        )
                      })}
                      <button onClick={() => setAddingToDay(null)} className="px-2 py-1 text-xs text-[#aaa] hover:text-[#444]">Отмена</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Pending panel (list mode) */}
              {pendingBadge?.day === day.day && (() => {
                const c = COLORS[pendingBadge.type]
                if (!c) return null
                const typeBrief = day.dayBriefs?.[pendingBadge.type]
                const isRegen = day.items.some(i => i.content_type === pendingBadge.type)
                return (
                  <div className="border-t border-[#F0F0F0] bg-[#FAFAFA] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: c.bgDone, color: c.textDone, border: `1.5px solid ${c.borderDone}` }}>
                        {isRegen ? `Обновить ${c.label}` : c.label} · День {day.day}
                      </span>
                      <button onClick={() => { setPendingBadge(null); setExtraContext('') }}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E8E8E8] text-[#aaa] hover:text-[#444]">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {typeBrief && (
                      <div className="rounded-lg border border-[#D44E7E]/15 bg-[#FFF5F8] p-3">
                        <p className="text-[10px] font-bold text-[#D44E7E]/70 uppercase tracking-wide mb-1">Тема</p>
                        <p className="text-sm text-[#333]">{typeBrief}</p>
                      </div>
                    )}
                    <VoiceTextarea value={extraContext} onChange={setExtraContext}
                      placeholder={typeBrief ? "Надиктуй детали: историю, кейс, имя клиента..." : "Надиктуй детали: кейс, продукт..."}
                      rows={2} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="gradient-accent text-white hover:opacity-90 gap-1.5 flex-1"
                        onClick={handlePendingGenerate} disabled={!!generatingDay}>
                        {generatingDay === `${pendingBadge.day}-${pendingBadge.type}`
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Создаю...</>
                          : isRegen ? <><RefreshCw className="h-3 w-3" /> Обновить</> : <><Sparkles className="h-3 w-3" /> Создать</>}
                      </Button>
                      <button onClick={() => { setPendingBadge(null); setExtraContext('') }}
                        className="text-xs text-[#aaa] hover:text-[#444] px-2">Отмена</button>
                    </div>
                  </div>
                )
              })()}

              {/* Viewer (list mode) */}
              {viewingKey?.startsWith(`${day.day}-`) && (() => {
                const type = viewingKey.replace(`${day.day}-`, '') as ContentType
                const item = day.items.find(i => i.content_type === type)
                const c = COLORS[type]
                if (!item || !c) return null
                return (
                  <div className="border-t border-[#F0F0F0] bg-[#FAFAFA] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: c.bgDone, color: c.textDone, border: `1.5px solid ${c.borderDone}` }}>
                        {c.label} · День {day.day}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs border-[#E8E8E8] px-2 gap-1"
                          onClick={() => { setViewingKey(null); setPendingBadge({ day: day.day, type, phase: day.phase || 'awareness', theme: day.dayBriefs?.[type] || day.theme }); setExtraContext('') }}>
                          <RefreshCw className="h-3 w-3" /><span className="hidden sm:inline">Обновить</span>
                        </Button>
                        <button onClick={() => setViewingKey(null)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E8E8E8] text-[#aaa] hover:text-[#444]">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#ECECEC] bg-white p-3 max-h-[60vh] overflow-y-auto">
                      {renderContent(item)}
                    </div>
                    {item.hashtags && item.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.hashtags.map((h, i) => (
                          <span key={i} className="text-[10px] text-[#D44E7E]/70 bg-[#FFF0F5] border border-[#D44E7E]/15 rounded px-1.5 py-0.5">{h}</span>
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
    )
  }

  // ── Active panel (calendar mode) ────────────────────────────────────────────
  function ActivePanel() {
    if (pendingBadge) {
      const day = days.find(d => d.day === pendingBadge.day)
      if (!day) return null
      const c = COLORS[pendingBadge.type]
      if (!c) return null
      const typeBrief = day.dayBriefs?.[pendingBadge.type]
      const isRegen = day.items.some(i => i.content_type === pendingBadge.type)
      return (
        <motion.div key="pending" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className="rounded-2xl border border-[#E8E8E8] bg-white shadow-md p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg"
                style={{ backgroundColor: c.bgDone, color: c.textDone, border: `1.5px solid ${c.borderDone}` }}>
                {c.label}
              </span>
              <span className="text-sm text-[#888]">{day.dayOfWeek}, {day.date}</span>
              {day.phase && <span className="text-[10px] text-[#aaa]">{PHASE_NAMES[day.phase]}</span>}
            </div>
            <button onClick={() => { setPendingBadge(null); setExtraContext('') }}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#aaa] hover:text-[#444]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {typeBrief && (
            <div className="rounded-xl border border-[#D44E7E]/15 bg-[#FFF5F8] p-3">
              <p className="text-[10px] font-bold text-[#D44E7E]/60 uppercase tracking-wide mb-1">Тема дня</p>
              <p className="text-sm text-[#333]">{typeBrief}</p>
            </div>
          )}
          <VoiceTextarea value={extraContext} onChange={setExtraContext}
            placeholder="Надиктуй детали: кейс, историю, имя клиента — AI вплетёт в контент..."
            rows={2} />
          <div className="flex gap-2">
            <Button className="gradient-accent text-white hover:opacity-90 gap-1.5 flex-1"
              onClick={handlePendingGenerate} disabled={!!generatingDay}>
              {generatingDay === `${pendingBadge.day}-${pendingBadge.type}`
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Создаю...</>
                : isRegen ? <><RefreshCw className="h-4 w-4" /> Обновить</> : <><Sparkles className="h-4 w-4" /> Создать</>}
            </Button>
            <button onClick={() => { setPendingBadge(null); setExtraContext('') }}
              className="text-sm text-[#aaa] hover:text-[#444] px-3">Отмена</button>
          </div>
        </motion.div>
      )
    }
    if (viewingKey) {
      const [dayNum, type] = viewingKey.split('-')
      const day = days.find(d => d.day === parseInt(dayNum))
      const contentType = type as ContentType
      const item = day?.items.find(i => i.content_type === contentType)
      const c = COLORS[contentType]
      if (!item || !c || !day) return null
      return (
        <motion.div key="viewer" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className="rounded-2xl border border-[#E8E8E8] bg-white shadow-md p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg"
                style={{ backgroundColor: c.bgDone, color: c.textDone, border: `1.5px solid ${c.borderDone}` }}>
                {c.label}
              </span>
              <span className="text-sm text-[#888]">{day.dayOfWeek}, {day.date}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-xs border-[#E8E8E8] gap-1"
                onClick={() => { setViewingKey(null); setPendingBadge({ day: day.day, type: contentType, phase: day.phase || 'awareness', theme: day.dayBriefs?.[contentType] || day.theme }); setExtraContext('') }}>
                <RefreshCw className="h-3.5 w-3.5" /> Обновить
              </Button>
              <button onClick={() => setViewingKey(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#aaa] hover:text-[#444]">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-[#ECECEC] bg-[#FAFAFA] p-4 max-h-[55vh] overflow-y-auto">
            {renderContent(item)}
          </div>
          {item.hashtags && item.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.hashtags.map((h, i) => (
                <span key={i} className="text-[10px] text-[#D44E7E]/70 bg-[#FFF0F5] border border-[#D44E7E]/15 rounded px-1.5 py-0.5">{h}</span>
              ))}
            </div>
          )}
        </motion.div>
      )
    }
    return null
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        {/* Week nav */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => onWeekChange(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#888] hover:bg-[#F7F7F7] hover:text-[#333] transition-all">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-[#333] min-w-[72px] text-center">Неделя {weekNumber}</span>
          <button onClick={() => onWeekChange(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8E8E8] text-[#888] hover:bg-[#F7F7F7] hover:text-[#333] transition-all">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button onClick={handleGenerateWeekBriefClick} disabled={loading || generatingWeekBrief}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl text-xs font-semibold border border-[#3A8A48]/30 bg-[#3A8A48]/8 text-[#3A8A48] hover:bg-[#3A8A48]/15 transition-all disabled:opacity-50">
            {generatingWeekBrief
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="ml-1">Создаю...</span></>
              : <><Sparkles className="h-3.5 w-3.5" /><span className="ml-1">Создать</span></>}
          </button>
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border border-[#E8E8E8] bg-white text-[#888] hover:text-[#555] transition-all">
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Grid / list */}
      <ListView />


      {/* Legend */}
      <div className="flex flex-wrap gap-2 pt-1">
        {DISPLAY_TYPES.map(key => {
          const c = COLORS[key]
          return (
            <span key={key} className="text-xs px-2.5 py-1 rounded-lg font-medium"
              style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
              {c.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
