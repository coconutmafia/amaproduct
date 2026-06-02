'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StructuredContentView } from '@/components/content/StructuredContentView'
import {
  Sparkles, ChevronLeft, ChevronRight, Download, Loader2,
  Plus, X, Eye, RefreshCw, Check, Copy,
} from 'lucide-react'
import { SaveButton } from '@/components/content/SaveButton'
import { contentItemToText } from '@/lib/contentToText'
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

// Human-readable phase labels. Plans store phases under several conventions
// (canonical awareness/trust/…, semantic niche/expert/…, or generic phase_1..4) —
// map ALL of them so a raw "phase_1" never leaks into the UI.
const PHASE_NAMES: Record<string, string> = {
  awareness: 'Прогрев на нишу', trust: 'Прогрев на эксперта', desire: 'Прогрев на продукт', close: 'Отработка возражений',
  niche: 'Прогрев на нишу', expert: 'Прогрев на эксперта', product: 'Прогрев на продукт', objections: 'Отработка возражений',
  activation: 'Активация',
  phase_1: 'Прогрев на нишу', phase_2: 'Прогрев на эксперта', phase_3: 'Прогрев на продукт', phase_4: 'Отработка возражений',
}

// ── Content renderer ──────────────────────────────────────────────────────────
// Posts render as plain text; every structured type (reels / stories / carousel /
// email / live) goes through the shared StructuredContentView so the layout
// always matches the current AI output schema (e.g. stories use
// headline/subtext/voiceover, not the old main_text field).
function renderContent(item: ContentItem) {
  const sd = item.structured_data as Record<string, unknown> | null
  if (sd && Object.keys(sd).length > 0) return <StructuredContentView data={sd} />
  return <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#222]">{item.body_text || '(нет текста)'}</div>
}

