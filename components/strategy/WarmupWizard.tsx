'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Package,
  Calendar,
  Users,
  Star,
  Lightbulb,
  Target,
  FileText,
  Sparkles,
  Loader2,
  Upload,
  RefreshCw,
  Save,
  RotateCcw,
} from 'lucide-react'
import type { Product, Funnel } from '@/types'

// ── AI Plan types ────────────────────────────────────────────────────────────
interface AIDayPlan {
  day: number
  meaning: string
}

interface AIPhase {
  phase: string
  label: string
  days_count: number
  task: string
  daily_plan: AIDayPlan[]
}

interface AIPlanData {
  strategy_summary: string
  phases: AIPhase[]
}

// ── Plan Preview renderer (from structured JSON) ─────────────────────────────
const PHASE_ICONS: Record<string, string> = {
  niche: '🔥',
  expert: '💡',
  product: '🎯',
  objections: '💰',
}

const PHASE_COLORS: Record<string, string> = {
  niche: 'border-blue-500/30 bg-blue-500/5 text-blue-400',
  expert: 'border-purple-500/30 bg-purple-500/5 text-purple-400',
  product: 'border-orange-500/30 bg-orange-500/5 text-orange-400',
  objections: 'border-green-500/30 bg-green-500/5 text-green-400',
}

