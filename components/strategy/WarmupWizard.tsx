'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
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
  RefreshCw,
} from 'lucide-react'
import type { Product, Funnel } from '@/types'

// ── Markdown renderer ─────────────────────────────────────────────────────────
function PlanRenderer({ markdown }: { markdown: string }) {
  const html = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MarkdownIt = require('markdown-it') as new (opts?: object) => { render: (s: string) => string }
    const md = new MarkdownIt({ html: false, breaks: true, linkify: false })
    return md.render(markdown)
  }, [markdown])

  return (
    <div
      className="plan-md text-sm text-foreground leading-relaxed"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

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

  const phase1Days = Math.round(params.duration * 0.15)
  const phase2Days = Math.round(params.duration * 0.25)
  const phase3Days = Math.round(params.duration * 0.30)
  const phase4Days = params.duration - phase1Days - phase2Days - phase3Days

  const phase1End = phase1Days
  const phase2End = phase1Days + phase2Days
  const phase3End = phase1Days + phase2Days + phase3Days

  const hasEvent = params.warmTypes.includes('free_event') || params.warmTypes.includes('paid_event')

  return `# ПЛАН ПРОГРЕВА: ${params.productName} | ${params.duration} дней

## Общая информация

| Параметр | Значение |
|----------|----------|
| Продукт | ${params.productName} |
| Длительность | ${params.duration} дней |
| Старт | ${params.startDate || 'по согласованию'} |
| Воронка | ${params.funnelDesc} |
| Прогрев | ${warmLabels.join(', ') || 'через контент блога'} |
| Кейсы | ${params.useCases ? 'используются' : 'без кейсов'} |

## Фазы прогрева

### 🔥 Фаза 1: Активация и осознание проблемы (15%, дни 1–${phase1End})

**Цель:** Разбудить аудиторию, переключить с режима «у меня всё ок» в «мне нужно решение»
**Сегменты:** Новички (простой вход), Скептики (факты и цифры), Спящие (FOMO-триггеры)

**Типы контента:**
- Провокационный вопрос / опрос в сторис: «Ты уже сталкивался с этим?»
- Пост-диагностика: «5 признаков, что тебе нужен [продукт]»
- Личная история: с чего начинался твой путь в теме
- Статистика и факты по нише — пробуждение через цифры
- Квиз или тест для вовлечения и сегментации аудитории

**Механики:** опросы в сторис, интерактивные квизы, призыв комментировать

---

### 💡 Фаза 2: Знакомство и доверие (25%, дни ${phase1End + 1}–${phase2End})

**Цель:** Сформировать экспертность, показать личные ценности, создать эмоциональную связь

**Типы контента:**
- Закулисье работы: как создаётся продукт / как ты работаешь с клиентами
- Экспертный пост: разбор типичной ошибки в нише
- Личные ценности и убеждения — «почему я этим занимаюсь»
- Ответы на популярные вопросы аудитории (FAQ-формат)
${params.useCases ? '- Первые кейсы и отзывы — лёгкие истории успеха клиентов' : '- Демонстрация метода через конкретный пример или мини-кейс'}

**Фокус:** регулярность и последовательность, без резких продающих сигналов

---

### 🎯 Фаза 3: Желание и трансформация (30%, дни ${phase2End + 1}–${phase3End})

**Цель:** Показать результат до/после, закрыть ключевые возражения, усилить желание

**Типы контента:**
- ${params.useCases ? 'Развёрнутые кейсы клиентов с конкретными цифрами и трансформацией' : 'Пошаговая демонстрация метода — как это работает на практике'}
- Разбор возражений: «Это дорого», «У меня нет времени», «Я уже пробовал»
- Пост «Что будет, если ничего не менять» — усиление боли
- Детали продукта: что внутри, как построен процесс, почему это работает
- Личная трансформация — твой путь и результаты${hasEvent ? '\n- Анонс предстоящего мероприятия — создание ожидания' : ''}

${hookLabels.length > 0 ? `**Смысловые крючки этой фазы:**\n${hookLabels.map(h => `- ${h}`).join('\n')}` : ''}

---

### 💰 Фаза 4: Открытие продаж (30%, дни ${phase3End + 1}–${params.duration})

**Цель:** Конвертировать прогретую аудиторию в покупателей с помощью дефицита и ограниченного окна

**Механики продаж:**
- Early Bird: специальная цена или бонус для первых покупателей (первые 24–48 часов)
- Окно продаж: строго 5–7 дней, жёсткий дедлайн
- Ежедневная работа с возражениями через сторис и посты
- FOMO-контент для тех, кто «думает»: что они потеряют, если не купят сейчас
- Отзывы и реакции первых покупателей в реальном времени

**Типы контента:**
- Пост-открытие продаж: «Это то, к чему мы шли весь [X] дней»
- Сторис с обратным отсчётом до закрытия
- Разборы и ответы на вопросы о продукте (прямые эфиры)
- Посты с кейсами тех, кто уже купил (социальное доказательство)
- Финальный пост: «Последний шанс» с чётким дедлайном

---

## Ключевые смысловые крючки

${hookLabels.length > 0 ? hookLabels.map((h, i) => {
  const phases = ['Фаза 2–3', 'Фаза 1–2', 'Фаза 3–4', 'Фаза 1–3', 'Фаза 3–4', 'Фаза 2–3', 'Фаза 1–2']
  return `- **${h}** → ${phases[i % phases.length]}`
}).join('\n') : '- Смысловые крючки будут определены на основе материалов проекта'}
${params.extraHooks ? `\n**Дополнительные смыслы:**\n${params.extraHooks}` : ''}

## Рекомендации по форматам

| Формат | Частота | Когда использовать |
|--------|---------|-------------------|
| Stories | Ежедневно | Поддержание контакта, опросы, обратный отсчёт |
| Reels/видео | 2–3 раза в неделю | Охват новой аудитории, виральные темы |
| Посты/карусели | 3–4 раза в неделю | Глубокий экспертный контент, кейсы |
| Прямые эфиры | 1–2 в фазах 3–4 | Q&A, разборы, открытие продаж |

${params.competitors ? `## Конкурентный анализ\n\n${params.competitors}` : ''}

---
*Шаблон сформирован автоматически. Для персонализированного плана с учётом карты смыслов используйте генерацию через AI.*`
}

export function WarmupWizard({ projectId, products, funnels, onComplete }: WarmupWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryApproved, setSummaryApproved] = useState(false)
  const [isFallback, setIsFallback] = useState(false)

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
            content: `Ты эксперт по контент-маркетингу и прогревам в социальных сетях. Создай детальный структурированный план прогрева аудитории.

ДАННЫЕ:
- Продукт: ${selectedProduct?.name || 'не выбран'}
- Длительность: ${duration} дней${startDate ? `, старт: ${startDate}` : ''}
- Воронка продаж: ${funnelDesc}
- Прогрев в блоге: ${warmAudienceTypes.join(', ')}
- Использовать кейсы: ${useCases ? 'да' : 'нет'}${extraCasesText ? `\n- Доп. кейсы: ${extraCasesText}` : ''}
- Смысловые крючки (из карты смыслов): ${selectedHooks.join(', ')}
- Дополнительно: ${extraHooks}
- Конкуренты: ${competitorNotes}

МЕТОДОЛОГИЯ (строго соблюдать):
1. Темы контента берутся из карты смыслов блогера, не придумываются общие
2. Аудитория сегментируется: новички, скептики, «спящие» (FOMO-триггеры)
3. Используется «Лестница Ханта»: контент для тех, кто ещё не осознал проблему → осознал → выбирает решение
4. Обязательно: событийность (вебинар/эфир/челлендж) как кульминация, если выбрано мероприятие
5. Триггеры: Early Bird, ограниченное окно продаж 5-7 дней, дефицит
6. Микро-результаты внутри прогрева — польза до покупки

ФОРМАТ ОТВЕТА (строго структурированный, не сплошной текст):

# ПЛАН ПРОГРЕВА: ${selectedProduct?.name || 'продукт'} | ${duration} дней

## Общая информация
| Параметр | Значение |
|----------|----------|
| Продукт | ${selectedProduct?.name || '—'} |
| Длительность | ${duration} дней |
| Старт | ${startDate || 'по согласованию'} |
| Воронка | [вставь] |

## Фазы прогрева

### 🔥 Фаза 1: Активация и осознание проблемы (15%, дни 1-[X])
**Цель:** Разбудить аудиторию, переключить с режима «у меня всё ок» в «мне нужно решение»
**Сегменты:** Новички (простой вход), Скептики (факты и цифры), Спящие (FOMO)
**Типы контента:**
- [перечисли 4-5 конкретных типов из карты смыслов]
**Механики:** [опросы, квизы, диагностика]

### 💡 Фаза 2: Знакомство и доверие (25%, дни [X]-[Y])
**Цель:** Экспертность, личная история, ценности
**Типы контента:**
- [перечисли 4-5 типов]
**Кейсы:** [если useCases=true]

### 🎯 Фаза 3: Желание и трансформация (30%, дни [Y]-[Z])
**Цель:** Показать результат, закрыть возражения через кейсы
**Типы контента:**
- [перечисли 5-6 типов]
**Событие:** [если есть мероприятие — детали]

### 💰 Фаза 4: Открытие продаж (30%, дни [Z]-конец)
**Цель:** Продажи с дефицитом и ограниченным окном
**Механики продаж:**
- Early Bird: скидка/бонус первым X покупателям
- Окно продаж: строго 5-7 дней
- Работа с возражениями в контенте
- FOMO для тех, кто пропустил середину
**Типы контента:**
- [перечисли 4-5 типов]

## Ключевые смыслы (из карты смыслов)
[перечисли крючки и как они распределяются по фазам]

## Рекомендации по форматам
| Формат | Частота | Когда использовать |
|--------|---------|-------------------|
| Stories | Ежедневно | Поддержание контакта |
| Reels/видео | 2-3 раза в неделю | Охват и вирусность |
| Посты/карусели | 3-4 раза в неделю | Глубокий контент |

Верни только структурированный план, без лишних вступлений.`,
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
      setIsFallback(false)
      setStep(8)
    } catch {
      // Fallback: generate template summary
      toast.info('AI временно недоступен — сформирован базовый шаблон. Можно попробовать AI повторно.')
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
      setIsFallback(true)
      setStep(8)
    } finally {
      setGeneratingSummary(false)
    }
  }

  async function createPlan() {
    setLoading(true)
    try {
      // Build structured plan_data for timeline display
      const phases = [
        { phase: 'activation', ratio: 0.15, label: 'Активация', themes: ['Личная история эксперта', 'Почему сейчас', 'Диагностика боли (опрос)', 'FOMO для «спящих»', 'Ценности и подход'] },
        { phase: 'trust', ratio: 0.25, label: 'Знакомство и доверие', themes: ['Экспертный контент из карты смыслов', 'Кейсы клиентов', 'Закулисье работы', 'Разбор мифов в нише', 'Ответы на страхи аудитории'] },
        { phase: 'desire', ratio: 0.30, label: 'Желание и трансформация', themes: ['Трансформации клиентов до/после', 'Детали продукта (что внутри)', 'Боли без решения', 'Результаты через продукт', 'Событие / прямой эфир', 'Микро-результат для подписчиков'] },
        { phase: 'close', ratio: 0.30, label: 'Открытие продаж', themes: [`Открытие продаж: ${selectedProduct?.name || 'продукт'}`, 'Early Bird — бонусы первым покупателям', 'Работа с возражениями', 'Обратный отсчёт (5-7 дней)', 'FOMO — что потеряют без покупки', 'Финал: последний шанс'] },
      ]
      const contentRotation = [['stories'], ['post'], ['reels', 'stories'], ['carousel'], ['stories'], ['post', 'stories'], ['reels']]
      let dayCounter = 1
      const planPhases = phases.map(({ phase, ratio, themes }) => {
        const phaseDays = Math.round(duration * ratio)
        const daily_plan = Array.from({ length: phaseDays }, (_, i) => {
          const entry = { day: dayCounter, format: contentRotation[(dayCounter - 1) % contentRotation.length] as string[], theme: themes[i % themes.length] }
          dayCounter++
          return entry
        })
        return { phase, daily_plan }
      })

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_warmup_plan',
          projectId,
          data: {
            name: `Прогрев ${duration} дней — ${selectedProduct?.name || 'продукт'}`,
            duration_days: duration,
            start_date: startDate || null,
            audience_type: 'cold_warm',
            strategic_summary: summary,
            summary_approved: true,
            status: 'approved',
            plan_data: { warmup_plan: { phases: planPhases } },
          },
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Ошибка ${res.status}`)
      }
      const { planId } = await res.json()
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
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Название мероприятия</Label>
                        <Input value={freeEventName} onChange={(e) => setFreeEventName(e.target.value)} placeholder="Вебинар «Как запустить за 30 дней»" className="bg-input border-border text-sm h-10" />
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

                {/* Paid event fields */}
                {isChecked && value === 'paid_event' && (
                  <div className="mt-1 ml-4 p-4 rounded-xl border border-border bg-secondary/20 space-y-3">
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Название мероприятия</Label>
                        <Input value={paidEventName} onChange={(e) => setPaidEventName(e.target.value)} placeholder="Интенсив «За 3 дня к первым продажам»" className="bg-input border-border text-sm h-10" />
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
            <>
              {/* Fallback warning with AI retry */}
              {isFallback && (
                <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <Sparkles className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-yellow-600">Базовый шаблон</p>
                    <p className="text-xs text-muted-foreground mt-0.5">AI временно недоступен. Это шаблон — ты можешь его одобрить или попробовать сгенерировать через AI.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2 border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/10 shrink-0"
                    onClick={() => { setSummary(null); setIsFallback(false); generateSummary() }}
                    disabled={generatingSummary}
                  >
                    {generatingSummary ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RefreshCw className="h-3 w-3 mr-1" />AI</>}
                  </Button>
                </div>
              )}

              {/* Plan rendered beautifully */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/5">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    {isFallback ? 'Шаблон плана прогрева' : 'План прогрева сформирован'}
                  </span>
                  {!isFallback && <Badge className="ml-auto text-[10px] bg-green-500/15 text-green-400 border-green-500/25">AI</Badge>}
                </div>
                <div className="p-4 max-h-[50vh] overflow-y-auto">
                  <PlanRenderer markdown={summary} />
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <Sparkles className="h-10 w-10 text-primary/40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">AI проанализирует все данные и создаст персональный план с учётом карты смыслов</p>
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
            <div className="flex flex-col gap-2">
              {!isFallback && (
                <Button
                  variant="outline"
                  className="w-full border-border text-xs h-9"
                  onClick={() => { setSummary(null); setIsFallback(false); generateSummary() }}
                  disabled={generatingSummary}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  {generatingSummary ? 'Генерируем...' : 'Перегенерировать через AI'}
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-border" onClick={() => { setSummary(null); setIsFallback(false) }}>
                  Изменить настройки
                </Button>
                <Button className="flex-1 gradient-accent text-white hover:opacity-90" onClick={() => setSummaryApproved(true)}>
                  <Check className="mr-2 h-4 w-4" />
                  Одобрить
                </Button>
              </div>
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
