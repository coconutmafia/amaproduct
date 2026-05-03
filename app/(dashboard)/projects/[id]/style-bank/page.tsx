'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Sparkles,
  Trash2,
  Star,
  FileText,
  Layers,
  Video,
  Image,
  Filter,
  BookMarked,
  TrendingUp,
  ChevronDown,
  Plus,
  X,
} from 'lucide-react'
import type { StyleExample, ContentType } from '@/types'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'

const CONTENT_TYPE_CONFIG: Record<ContentType, { label: string; icon: React.ElementType; color: string }> = {
  post: { label: 'Пост', icon: FileText, color: 'text-blue-400' },
  carousel: { label: 'Карусель', icon: Layers, color: 'text-purple-400' },
  reels: { label: 'Рилс', icon: Video, color: 'text-pink-400' },
  stories: { label: 'Сториз', icon: Image, color: 'text-yellow-400' },
  live: { label: 'Прямой эфир', icon: Video, color: 'text-red-400' },
  webinar: { label: 'Вебинар', icon: Video, color: 'text-green-400' },
  email: { label: 'Email', icon: FileText, color: 'text-cyan-400' },
}

const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  awareness: { label: 'Осознание', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  trust: { label: 'Доверие', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
  desire: { label: 'Желание', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' },
  close: { label: 'Закрытие', color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  niche: { label: 'Прогрев на нишу', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  expert: { label: 'Прогрев на эксперта', color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
  product: { label: 'Прогрев на продукт', color: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
  objections: { label: 'Отработка возражений', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
  activation: { label: 'Активация', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
}

const SCORE_STARS = (score: number) => {
  const stars = Math.round(score / 20) // 0-100 → 0-5 stars
  return Array.from({ length: 5 }, (_, i) => i < stars)
}

const IMPORT_PHASES = [
  { value: 'awareness', label: 'Осознание' },
  { value: 'trust', label: 'Доверие' },
  { value: 'desire', label: 'Желание' },
  { value: 'close', label: 'Закрытие' },
  { value: 'expert', label: 'Прогрев на эксперта' },
  { value: 'niche', label: 'Прогрев на нишу' },
  { value: 'product', label: 'Прогрев на продукт' },
  { value: 'objections', label: 'Возражения' },
]

const IMPORT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'post', label: 'Пост' },
  { value: 'carousel', label: 'Карусель' },
  { value: 'reels', label: 'Рилс' },
  { value: 'stories', label: 'Сториз' },
  { value: 'live', label: 'Прямой эфир' },
  { value: 'email', label: 'Email' },
]

export default function StyleBankPage() {
  const params = useParams()
  const id = params.id as string

  const [examples, setExamples] = useState<StyleExample[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<ContentType | 'all'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tipOpen, setTipOpen] = useState(true)
  const [tipInitialized, setTipInitialized] = useState(false)

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importType, setImportType] = useState<ContentType>('post')
  const [importPhase, setImportPhase] = useState('awareness')
  const [importSaving, setImportSaving] = useState(false)

  const fetchExamples = useCallback(async () => {
    try {
      const res = await fetch(`/api/style-bank?projectId=${id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setExamples(data.examples || [])
    } catch {
      toast.error('Ошибка загрузки банка стиля')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchExamples() }, [fetchExamples])

  useEffect(() => {
    if (!loading && !tipInitialized) {
      setTipOpen(examples.length === 0)
      setTipInitialized(true)
    }
  }, [loading, examples.length, tipInitialized])

  const handleDelete = async (exampleId: string) => {
    try {
      await fetch(`/api/style-bank?id=${exampleId}`, { method: 'DELETE' })
      setExamples((prev) => prev.filter((e) => e.id !== exampleId))
      toast.success('Пример удалён из банка стиля')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const handleRate = async (exampleId: string, stars: number) => {
    const score = stars * 20 // 1-5 stars → 20-100
    try {
      await fetch('/api/style-bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: exampleId, performanceScore: score }),
      })
      setExamples((prev) =>
        prev.map((e) => (e.id === exampleId ? { ...e, performance_score: score } : e))
      )
    } catch {
      toast.error('Ошибка оценки')
    }
  }

  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error('Вставь текст поста')
      return
    }
    setImportSaving(true)
    try {
      const res = await fetch('/api/style-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          contentType: importType,
          warmupPhase: importPhase,
          bodyText: importText.trim(),
          title: importText.trim().split('\n')[0].substring(0, 80),
          performanceScore: 100, // real posts get top score by default
          tags: ['real_post'],
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setExamples((prev) => [data.example, ...prev])
      setImportText('')
      setImportType('post')
      setImportPhase('awareness')
      setImportOpen(false)
      toast.success('Пост добавлен в банк стиля ✓')
    } catch {
      toast.error('Ошибка сохранения')
    } finally {
      setImportSaving(false)
    }
  }

  const filtered = activeFilter === 'all'
    ? examples
    : examples.filter((e) => e.content_type === activeFilter)

  const contentTypes = Array.from(new Set(examples.map((e) => e.content_type))) as ContentType[]

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground text-sm">Загрузка банка стиля...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-primary" />
            Мой стиль контента
          </h1>
          <p className="text-sm text-muted-foreground">
            {examples.length === 0
              ? 'Одобри первый пост — и AI начнёт писать в твоём стиле'
              : `${examples.length} пример${examples.length === 1 ? '' : examples.length < 5 ? 'а' : 'ов'} · AI учится на них при создании контента`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="border-primary/30 text-primary hover:bg-primary/10"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Добавить свой пост
          </Button>
          <Link href={`/projects/${id}/generator`}>
            <Button size="sm" className="gradient-accent text-white hover:opacity-90">
              <Sparkles className="mr-2 h-4 w-4" />
              Генерировать
            </Button>
          </Link>
        </div>
      </div>

      {/* Always-visible tip card */}
      <Card className="border-primary/20 bg-primary/5">
        <button
          onClick={() => setTipOpen(!tipOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <span className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Зачем нужен «Мой стиль контента»?
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${tipOpen ? 'rotate-180' : ''}`} />
        </button>
        {tipOpen && (
          <CardContent className="pt-0 pb-4 px-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Здесь хранятся примеры контента, по которым AI учится твоему стилю — словарный запас, ритм предложений, структура постов. Чем больше примеров — тем точнее AI пишет под тебя.
            </p>
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-primary font-medium">
                💡 Способ 1 (быстрый старт): Вставь свои реальные посты из Instagram / VK / Telegram — нажми «Добавить свой пост»
              </p>
              <p className="text-xs text-muted-foreground">
                💡 Способ 2: Одобряй лучшие результаты в Генераторе — кнопка «Одобрить стиль»
              </p>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                5–7 примеров достаточно, чтобы AI начал писать по-настоящему в твоём стиле
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Filter bar */}
      {contentTypes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={() => setActiveFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeFilter === 'all'
                ? 'border-primary bg-primary/20 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
            }`}
          >
            Все ({examples.length})
          </button>
          {contentTypes.map((type) => {
            const conf = CONTENT_TYPE_CONFIG[type]
            const count = examples.filter((e) => e.content_type === type).length
            return (
              <button
                key={type}
                onClick={() => setActiveFilter(type)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  activeFilter === type
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                {conf.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Import dialog */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setImportOpen(false)} />
          <div className="relative z-10 w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Dialog header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Добавить свой пост</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Вставь реальный пост из Instagram / VK / Telegram — AI научится твоему голосу
                </p>
              </div>
              <button
                onClick={() => setImportOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Type selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Тип контента</label>
              <div className="flex flex-wrap gap-2">
                {IMPORT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setImportType(t.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      importType === t.value
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Phase selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Фаза прогрева</label>
              <div className="flex flex-wrap gap-2">
                {IMPORT_PHASES.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setImportPhase(p.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      importPhase === p.value
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Текст поста
              </label>
              <VoiceTextarea
                value={importText}
                onChange={setImportText}
                placeholder="Вставь текст своего поста из Instagram / VK / Telegram, или надиктуй его..."
                rows={8}
              />
              {importText.trim().length > 0 && (
                <p className="text-[10px] text-muted-foreground">{importText.trim().length} символов</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setImportOpen(false)}
                className="flex-1"
                size="sm"
              >
                Отмена
              </Button>
              <Button
                onClick={handleImport}
                disabled={importSaving || !importText.trim()}
                className="flex-1 gradient-accent text-white hover:opacity-90"
                size="sm"
              >
                {importSaving ? 'Сохраняю...' : 'Добавить в банк стиля'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Examples grid */}
      {filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((example) => {
            const typeConf = CONTENT_TYPE_CONFIG[example.content_type] || CONTENT_TYPE_CONFIG.post
            const TypeIcon = typeConf.icon
            const phaseConf = example.warmup_phase ? PHASE_CONFIG[example.warmup_phase] : null
            const isExpanded = expanded === example.id
            const preview = example.body_text.length > 280
              ? example.body_text.substring(0, 280) + '...'
              : example.body_text
            const stars = SCORE_STARS(example.performance_score)

            return (
              <Card key={example.id} className="border-border bg-card">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <TypeIcon className={`h-4 w-4 ${typeConf.color}`} />
                      <span className="text-sm font-semibold text-foreground">
                        {example.title || typeConf.label}
                      </span>
                      {phaseConf && (
                        <Badge className={`text-[10px] border ${phaseConf.color}`}>
                          {phaseConf.label}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Star rating */}
                      <div className="flex items-center gap-0.5">
                        {stars.map((filled, i) => (
                          <button
                            key={i}
                            onClick={() => handleRate(example.id, i + 1)}
                            className="hover:scale-110 transition-transform"
                          >
                            <Star
                              className={`h-3.5 w-3.5 ${
                                filled ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleDelete(example.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Text preview */}
                  <div
                    className="text-sm text-foreground leading-relaxed cursor-pointer"
                    onClick={() => setExpanded(isExpanded ? null : example.id)}
                  >
                    <p className="whitespace-pre-wrap">{isExpanded ? example.body_text : preview}</p>
                    {example.body_text.length > 280 && (
                      <button className="text-primary text-xs mt-1 hover:underline">
                        {isExpanded ? 'Свернуть' : 'Читать полностью'}
                      </button>
                    )}
                  </div>

                  {/* Tags */}
                  {example.tags && example.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {example.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-[10px] border-border text-muted-foreground">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Meta */}
                  <p className="text-[10px] text-muted-foreground">
                    Добавлен {new Date(example.created_at).toLocaleDateString('ru-RU')}
                    {example.performance_score > 0 && ` · Оценка: ${example.performance_score}/100`}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="border-dashed border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <BookMarked className="h-10 w-10 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium text-foreground">
              {activeFilter === 'all' ? 'Банк стиля пуст — добавь первый пример' : `Нет примеров типа «${CONTENT_TYPE_CONFIG[activeFilter as ContentType]?.label}»`}
            </p>
            {activeFilter === 'all' && (
              <>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Вставь реальные посты из соцсетей или одобряй лучшие результаты в генераторе
                </p>
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImportOpen(true)}
                    className="border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Вставить свой пост
                  </Button>
                  <Link href={`/projects/${id}/generator`}>
                    <Button size="sm" className="gradient-accent text-white hover:opacity-90 w-full sm:w-auto">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Перейти в генератор
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
