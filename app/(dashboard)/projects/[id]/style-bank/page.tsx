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
} from 'lucide-react'
import type { StyleExample, ContentType } from '@/types'

const CONTENT_TYPE_CONFIG: Record<ContentType, { label: string; icon: React.ElementType; color: string }> = {
  post: { label: 'Пост', icon: FileText, color: 'text-blue-400' },
  carousel: { label: 'Карусель', icon: Layers, color: 'text-purple-400' },
  reels: { label: 'Рилс', icon: Video, color: 'text-pink-400' },
  stories: { label: 'Сториз', icon: Image, color: 'text-yellow-400' },
  live: { label: 'Прямой эфир', icon: Video, color: 'text-red-400' },
  webinar: { label: 'Вебинар', icon: Video, color: 'text-green-400' },
  email: { label: 'Email', icon: FileText, color: 'text-cyan-400' },
}

const PHASE_CONFIG = {
  awareness: { label: 'Осознание', color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  trust: { label: 'Доверие', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
  desire: { label: 'Желание', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' },
  close: { label: 'Закрытие', color: 'bg-red-500/15 text-red-400 border-red-500/25' },
}

const SCORE_STARS = (score: number) => {
  const stars = Math.round(score / 20) // 0-100 → 0-5 stars
  return Array.from({ length: 5 }, (_, i) => i < stars)
}

export default function StyleBankPage() {
  const params = useParams()
  const id = params.id as string

  const [examples, setExamples] = useState<StyleExample[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<ContentType | 'all'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tipOpen, setTipOpen] = useState(true)
  const [tipInitialized, setTipInitialized] = useState(false)

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
        <Link href={`/projects/${id}/generator`}>
          <Button size="sm" className="gradient-accent text-white hover:opacity-90">
            <Sparkles className="mr-2 h-4 w-4" />
            Генерировать
          </Button>
        </Link>
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
              Здесь хранятся примеры контента, которые ты одобрил(а) в генераторе. AI изучает их, чтобы понять твой уникальный стиль — как ты пишешь, какие слова используешь, какова структура твоих постов.
              Чем больше одобренных примеров — тем точнее AI пишет под тебя.
            </p>
            <p className="text-xs text-primary font-medium mt-2">
              💡 Одобри 5–7 постов в генераторе — и качество контента резко вырастет
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Чтобы добавить примеры: перейди в Генератор → создай пост → нажми «Одобрить стиль»
            </p>
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
              {activeFilter === 'all' ? 'Банк стиля пуст' : `Нет примеров типа «${CONTENT_TYPE_CONFIG[activeFilter as ContentType]?.label}»`}
            </p>
            <p className="text-xs text-muted-foreground">
              Генерируй контент и нажимай «Одобрить стиль» — примеры появятся здесь
            </p>
            <Link href={`/projects/${id}/generator`}>
              <Button size="sm" className="gradient-accent text-white hover:opacity-90 mt-2">
                <Sparkles className="mr-2 h-4 w-4" />
                Перейти в генератор
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