function PlanPreview({ planData, productName, duration }: { planData: AIPlanData; productName: string; duration: number }) {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null)

  // Guard against incomplete/truncated AI output
  if (!planData?.phases?.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Данные плана неполные. Попробуй перегенерировать.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            ПЛАН ПРОГРЕВА: {productName} | {duration} дней
          </span>
          <Badge className="ml-auto text-[10px] bg-green-500/15 text-green-400 border-green-500/25">AI</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{planData.strategy_summary}</p>
      </div>

      {/* Phases */}
      <div className="space-y-2">
        {planData.phases.map((phase) => {
          const isOpen = expandedPhase === phase.phase
          const colorClass = PHASE_COLORS[phase.phase] || 'border-border bg-card text-muted-foreground'
          const icon = PHASE_ICONS[phase.phase] || '📌'

          return (
            <div key={phase.phase} className={`rounded-xl border overflow-hidden ${colorClass}`}>
              {/* Phase header — clickable to expand */}
              <button
                className="w-full flex items-center justify-between p-3 text-left"
                onClick={() => setExpandedPhase(isOpen ? null : phase.phase)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{icon}</span>
                  <div>
                    <span className="text-xs font-bold tracking-wide">{phase.label}</span>
                    <span className="ml-2 text-[10px] opacity-60">{phase.days_count} дней</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] opacity-60 hidden sm:block">{phase.task}</span>
                  <ChevronRight className={`h-3.5 w-3.5 opacity-60 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {/* Day table */}
              {isOpen && (
                <div className="border-t border-current/10 bg-background/30">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-current/10">
                        <th className="py-2 px-3 text-left font-medium opacity-60 w-16">День</th>
                        <th className="py-2 px-3 text-left font-medium opacity-60">Смысл</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(phase.daily_plan ?? []).map((d, i) => (
                        <tr key={d.day} className={i % 2 === 0 ? 'bg-background/20' : ''}>
                          <td className="py-2 px-3 font-bold opacity-70">{d.day}</td>
                          <td className="py-2 px-3 text-foreground leading-relaxed">{d.meaning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Нажми на фазу чтобы раскрыть все смыслы
      </p>
    </div>
  )
}

// ── Wizard ───────────────────────────────────────────────────────────────────
interface WarmupWizardProps {
  projectId: string
  products: Product[]
  funnels: Funnel[]
  onComplete?: (planId: string) => void
}

const STEPS = [
  { id: 1, title: 'Продукт', icon: Package },
  { id: 2, title: 'Тип и даты', icon: Calendar },
  { id: 3, title: 'Воронка продаж', icon: Users },
  { id: 4, title: 'Прогрев тёплой аудитории', icon: Star },
  { id: 5, title: 'Кейсы', icon: FileText },
  { id: 6, title: 'Смыслы', icon: Lightbulb },
  { id: 7, title: 'Конкуренты', icon: Target },
  { id: 8, title: 'Итог', icon: Sparkles },
]

const HOOK_OPTIONS = [
  { id: 'transformation', label: 'Личная трансформация / история', desc: 'Рассказываешь свой путь, как ты пришёл(а) к этому результату' },
  { id: 'backstage', label: 'Закулисье работы', desc: 'Показываешь как создаётся продукт, рабочий процесс изнутри' },
  { id: 'fears', label: 'Ответы на страхи аудитории', desc: 'Закрываешь возражения и страхи клиентов через контент' },
  { id: 'myths', label: 'Разрушение мифов в нише', desc: 'Опровергаешь популярные заблуждения в твоей теме' },
  { id: 'results', label: 'Результаты учеников / клиентов', desc: 'Показываешь реальные кейсы и трансформации' },
  { id: 'expertise', label: 'Демонстрация экспертизы', desc: 'Профессиональный контент, советы, разборы — доказываешь компетентность' },
  { id: 'lifestyle', label: 'Образ жизни и ценности', desc: 'Показываешь свою жизнь, ценности, личность — создаёшь связь с аудиторией' },
]

const FREE_EVENT_TYPES = [
  { id: 'webinar', label: 'вебинар' },
  { id: 'marathon', label: 'марафон' },
  { id: 'masterclass_free', label: 'бесплатный мастер-класс' },
  { id: 'live', label: 'эфир' },
  { id: 'other', label: 'другое' },
]

const PAID_EVENT_TYPES = [
  { id: 'paid_webinar', label: 'платный вебинар' },
  { id: 'paid_masterclass', label: 'платный мастер-класс' },
  { id: 'intensive', label: 'интенсив' },
  { id: 'other', label: 'другое' },
]

export function WarmupWizard({ projectId, products, funnels, onComplete }: WarmupWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [generatingSeconds, setGeneratingSeconds] = useState(0)
  const [aiPlanData, setAiPlanData] = useState<AIPlanData | null>(null)
  const [planApproved, setPlanApproved] = useState(false)

  // Wizard state
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  // Warmup type: 'launch' = под конкретный запуск, 'evergreen' = вечнозелёный (консультации)
  const [warmupType, setWarmupType] = useState<'launch' | 'evergreen'>('launch')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [launchDate, setLaunchDate] = useState('') // дата старта продаж (≠ конец прогрева)
  const [evergreenDays, setEvergreenDays] = useState<14 | 21 | 30>(30)
  const [coldFunnelId, setColdFunnelId] = useState<string | null>(null)
  const [coldFunnelCustom, setColdFunnelCustom] = useState('')
  const [coldAudienceType, setColdAudienceType] = useState<'existing_funnel' | 'custom' | 'none'>('existing_funnel')

  const [warmAudienceTypes, setWarmAudienceTypes] = useState<string[]>(['content_only'])

  const [freeEventName, setFreeEventName] = useState('')
  const [freeEventDate, setFreeEventDate] = useState('')
  const [freeEventTypes, setFreeEventTypes] = useState<string[]>([])

  const [paidEventName, setPaidEventName] = useState('')
  const [paidEventDate, setPaidEventDate] = useState('')
  const [paidEventTypes, setPaidEventTypes] = useState<string[]>([])

  const [useCases, setUseCases] = useState(true)
  const [extraCasesText, setExtraCasesText] = useState('')
  const [extraCasesFile, setExtraCasesFile] = useState<File | null>(null)
  const [selectedHooks, setSelectedHooks] = useState<string[]>([])
  const [extraHooks, setExtraHooks] = useState('')
  const [competitorNotes, setCompetitorNotes] = useState('')

  const selectedProduct = products.find((p) => p.id === selectedProductId)

  // ── Draft: auto-save to localStorage ─────────────────────────────────────
  const DRAFT_KEY = `warmup_draft_${projectId}`
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check for existing draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft?.step && draft.step > 1) setHasDraft(true)
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Computed duration from dates (used in prompt + save)
  const computedDuration = (() => {
    if (warmupType === 'evergreen') return evergreenDays
    if (startDate && endDate) {
      const d = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
      return d > 0 ? d : 30
    }
    return 45
  })()

  // Collect all wizard state into one object
  const getDraftState = useCallback(() => ({
    step,
    selectedProductId,
    warmupType,
    startDate,
    endDate,
    launchDate,
    evergreenDays,
    coldFunnelId,
    coldFunnelCustom,
    coldAudienceType,
    warmAudienceTypes,
    freeEventName,
    freeEventDate,
    freeEventTypes,
    paidEventName,
    paidEventDate,
    paidEventTypes,
    useCases,
    extraCasesText,
    selectedHooks,
    extraHooks,
    competitorNotes,
  }), [
    step, selectedProductId, warmupType, startDate, endDate, launchDate, evergreenDays,
    coldFunnelId, coldFunnelCustom, coldAudienceType,
    warmAudienceTypes, freeEventName, freeEventDate, freeEventTypes,
    paidEventName, paidEventDate, paidEventTypes,
    useCases, extraCasesText, selectedHooks, extraHooks, competitorNotes,
  ])

  // Auto-save with 1.5s debounce after any change
  useEffect(() => {
    if (draftRestored) return // не сохраняем пока только что восстановили
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        const state = getDraftState()
        if (state.step <= 1 && !state.selectedProductId) return // не сохраняем пустой черновик
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, savedAt: new Date().toISOString() }))
        setDraftSavedAt(new Date())
        setHasDraft(true)
      } catch { /* ignore */ }
    }, 1500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDraftState])

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.step) setStep(d.step > 7 ? 7 : d.step)
      if (d.selectedProductId) setSelectedProductId(d.selectedProductId)
      if (d.warmupType) setWarmupType(d.warmupType)
      if (d.startDate !== undefined) setStartDate(d.startDate)
      if (d.endDate !== undefined) setEndDate(d.endDate)
      if (d.launchDate !== undefined) setLaunchDate(d.launchDate)
      if (d.evergreenDays) setEvergreenDays(d.evergreenDays)
      if (d.coldFunnelId !== undefined) setColdFunnelId(d.coldFunnelId)
      if (d.coldFunnelCustom !== undefined) setColdFunnelCustom(d.coldFunnelCustom)
      if (d.coldAudienceType) setColdAudienceType(d.coldAudienceType)
      if (d.warmAudienceTypes) setWarmAudienceTypes(d.warmAudienceTypes)
      if (d.freeEventName !== undefined) setFreeEventName(d.freeEventName)
      if (d.freeEventDate !== undefined) setFreeEventDate(d.freeEventDate)
      if (d.freeEventTypes) setFreeEventTypes(d.freeEventTypes)
      if (d.paidEventName !== undefined) setPaidEventName(d.paidEventName)
      if (d.paidEventDate !== undefined) setPaidEventDate(d.paidEventDate)
      if (d.paidEventTypes) setPaidEventTypes(d.paidEventTypes)
      if (d.useCases !== undefined) setUseCases(d.useCases)
      if (d.extraCasesText !== undefined) setExtraCasesText(d.extraCasesText)
      if (d.selectedHooks) setSelectedHooks(d.selectedHooks)
      if (d.extraHooks !== undefined) setExtraHooks(d.extraHooks)
      if (d.competitorNotes !== undefined) setCompetitorNotes(d.competitorNotes)
      setDraftRestored(true)
      setTimeout(() => setDraftRestored(false), 2000)
      setHasDraft(false)
      toast.success('Черновик восстановлен!')
    } catch {
      toast.error('Не удалось восстановить черновик')
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY)
      setHasDraft(false)
      setDraftSavedAt(null)
      toast.success('Черновик удалён')
    } catch { /* ignore */ }
  }

  function toggleWarmType(value: string) {
    setWarmAudienceTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  function getFunnelDesc() {
    if (coldAudienceType === 'existing_funnel')
      return `Существующая воронка: ${funnels.find(f => f.id === coldFunnelId)?.name || 'из базы'}`
    if (coldAudienceType === 'custom') return coldFunnelCustom || 'Описать позже'
    return 'Без воронки — прямые продажи'
  }

  // ── Generate plan via AI (polling — no SSE, no browser timeout) ──────────
  async function generatePlan() {
    setGeneratingSummary(true)
    setGeneratingSeconds(0)
    setAiPlanData(null)
    setPlanApproved(false)
    setStep(8) // сразу показываем loading screen с таймером

    const timer = setInterval(() => setGeneratingSeconds((s) => s + 1), 1000)

    try {
      // Стриминг — каждый чанк Claude сразу летит клиенту, TCP не закрывается
      const res = await fetch('/api/ai/warmup-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          productName: selectedProduct?.name || 'Продукт',
          duration: computedDuration,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          launchDate: launchDate || undefined,
          warmupType,
          funnelDesc: getFunnelDesc(),
          warmTypes: warmAudienceTypes,
          useCases,
          hooks: selectedHooks,
          extraHooks: extraHooks || undefined,
          competitors: competitorNotes || undefined,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || `Ошибка сервера ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('Нет потока данных')

      const decoder = new TextDecoder()
      let buffer = ''

      const processBuffer = (): AIPlanData | null => {
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          let data: { type: string; planData?: AIPlanData; message?: string }
          try {
            data = JSON.parse(part.slice(6))
          } catch {
            continue // невалидный JSON — пропускаем
          }
          if (data.type === 'done' && data.planData) return data.planData
          if (data.type === 'error') throw new Error(data.message || 'AI недоступен')
          // status/progress — просто игнорируем
        }
        return null
      }

      // Читаем поток — каждый чанк обрабатываем сразу
      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
          const plan = processBuffer()
          if (plan) { setAiPlanData(plan); return }
        }
        if (done) break
      }

      // Обрабатываем остаток буфера
      if (buffer.trim()) {
        buffer += '\n\n'
        const plan = processBuffer()
        if (plan) { setAiPlanData(plan); return }
      }

      throw new Error('AI не вернул план. Попробуй ещё раз.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI недоступен'
      toast.error(msg, { duration: 10000 })
      setStep(7) // при ошибке возвращаем на шаг 7
    } finally {
      clearInterval(timer)
      setGeneratingSummary(false)
    }
  }

  // ── Save plan ─────────────────────────────────────────────────────────────
  async function createPlan() {
    if (!aiPlanData) return
    setLoading(true)
    try {
      // Build plan_data from AI-generated structure (not hardcoded!)
      const planPhases = aiPlanData.phases.map((phase) => ({
        phase: phase.phase,
        label: phase.label,
        daily_plan: phase.daily_plan.map((d) => ({
          day: d.day,
          meaning: d.meaning,
        })),
      }))

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_warmup_plan',
          projectId,
          data: {
            name: `Прогрев ${computedDuration} дней — ${selectedProduct?.name || 'продукт'}${startDate ? ` (старт ${startDate})` : ''}`,
            duration_days: computedDuration,
            audience_type: 'cold_warm',
            strategic_summary: aiPlanData.strategy_summary,
            summary_approved: true,
            status: 'approved',
            plan_data: { warmup_plan: { phases: planPhases } },
          },
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `Ошибка ${res.status}`)
      }
      const { planId } = await res.json() as { planId: string }
      // Черновик больше не нужен — план создан
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      setHasDraft(false)
      setDraftSavedAt(null)
      toast.success('План прогрева создан!')
      router.refresh()
      onComplete?.(planId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания плана')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Draft restore banner — показывается только если есть несохранённый черновик */}
      {hasDraft && step === 1 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <RotateCcw className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-300">Найден незавершённый черновик</p>
            <p className="text-[10px] text-amber-400/70">Продолжить с того места где остановился?</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              className="h-7 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
              variant="outline"
              onClick={restoreDraft}
            >
              Восстановить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-amber-500/60 hover:text-amber-400"
              onClick={clearDraft}
            >
              Удалить
            </Button>
          </div>
        </div>
      )}

      {/* Steps indicator */}
      <div className="flex items-center overflow-x-auto py-2 gap-0">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center shrink-0">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              step === s.id
                ? 'gradient-accent text-white ring-2 ring-primary/30 ring-offset-1 ring-offset-background'
                : step > s.id
                ? 'bg-green-500/20 text-green-400'
                : 'bg-secondary text-muted-foreground'
            }`}>
              {step > s.id ? <Check className="h-3 w-3" /> : s.id}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-4 mx-0.5 shrink-0 ${step > s.id ? 'bg-green-500/40' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step title + draft saved indicator */}
      <div className="flex items-center justify-between">
        <div className="flex text-sm font-medium text-foreground">
          <span className="whitespace-nowrap mr-1">Шаг {step}:</span>
          <span>{STEPS[step - 1]?.title}</span>
        </div>
        {draftSavedAt && step > 1 && step < 8 && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <Save className="h-3 w-3" />
            <span>Черновик сохранён</span>
          </div>
        )}
      </div>

      {/* Step 1: Product */}
      {step === 1 && (
        <div className="space-y-3">
          {products.map((product) => (
            <button
              key={product.id}
              onClick={() => setSelectedProductId(product.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                selectedProductId === product.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{product.name}</p>
                  <p className="text-sm text-muted-foreground">{product.product_type}</p>
                </div>
                <div className="text-right">
                  {product.price && (
                    <p className="font-bold text-foreground">
                      {product.price.toLocaleString()} {product.currency}
                    </p>
                  )}
                  {selectedProductId === product.id && (
                    <Badge className="mt-1 bg-primary/20 text-primary border-primary/30 text-xs">
                      <Check className="mr-1 h-3 w-3" />
                      Выбрано
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))}
          {products.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Нет продуктов. Добавьте продукт в настройках проекта.
            </div>
          )}
        </div>
      )}

      {/* Step 2: Тип прогрева + даты */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Тип прогрева */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setWarmupType('launch')}
              className={`text-left p-4 rounded-xl border transition-all ${warmupType === 'launch' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${warmupType === 'launch' ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-semibold text-foreground">🚀 Прогрев под запуск</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Инфопродукт, курс, интенсив — есть конкретная дата открытия продаж</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => setWarmupType('evergreen')}
              className={`text-left p-4 rounded-xl border transition-all ${warmupType === 'evergreen' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${warmupType === 'evergreen' ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-semibold text-foreground">🌿 Вечнозелёный прогрев</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Консультации, личная работа, услуги — прогрев идёт постоянно без дедлайна</p>
                </div>
              </div>
            </button>
          </div>

          {/* Поля под тип */}
          {warmupType === 'launch' ? (
            <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Дата старта прогрева</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="bg-input border-border h-10 text-sm w-full" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Дата окончания прогрева</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="bg-input border-border h-10 text-sm w-full" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Дата запуска продукта <span className="text-muted-foreground font-normal">(открытие продаж)</span></Label>
                <p className="text-xs text-muted-foreground">AI усилит контент триггерами ажиотажа и ограниченности за несколько дней до и после этой даты</p>
                <Input type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)}
                  className="bg-input border-border h-10 text-sm w-full max-w-xs" />
              </div>
              {startDate && endDate && (
                <p className="text-xs text-primary font-medium">
                  Длительность прогрева: {computedDuration} {computedDuration === 1 ? 'день' : computedDuration < 5 ? 'дня' : 'дней'}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
              <p className="text-xs text-muted-foreground">Контент создаётся по повторяющемуся циклу — можно запустить в любой момент и обновлять бесконечно.</p>
              <Label className="text-sm font-medium">Длина цикла прогрева</Label>
              <div className="grid grid-cols-3 gap-2">
                {([14, 21, 30] as const).map(d => (
                  <button key={d} onClick={() => setEvergreenDays(d)}
                    className={`py-2.5 rounded-lg border text-sm font-semibold transition-all ${evergreenDays === d ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40'}`}>
                    {d} дней
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">По завершении цикла можно перезапустить с новыми смыслами.</p>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Sales funnel */}
      {step === 3 && (
        <div className="space-y-2">
          {funnels.length > 0 && (
            <button
              onClick={() => { setColdAudienceType('existing_funnel'); setColdFunnelId(funnels[0].id) }}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                coldAudienceType === 'existing_funnel' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${coldAudienceType === 'existing_funnel' ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                <div>
                  <p className="font-medium text-foreground">Использовать ранее загруженную воронку</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{funnels[0].name} — рекомендуется</p>
                </div>
              </div>
              {coldAudienceType === 'existing_funnel' && funnels.length > 1 && (
                <div className="mt-3 grid grid-cols-1 gap-2 pl-7">
                  {funnels.map((f) => (
                    <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" checked={coldFunnelId === f.id} onChange={() => setColdFunnelId(f.id)} className="accent-primary" />
                      {f.name}
                    </label>
                  ))}
                </div>
              )}
            </button>
          )}

          <button
            onClick={() => setColdAudienceType('custom')}
            className={`w-full text-left p-4 rounded-xl border transition-all ${
              coldAudienceType === 'custom' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${coldAudienceType === 'custom' ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
              <div className="flex-1">
                <p className="font-medium text-foreground">Описать механику продающей воронки</p>
                {coldAudienceType === 'custom' && (
                  <Textarea
                    className="mt-2 bg-input border-border resize-none text-sm"
                    placeholder="Опишите, какая будет механика продающей воронки"
                    value={coldFunnelCustom}
                    onChange={(e) => setColdFunnelCustom(e.target.value)}
                    rows={3}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            </div>
          </button>

          <button
            onClick={() => setColdAudienceType('none')}
            className={`w-full text-left p-4 rounded-xl border transition-all ${
              coldAudienceType === 'none' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`h-4 w-4 rounded-full border-2 shrink-0 ${coldAudienceType === 'none' ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
              <p className="font-medium text-foreground">Без воронки — продаём напрямую</p>
            </div>
          </button>
        </div>
      )}

      {/* Step 4: Warm audience */}
      {step === 4 && (
        <div className="space-y-2">
          {[
            {
              value: 'content_only',
              label: 'Прогрев контентом без дополнительной воронки на тёплую аудиторию',
              desc: 'Продажи только через контент блога. Дополнительных мероприятий не планируется.',
            },
            {
              value: 'free_event',
              label: 'Бесплатное мероприятие',
              desc: 'Дополнительно к контенту — бесплатное продающее мероприятие (вебинар, марафон, мастер-класс)',
            },
            {
              value: 'paid_event',
              label: 'Платное мероприятие (трипваер)',
              desc: 'Дополнительно к контенту — платное мероприятие (трипваер), которое ведёт на продажу основного продукта',
            },
          ].map(({ value, label, desc }) => {
            const isChecked = warmAudienceTypes.includes(value)
            return (
              <div key={value}>
                <button
                  onClick={() => toggleWarmType(value)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    isChecked ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${isChecked ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                    <div>
                      <p className="font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                  </div>
                </button>

                {isChecked && value === 'free_event' && (
                  <div className="mt-1 ml-4 p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Название мероприятия</Label>
                        <Input value={freeEventName} onChange={(e) => setFreeEventName(e.target.value)} placeholder="Вебинар «Как запустить за 30 дней»" className="bg-input border-border text-sm h-10 w-full" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Дата мероприятия</Label>
                        <Input type="date" value={freeEventDate} onChange={(e) => setFreeEventDate(e.target.value)} className="bg-input border-border text-sm h-10 w-full" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Формат</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {FREE_EVENT_TYPES.map(({ id, label: eventLabel }) => (
                          <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={freeEventTypes.includes(id)}
                              onCheckedChange={(checked) => {
                                if (checked) setFreeEventTypes([...freeEventTypes, id])
                                else setFreeEventTypes(freeEventTypes.filter((e) => e !== id))
                              }}
                            />
                            {eventLabel}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {isChecked && value === 'paid_event' && (
                  <div className="mt-1 ml-4 p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Название мероприятия</Label>
                        <Input value={paidEventName} onChange={(e) => setPaidEventName(e.target.value)} placeholder="Интенсив «За 3 дня к первым продажам»" className="bg-input border-border text-sm h-10 w-full" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Дата мероприятия</Label>
                        <Input type="date" value={paidEventDate} onChange={(e) => setPaidEventDate(e.target.value)} className="bg-input border-border text-sm h-10 w-full" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Формат</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {PAID_EVENT_TYPES.map(({ id, label: eventLabel }) => (
                          <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={paidEventTypes.includes(id)}
                              onCheckedChange={(checked) => {
                                if (checked) setPaidEventTypes([...paidEventTypes, id])
                                else setPaidEventTypes(paidEventTypes.filter((e) => e !== id))
                              }}
                            />
                            {eventLabel}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Step 5: Cases */}
      {step === 5 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Какие доказательства используем в прогреве?</p>
          {[
            { value: true, label: 'Использовать кейсы из базы проекта', desc: 'Рекомендуется для повышения доверия' },
            { value: false, label: 'Без кейсов', desc: 'Для новых продуктов без социальных доказательств' },
          ].map(({ value, label, desc }) => (
            <button
              key={String(value)}
              onClick={() => setUseCases(value)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                useCases === value ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${useCases === value ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                <div>
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            </button>
          ))}
          <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Добавить дополнительные кейсы</p>
            <Textarea
              placeholder="Опишите кейсы текстом — результаты клиентов, трансформации, цифры..."
              value={extraCasesText}
              onChange={(e) => setExtraCasesText(e.target.value)}
              rows={3}
              className="bg-input border-border resize-none text-sm"
            />
            <div>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-primary hover:text-primary/80 transition-colors">
                <Upload className="h-3.5 w-3.5" />
                {extraCasesFile ? extraCasesFile.name : 'Загрузить файл с кейсами (PDF, DOCX)'}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.doc,.txt"
                  onChange={(e) => setExtraCasesFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Hooks */}
      {step === 6 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Есть ли особые темы или углы для прогрева?</p>
          <div className="space-y-1.5">
            {HOOK_OPTIONS.map(({ id, label, desc }) => {
              const isChecked = selectedHooks.includes(id)
              return (
                <div key={id}>
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 cursor-pointer transition-colors">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedHooks([...selectedHooks, id])
                        else setSelectedHooks(selectedHooks.filter((h) => h !== id))
                      }}
                    />
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                  {isChecked && (
                    <p className="mt-0.5 ml-10 text-xs text-muted-foreground">{desc}</p>
                  )}
                </div>
              )
            })}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Добавить свои идеи</Label>
            <Textarea
              placeholder="Опишите дополнительные смыслы и темы для прогрева..."
              value={extraHooks}
              onChange={(e) => setExtraHooks(e.target.value)}
              rows={3}
              className="bg-input border-border resize-none text-sm"
            />
          </div>
        </div>
      )}

      {/* Step 7: Competitors */}
      {step === 7 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            AI использует загруженных конкурентов для двух целей: найти их сильные стороны и выявить твои отличия.
          </p>
          <div className="space-y-1.5">
            <Label className="text-sm">Уточните ключевые отличия (опционально)</Label>
            <Textarea
              placeholder="Например: у конкурента сильный сторителлинг — мы хотим взять это за основу; наше отличие — работаем только с нутрициологией без диет..."
              value={competitorNotes}
              onChange={(e) => setCompetitorNotes(e.target.value)}
              rows={4}
              className="bg-input border-border resize-none text-sm"
            />
          </div>
        </div>
      )}

      {/* Step 8: Plan preview & approve */}
      {step === 8 && (
        <div className="space-y-4">
          {/* Loading state */}
          {generatingSummary && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="relative">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                <Sparkles className="h-4 w-4 text-primary/60 absolute -top-1 -right-1 animate-pulse" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {generatingSeconds < 10
                    ? 'AI анализирует материалы проекта...'
                    : generatingSeconds < 30
                    ? 'Составляю персональный план прогрева...'
                    : generatingSeconds < 60
                    ? 'Прописываю смыслы для каждого дня...'
                    : 'Финализирую план... почти готово'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {generatingSeconds > 0 ? `${generatingSeconds} сек` : 'Запускаю...'}
                  {generatingSeconds > 20 && ' · план готовится, не закрывай страницу'}
                </p>
              </div>
              {generatingSeconds > 30 && (
                <div className="rounded-lg border border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground text-center max-w-[260px]">
                  Подробный план на {computedDuration} дней требует времени — обычно 1–2 минуты
                </div>
              )}
            </div>
          )}

          {/* No plan yet */}
          {!aiPlanData && !generatingSummary && (
            <div className="space-y-4">
              <div className="text-center py-6">
                <Sparkles className="h-10 w-10 text-primary/40 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">
                  AI проанализирует все твои материалы и создаст<br />
                  персональный план на основе твоей ниши и продукта
                </p>
              </div>
              <Button onClick={generatePlan} className="w-full gradient-accent text-white hover:opacity-90">
                <Sparkles className="mr-2 h-4 w-4" />
                Создать план прогрева
              </Button>
            </div>
          )}

          {/* Plan generated */}
          {aiPlanData && !generatingSummary && (
            <>
              <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-border bg-card">
                <PlanPreview
                  planData={aiPlanData}
                  productName={selectedProduct?.name || 'Продукт'}
                  duration={computedDuration}
                />
              </div>

              {!planApproved && (
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="w-full border-border text-xs h-9"
                    onClick={generatePlan}
                    disabled={generatingSummary}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Перегенерировать
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 border-border" onClick={() => { setAiPlanData(null); setPlanApproved(false) }}>
                      Изменить настройки
                    </Button>
                    <Button className="flex-1 gradient-accent text-white hover:opacity-90" onClick={() => setPlanApproved(true)}>
                      <Check className="mr-2 h-4 w-4" />
                      Одобрить план
                    </Button>
                  </div>
                </div>
              )}

              {planApproved && (
                <Button onClick={createPlan} disabled={loading} className="w-full gradient-accent text-white hover:opacity-90">
                  {loading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Создание плана...</>
                    : <><Check className="mr-2 h-4 w-4" /> Сохранить план прогрева</>
                  }
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Navigation */}
      {step < 8 && (
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Button
            variant="outline"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="border-border"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Назад
          </Button>

          <Button
            onClick={() => {
              if (step === 7) generatePlan()
              else setStep(step + 1)
            }}
            className="gradient-accent text-white hover:opacity-90"
            disabled={step === 7 && generatingSummary}
          >
            {step === 7 ? (
              generatingSummary
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Формируем...</>
                : <><Sparkles className="mr-2 h-4 w-4" /> Создать план</>
            ) : (
              <>Далее <ChevronRight className="ml-1 h-4 w-4" /></>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
