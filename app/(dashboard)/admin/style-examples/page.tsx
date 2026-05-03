'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Star,
  FileText,
  Layers,
  Video,
  Image,
  BookMarked,
  X,
  Filter,
} from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import type { ContentType, StyleExample } from '@/types'

const CONTENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  post: { label: 'Пост', icon: FileText, color: 'text-blue-400' },
  carousel: { label: 'Карусель', icon: Layers, color: 'text-purple-400' },
  reels: { label: 'Рилс', icon: Video, color: 'text-pink-400' },
  stories: { label: 'Сториз', icon: Image, color: 'text-yellow-400' },
  live: { label: 'Прямой эфир', icon: Video, color: 'text-red-400' },
  email: { label: 'Email', icon: FileText, color: 'text-cyan-400' },
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

const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  awareness: { label: 'Осознание', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  trust: { label: 'Доверие', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
  desire: { label: 'Желание', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' },
  close: { label: 'Закрытие', color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  niche: { label: 'Прогрев на нишу', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  expert: { label: 'Прогрев на эксперта', color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
  product: { label: 'Прогрев на продукт', color: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
  objections: { label: 'Возражения', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
}

const SCORE_STARS = (score: number) => {
  const stars = Math.round(score / 20)
  return Array.from({ length: 5 }, (_, i) => i < stars)
}

export default function AdminStyleExamplesPage() {
  const [examples, setExamples] = useState<StyleExample[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false)
  const [addText, setAddText] = useState('')
  const [addType, setAddType] = useState<ContentType>('post')
  const [addPhase, setAddPhase] = useState('awareness')
  const [addNiche, setAddNiche] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  const fetchExamples = useCallback(async () => {
    try {
      const res = await fetch('/api/style-bank?system=true')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setExamples(data.examples || [])
    } catch {
      toast.error('Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchExamples() }, [fetchExamples])

  const handleDelete = async (exampleId: string) => {
    try {
      await fetch(`/api/style-bank?id=${exampleId}`, { method: 'DELETE' })
      setExamples((prev) => prev.filter((e) => e.id !== exampleId))
      toast.success('Удалено')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const handleRate = async (exampleId: string, stars: number) => {
    const score = stars * 20
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

  const handleAdd = async () => {
    if (!addText.trim()) {
      toast.error('Вставь текст примера')
      return
    }
    setAddSaving(true)
    try {
      const tags = addNiche.trim() ? ['system', addNiche.trim()] : ['system']
      const res = await fetch('/api/style-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isSystem: true,
          contentType: addType,
          warmupPhase: addPhase,
          bodyText: addText.trim(),
          title: addText.trim().split('\n')[0].substring(0, 80),
          performanceScore: 100,
          tags,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error')
      }
      const data = await res.json()
      setExamples((prev) => [data.example, ...prev])
      setAddText('')
      setAddNiche('')
      setAddType('post')
      setAddPhase('awareness')
      setAddOpen(false)
      toast.success('Системный пример добавлен ✓')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setAddSaving(false)
    }
  }

  const filtered = activeFilter === 'all'
    ? examples
    : examples.filter((e) => e.content_type === activeFilter)

  const contentTypes = Array.from(new Set(examples.map((e) => e.content_type)))

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground text-sm">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href="/admin/users"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-primary" />
            Системные примеры стиля
          </h1>
          <p className="text-sm text-muted-foreground">
            {examples.length} примеров · используются как baseline для всех проектов у которых нет личных примеров
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
          className="gradient-accent text-white hover:opacity-90"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Добавить пример
        </Button>
      </div>

      {/* Info card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Эти примеры загружаются в контекст AI автоматически когда у пользователя меньше 3 личных одобренных постов.
            Добавляй примеры по разным нишам и типам контента — AI будет ориентироваться на них как на эталон качества.
          </p>
          <p className="text-xs text-primary font-medium mt-2">
            💡 Цель: 3–5 примеров на каждый тип контента (пост, рилс, сториз, карусель) × ключевые фазы прогрева
          </p>
        </CardContent>
      </Card>

      {/* Stats */}
      {examples.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {IMPORT_TYPES.map((t) => {
            const count = examples.filter((e) => e.content_type === t.value).length
            const conf = CONTENT_TYPE_CONFIG[t.value]
            const TypeIcon = conf.icon
            return (
              <div key={t.value} className="bg-card border border-border rounded-xl p-3 flex items-center gap-2">
                <TypeIcon className={`h-4 w-4 ${conf.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                  <p className="text-sm font-bold text-foreground">{count}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filter */}
      {contentTypes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={() => setActiveFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeFilter === 'all'
                ? 'border-primary bg-primary/20 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            Все ({examples.length})
          </button>
          {contentTypes.map((type) => {
            const conf = CONTENT_TYPE_CONFIG[type] || CONTENT_TYPE_CONFIG.post
            const count = examples.filter((e) => e.content_type === type).length
            return (
              <button
                key={type}
                onClick={() => setActiveFilter(type)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  activeFilter === type
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                }`}
              >
                {conf.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Add dialog */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAddOpen(false)} />
          <div className="relative z-10 w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Добавить системный пример</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Этот пример будет доступен всем проектам как эталон
                </p>
              </div>
              <button onClick={() => setAddOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Тип контента</label>
              <div className="flex flex-wrap gap-2">
                {IMPORT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setAddType(t.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      addType === t.value
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Phase */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Фаза прогрева</label>
              <div className="flex flex-wrap gap-2">
                {IMPORT_PHASES.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setAddPhase(p.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      addPhase === p.value
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Niche tag */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Ниша (необязательно)
              </label>
              <input
                type="text"
                value={addNiche}
                onChange={(e) => setAddNiche(e.target.value)}
                placeholder="психология, фитнес, бизнес, онлайн-образование..."
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Text */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Текст примера
              </label>
              <VoiceTextarea
                value={addText}
                onChange={setAddText}
                placeholder="Вставь эталонный текст поста или надиктуй его..."
                rows={8}
              />
              {addText.trim().length > 0 && (
                <p className="text-[10px] text-muted-foreground">{addText.trim().length} символов</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setAddOpen(false)} className="flex-1" size="sm">
                Отмена
              </Button>
              <Button
                onClick={handleAdd}
                disabled={addSaving || !addText.trim()}
                className="flex-1 gradient-accent text-white hover:opacity-90"
                size="sm"
              >
                {addSaving ? 'Сохраняю...' : 'Добавить в систему'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Examples list */}
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
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeIcon className={`h-4 w-4 ${typeConf.color}`} />
                      <span className="text-sm font-semibold text-foreground">
                        {example.title || typeConf.label}
                      </span>
                      {phaseConf && (
                        <Badge className={`text-[10px] border ${phaseConf.color}`}>
                          {phaseConf.label}
                        </Badge>
                      )}
                      {example.tags && example.tags.filter(t => t !== 'system').map(tag => (
                        <Badge key={tag} variant="outline" className="text-[10px] border-border text-muted-foreground">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-0.5">
                        {stars.map((filled, i) => (
                          <button key={i} onClick={() => handleRate(example.id, i + 1)} className="hover:scale-110 transition-transform">
                            <Star className={`h-3.5 w-3.5 ${filled ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} />
                          </button>
                        ))}
                      </div>
                      <button onClick={() => handleDelete(example.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

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

                  <p className="text-[10px] text-muted-foreground">
                    Добавлен {new Date(example.created_at).toLocaleDateString('ru-RU')}
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
              {activeFilter === 'all' ? 'Системных примеров нет — добавь первый' : `Нет примеров типа «${CONTENT_TYPE_CONFIG[activeFilter]?.label}»`}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Добавляй эталонные посты разных типов и фаз — они будут подсказывать AI структуру и тон даже для новых пользователей
            </p>
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="gradient-accent text-white hover:opacity-90 mt-2"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Добавить первый пример
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