// ── Main component ────────────────────────────────────────────────────────────
export function ContentPlanGrid({
  projectId, warmupPlanId, weekNumber, days,
  onWeekChange, onGenerateWeekBrief, onExport,
  onRemoveType, onAddType, loading,
}: ContentPlanGridProps) {
  const [generatingWeekBrief, setGeneratingWeekBrief] = useState(false)
  const [addingToDay, setAddingToDay] = useState<number | null>(null)
  const [viewingKey, setViewingKey] = useState<string | null>(null)

  const router = useRouter()
  void warmupPlanId

  // Generating a unit opens the AI chat (ChatGPT-style) pre-loaded with this
  // day's topic. There the user adds details, the AI writes it, and it can be
  // saved to «Готовое» and/or back into the plan. (Replaced the inline panel.)
  function openInChat(day: DayContent, type: ContentType) {
    const brief = day.dayBriefs?.[type] || day.theme || ''
    const params = new URLSearchParams({
      gen: '1', day: String(day.day), type, phase: day.phase || 'awareness', brief, back: 'content-plan',
    })
    router.push(`/projects/${projectId}/assistant?${params.toString()}`)
  }

  // Two-step flow: a content unit can only be generated AFTER the week plan
  // (per-format themes / briefs) has been generated for that day. Otherwise
  // the user is jumping straight to content with no theme guidance.
  const briefReady = (day: DayContent) =>
    !!day.dayBriefs && Object.keys(day.dayBriefs).length > 0
  const weekHasBrief = days.some(briefReady)

  async function handleGenerateWeekBriefClick() {
    if (!onGenerateWeekBrief) return
    setGeneratingWeekBrief(true)
    try { await onGenerateWeekBrief() } finally { setGeneratingWeekBrief(false) }
  }

  // ── List view ───────────────────────────────────────────────────────────────
  function ListView() {
    return (
      <div className="space-y-2">
        {days.map((day) => {
          // Show exactly what the day has. If the user removed every chip
          // we keep it empty (only + is shown). The defaults are seeded at
          // day construction time in page.tsx, not as a render-time fallback.
          const displayTypes = day.plannedTypes ?? []
          const isAddOpen = addingToDay === day.day
          const available = DISPLAY_TYPES.filter(t => !displayTypes.includes(t))

          return (
            <div key={day.day} className="rounded-xl border border-[#ECECEC] bg-white overflow-hidden">
              <div className="p-3 space-y-3">
                {/* Day header */}
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[#222]">{day.dayOfWeek}</p>
                  <p className="text-[11px] text-[#999]">{day.date}</p>
                  {day.phase && <span className="ml-auto text-[10px] font-medium text-[#AAA]">{PHASE_NAMES[day.phase]}</span>}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {day.theme && !day.dayBriefs && <p className="text-xs text-[#888]">{day.theme}</p>}
                  {!briefReady(day) ? (
                    /* BEFORE plan: pick which formats this day should have */
                    <>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {displayTypes.map(type => {
                          const c = COLORS[type]
                          if (!c) return null
                          return (
                            <div key={type} className="flex items-center gap-1">
                              <span className="flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-lg text-xs font-medium"
                                style={{ backgroundColor: c.bg, color: c.text, border: `1.5px solid ${c.border}` }}>
                                {c.label}
                              </span>
                              {onRemoveType && (
                                <button type="button" onClick={() => onRemoveType(day.day, type)} aria-label="Убрать формат"
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#888] bg-white border border-[#E8E8E8] active:bg-red-50 active:text-red-500 hover:bg-red-50 hover:text-red-500 transition-all shrink-0 touch-manipulation">
                                  <X className="h-3.5 w-3.5" />
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
                      <p className="text-[11px] text-[#aaa]">Выбери форматы и нажми «Сгенерировать план» вверху — AI распишет тему под каждый.</p>
                    </>
                  ) : (
                    /* AFTER plan: each format's brief + a button that opens
                       the AI chat pre-loaded with this theme */
                    <div className="space-y-2.5">
                      {(() => {
                        const types = (day.plannedTypes?.length ? day.plannedTypes : ['post', 'stories', 'reels']) as ContentType[]
                        const entries = types.filter(t => day.dayBriefs?.[t])
                        return entries.map(type => {
                          const c = COLORS[type]
                          if (!c) return null
                          const existing = day.items.find(i => i.content_type === type)
                          const isViewing = viewingKey === `${day.day}-${type}`
                          const brief = day.dayBriefs?.[type]
                          return (
                            <div key={type} className="rounded-lg border border-[#F0F0F0] p-2.5 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md"
                                  style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                                  {c.label.toUpperCase()}
                                  {existing && <Check className="h-3 w-3 text-green-600" />}
                                </span>
                                {onRemoveType && (
                                  <button type="button" onClick={() => onRemoveType(day.day, type)} aria-label="Убрать формат"
                                    className="flex h-6 w-6 items-center justify-center rounded-full text-[#bbb] hover:text-red-500 hover:bg-red-50 transition-all shrink-0">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              <p className="text-[13px] text-[#333] leading-snug">{brief}</p>
                              {existing ? (
                                <div className="flex items-center gap-2">
                                  <button onClick={() => { setViewingKey(isViewing ? null : `${day.day}-${type}`); setAddingToDay(null) }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border border-[#E0E0E0] text-[#444] active:bg-[#F5F5F5] transition-colors">
                                    <Eye className="h-3.5 w-3.5" /> {isViewing ? 'Скрыть' : 'Посмотреть'}
                                  </button>
                                  <button onClick={() => openInChat(day, type)}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white gradient-accent active:opacity-90 transition-opacity">
                                    <RefreshCw className="h-3.5 w-3.5" /> Обновить
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => openInChat(day, type)}
                                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white gradient-accent active:opacity-90 transition-opacity">
                                  <Sparkles className="h-3.5 w-3.5" /> Сгенерировать {c.label.toLowerCase()}
                                </button>
                              )}

                              {/* Generated content — shows INLINE right under this card */}
                              {isViewing && existing && (
                                <div className="rounded-lg border border-[#ECECEC] bg-white p-3 space-y-2 max-h-[60vh] overflow-y-auto">
                                  <div className="flex items-center gap-3 pb-1.5 border-b border-[#F0F0F0]">
                                    <button onClick={() => { navigator.clipboard?.writeText(contentItemToText(existing)).then(() => toast.success('Скопировано')).catch(() => {}) }}
                                      className="flex items-center gap-1 text-[11px] text-[#888] hover:text-primary transition-colors">
                                      <Copy className="h-3 w-3" /> Копировать
                                    </button>
                                    <SaveButton body={contentItemToText(existing)} title={existing.title} contentType={type} projectId={projectId}
                                      className="text-[11px] text-[#888] hover:text-primary" />
                                  </div>
                                  {renderContent(existing)}
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                      {onAddType && available.length > 0 && (
                        <>
                          <button onClick={() => setAddingToDay(isAddOpen ? null : day.day)}
                            className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] border border-dashed border-[#D4D4D4] text-[#BBB] hover:border-[#D44E7E]/50 hover:text-[#D44E7E] transition-all">
                            <Plus className="h-3 w-3" /> Добавить формат
                          </button>
                          {isAddOpen && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
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
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
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
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="ml-1">Составляю план...</span></>
              : <><Sparkles className="h-3.5 w-3.5" /><span className="ml-1">{weekHasBrief ? 'Обновить план' : 'Сгенерировать план'}</span></>}
          </button>
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border border-[#E8E8E8] bg-white text-[#888] hover:text-[#555] transition-all">
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Two-step flow hint — shown until the week plan is generated */}
      {!weekHasBrief && !generatingWeekBrief && (
        <div className="rounded-xl border border-[#3A8A48]/25 bg-[#3A8A48]/5 p-3.5 text-xs text-[#2E6E3A] space-y-1">
          <p><span className="font-semibold">Шаг 1.</span> Нажми <span className="font-semibold">«Сгенерировать план»</span> — AI распишет тему под каждый формат контента на эту неделю.</p>
          <p><span className="font-semibold">Шаг 2.</span> Потом нажимай на формат (Пост / Сторис / Рилз), чтобы сгенерировать готовый текст под его тему.</p>
        </div>
      )}

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
