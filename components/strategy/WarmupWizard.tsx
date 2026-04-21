'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
} from 'lucide-react'
import type { Product, Funnel } from '@/types'

interface WarmupWizardProps {
  projectId: string
  products: Product[]
  funnels: Funnel[]
  onComplete?: (planId: string) => void
}

const STEPS = [
  { id: 1, title: 'Продукт', icon: Package },
  { id: 2, title: 'Длительность', icon: Calendar },
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

// Fallback summary when AI is unavailable
function buildFallbackSummary(params: {
  productName: string
  duration: number
  funnelDesc: string
  warmTypes: string[]
  useCases: boolean
  hooks: string[]
  extraHooks: string
  competitors: string
  startDate: string
}) {
  const hookLabels = params.hooks.map(h => HOOK_OPTIONS.find(o => o.id === h)?.label || h)
  const warmLabels = params.warmTypes.map(t =>
    t === 'content_only' ? 'прогрев через контент блога' :
    t === 'free_event' ? 'бесплатное мероприятие' :
    t === 'paid_event' ? 'платное мероприятие (трипваер)' : t
  )

  return `# Стратегия прогрева

**Продукт:** ${params.productName}
**Длительность:** ${params.duration} дней${params.startDate ? `\n**Старт прогрева:** ${params.startDate}` : ''}

## Цель

Создать целенаправленный прогрев аудитории для продажи продукта «${params.productName}» за ${params.duration} дней.

## Воронка привлечения

${params.funnelDesc}

## Прогрев в блоге

${warmLabels.join(', ') || 'Прогрев через контент блога'}

## Ключевые смысловые крючки

${hookLabels.length > 0 ? hookLabels.map(h => `— ${h}`).join('\n') : '— Будут определены на основе материалов проекта'}
${params.extraHooks ? `\nДополнительно: ${params.extraHooks}` : ''}

## Социальные доказательства

${params.useCases ? 'Использовать кейсы и отзывы клиентов из базы проекта.' : 'Прогрев без кейсов — фокус на экспертности и личной истории.'}

${params.competitors ? `## Конкуренты\n${params.competitors}` : ''}

## Структура прогрева

**Фаза 1 — Знакомство (25%):** Рассказываем о себе, ценностях, методе. Создаём первый контакт с аудиторией.

**Фаза 2 — Доверие (30%):** Кейсы, закулисье, экспертный контент. Формируем авторитет.

**Фаза 3 — Желание (28%):** Трансформации клиентов, боли без решения, детали продукта.

**Фаза 4 — Закрытие (17%):** Открытие продаж, работа с возражениями, дедлайны.`
}

export function WarmupWizard({ projectId, products, funnels, onComplete }: WarmupWizardProps) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryApproved, setSummaryApproved] = useState(false)

  // Wizard state
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [duration, setDuration] = useState<30 | 45 | 60>(45)
  const [startDate, setStartDate] = useState('')
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

  function toggleWarmType(value: string) {
    setWarmAudienceTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  async function generateSummary() {
    setGeneratingSummary(true)
    try {
      const funnelDesc =
        coldAudienceType === 'existing_funnel'
          ? `Существующая воронка: ${funnels.find(f => f.id === coldFunnelId)?.name || 'из базы'}`
          : coldAudienceType === 'custom' ? coldFunnelCustom
          : 'Без воронки — прямые продажи'

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          conversationType: 'warmup_wizard',
          messages: [{
            role: 'user',
            content: `Создай детальную стратегию прогрева:
- Продукт: ${selectedProduct?.name || 'не выбран'}
- Длительность: ${duration} дней${startDate ? `, старт: ${startDate}` : ''}
- Воронка продаж: ${funnelDesc}
- Прогрев в блоге: ${warmAudienceTypes.join(', ')}
- Использовать кейсы: ${useCases ? 'да' : 'нет'}${extraCasesText ? `\n- Дополнительные кейсы: ${extraCasesText}` : ''}
- Смысловые крючки: ${selectedHooks.join(', ')}
- Дополнительно: ${extraHooks}
- Заметки о конкурентах: ${competitorNotes}

Верни ТОЛЬКО стратегию прогрева в формате для одобрения.`,
          }],
        }),
      })

      if (!res.ok) {
        throw new Error('AI недоступен')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('Нет ответа от AI')

      let result = ''
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value, { stream: true })
      }
      result += decoder.decode()

      if (!result.trim()) throw new Error('Пустой ответ')

      setSummary(result)
      setStep(8)
    } catch {
      // Fallback: generate template summary
      toast.info('AI временно недоступен — используем готовый шаблон стратегии')
      const funnelDesc =
        coldAudienceType === 'existing_funnel'
          ? `Существующая воронка: ${funnels.find(f => f.id === coldFunnelId)?.name || 'из базы'}`
          : coldAudienceType === 'custom' ? coldFunnelCustom || 'Описать позже'
          : 'Без воронки — прямые продажи'
      const fallback = buildFallbackSummary({
        productName: selectedProduct?.name || 'Продукт',
        duration,
        funnelDesc,
        warmTypes: warmAudienceTypes,
        useCases,
        hooks: selectedHooks,
        extraHooks,
        competitors: competitorNotes,
        startDate,
      })
      setSummary(fallback)
      setStep(8)
    } finally {
      setGeneratingSummary(false)
    }
  }

  async function createPlan() {
    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_warmup_plan',
          projectId,
          data: {
            name: `Прогрев ${duration} дней — ${selectedProduct?.name || 'продукт'}`,
            product_id: selectedProductId,
            duration_days: duration,
            start_date: startDate || null,
            audience_type: 'cold_warm',
            funnel_id: coldFunnelId,
            use_cases: useCases,
            extra_hooks: [selectedHooks.join(', '), extraHooks].filter(Boolean).join('; '),
            strategic_summary: summary,
            summary_approved: true,
          },
        }),
      })

      const { planId } = await res.json()
      toast.success('План прогрева создан!')
      onComplete?.(planId)
    } catch {
      toast.error('Ошибка создания плана')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Steps indicator */}
      <div className="flex items-center overflow-x-auto pb-1 gap-0">
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

      <div className="text-sm font-medium text-foreground">
        Шаг {step}: {STEPS[step - 1]?.title}
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

      {/* Step 2: Duration + start date */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([30, 45, 60] as const).map((days) => {
              const selected = duration === days
              return (
                <button
                  key={days}
                  onClick={() => setDuration(days)}
                  className={`flex sm:flex-col items-center gap-3 sm:gap-1 p-4 rounded-xl border text-left sm:text-center transition-all ${
                    selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full text-base sm:text-lg font-bold ${selected ? 'bg-primary/20 text-primary' : 'bg-secondary text-foreground'}`}>
                    {days}
                  </div>
                  <div className="flex-1 sm:flex-none">
                    <p className="text-sm font-medium text-foreground">
                      {days === 30 ? '1 месяц' : days === 45 ? '1,5 месяца' : '2 месяца'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {days === 30 ? 'Короткий запуск' : days === 45 ? 'Рекомендуется' : 'Глубокий прогрев'}
                    </p>
                  </div>
                  {selected && <Check className="h-4 w-4 text-primary shrink-0 sm:hidden" />}
                </button>
              )
            })}
          </div>

          {/* Start date */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Дата старта прогрева</Label>
            <p className="text-xs text-muted-foreground">С этой даты сервис сформирует расписание контент-плана</p>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-input border-border h-10 text-sm max-w-xs"
            />
          </div>
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

      {/* Step 4: Warm audience (renamed) */}
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

                {/* Free event fields */}
                {isChecked && value === 'free_event' && (
                  <div className="mt-1 ml-4 p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Название мероприятия</Label>
                        <Input value={freeEventName} onChange={(e) => setFreeEventName(e.target.value)} placeholder="Вебинар «Как запустить за 30 дней»" className="bg-input border-border text-sm h-10" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Дата мероприятия</Label>
                        <Input type="date" value={freeEventDate} onChange={(e) => setFreeEventDate(e.target.value)} className="bg-input border-border text-sm h-10" />
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

                {/* Paid event fields */}
                {isChecked && value === 'paid_event' && (
                  <div className="mt-1 ml-4 p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Название мероприятия</Label>
                        <Input value={paidEventName} onChange={(e) => setPaidEventName(e.target.value)} placeholder="Интенсив «За 3 дня к первым продажам»" className="bg-input border-border text-sm h-10" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Дата мероприятия</Label>
                        <Input type="date" value={paidEventDate} onChange={(e) => setPaidEventDate(e.target.value)} className="bg-input border-border text-sm h-10" />
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

          {/* Additional cases */}
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

      {/* Step 8: Summary */}
      {step === 8 && (
        <div className="space-y-4">
          {summary ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <Sparkles className="h-4 w-4 text-primary" />
                Стратегия прогрева
              </p>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{summary}</div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-muted-foreground text-sm mb-4">Нажмите для формирования стратегии прогрева</p>
            </div>
          )}

          {!summary && (
            <Button onClick={generateSummary} disabled={generatingSummary} className="w-full gradient-accent text-white hover:opacity-90">
              {generatingSummary
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Формируем стратегию...</>
                : <><Sparkles className="mr-2 h-4 w-4" /> Создать план прогрева</>
              }
            </Button>
          )}

          {summary && !summaryApproved && (
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" className="flex-1 border-border" onClick={() => setSummary(null)}>
                Изменить настройки
              </Button>
              <Button className="flex-1 gradient-accent text-white hover:opacity-90" onClick={() => setSummaryApproved(true)}>
                <Check className="mr-2 h-4 w-4" />
                Одобрить стратегию
              </Button>
            </div>
          )}

          {summaryApproved && (
            <Button onClick={createPlan} disabled={loading} className="w-full gradient-accent text-white hover:opacity-90">
              {loading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Создание плана...</>
                : <><Check className="mr-2 h-4 w-4" /> Создать план прогрева</>
              }
            </Button>
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
              if (step === 7) generateSummary()
              else setStep(step + 1)
            }}
            className="gradient-accent text-white hover:opacity-90"
            disabled={step === 7 && generatingSummary}
          >
            {step === 7 ? (
              generatingSummary
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Формируем...</>
                : <><Sparkles className="mr-2 h-4 w-4" /> Создать план прогрева</>
            ) : (
              <>Далее <ChevronRight className="ml-1 h-4 w-4" /></>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
