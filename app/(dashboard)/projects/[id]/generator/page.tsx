'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ContentEditor } from '@/components/content/ContentEditor'
import { ExportPanel } from '@/components/content/ExportPanel'
import { toast } from 'sonner'
import {
  ArrowLeft, Sparkles, Loader2, RefreshCw, CheckCircle, Clock,
  FileText, Image, Video, Layers, BookMarked, ShieldCheck, ChevronDown,
} from 'lucide-react'
import type { ContentType, WarmupPhase, ContentItem } from '@/types'

const CONTENT_TYPES: Array<{ value: ContentType; label: string; icon: React.ElementType; desc: string }> = [
  { value: 'post', label: 'Пост', icon: FileText, desc: 'Текстовый пост для соцсетей' },
  { value: 'carousel', label: 'Карусель', icon: Layers, desc: 'Пост-карусель из нескольких слайдов' },
  { value: 'reels', label: 'Рилс', icon: Video, desc: 'Сценарий с раскадровкой' },
  { value: 'stories', label: 'Сториз', icon: Image, desc: 'Серия сториз (3-5 штук)' },
]

const PHASES: Array<{ value: WarmupPhase; label: string; desc: string }> = [
  { value: 'awareness', label: 'Знакомство', desc: 'Аудитория только узнаёт о тебе и твоей теме' },
  { value: 'trust', label: 'Доверие', desc: 'Строим авторитет через кейсы и экспертные посты' },
  { value: 'desire', label: 'Желание', desc: 'Создаём желание купить продукт' },
  { value: 'close', label: 'Закрытие', desc: 'Финальный призыв и работа с возражениями' },
]

interface GeneratedContent {
  item: ContentItem
  structuredData?: Record<string, unknown>
  was_validated?: boolean
}

export default function GeneratorPage() {
  const params = useParams()
  const id = params.id as string

  const [contentType, setContentType] = useState<ContentType>('post')
  const [phase, setPhase] = useState<WarmupPhase>('awareness')
  const [dayNumber, setDayNumber] = useState('1')
  const [totalDays, setTotalDays] = useState('45')
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [approving, setApproving] = useState(false)
  const [generated, setGenerated] = useState<GeneratedContent | null>(null)
  const [editedText, setEditedText] = useState('')
  const [versions, setVersions] = useState<Array<{ version: number; text: string }>>([])
  const [approved, setApproved] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          contentType,
          dayNumber: parseInt(dayNumber),
          totalDays: parseInt(totalDays),
          phase,
          additionalInstructions: additionalInstructions || undefined,
        }),
      })

      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()

      if (generated) {
        setVersions([...versions, { version: generated.item.version_number, text: editedText || generated.item.body_text || '' }])
      }

      setGenerated(data)
      setEditedText(data.item.body_text || '')
      setApproved(false)
      if (data.was_validated) {
        toast.success('Контент сгенерирован и проверен Валидатором Смыслов ✓')
      } else {
        toast.success('Контент сгенерирован!')
      }
    } catch (error) {
      toast.error('Ошибка создания контента')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [id, contentType, phase, dayNumber, totalDays, additionalInstructions, generated, editedText, versions])

  const handleApprove = useCallback(async () => {
    if (!generated || !editedText.trim()) return
    setApproving(true)
    try {
      // Save to style bank (this also marks content_item as approved)
      await fetch('/api/style-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          contentType: generated.item.content_type,
          title: generated.item.title,
          bodyText: editedText,
          warmupPhase: generated.item.warmup_phase,
          sourceContentItemId: generated.item.id,
        }),
      })
      setApproved(true)
      toast.success('Одобрено и добавлено в Банк Стиля! AI будет учиться на этом посте 🎯')
    } catch {
      toast.error('Ошибка одобрения')
    } finally {
      setApproving(false)
    }
  }, [generated, editedText, id])

  const SelectedTypeIcon = CONTENT_TYPES.find((t) => t.value === contentType)?.icon || FileText

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Сделать контент</h1>
          <p className="text-sm text-muted-foreground">AI создаёт контент на основе твоих материалов</p>
        </div>
      </div>

      {!generated && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Как пользоваться генератором</p>
            <ol className="space-y-1 text-xs text-muted-foreground">
              <li><span className="text-primary font-bold">1.</span> Выбери тип контента (пост, рилс, карусель или сториз)</li>
              <li><span className="text-primary font-bold">2.</span> Выбери этап — на каком этапе прогрева находится твоя аудитория</li>
              <li><span className="text-primary font-bold">3.</span> Нажми «Сгенерировать» — AI создаст контент на основе твоих материалов</li>
              <li><span className="text-primary font-bold">4.</span> Отредактируй если нужно, нажми «Одобрить стиль» — AI запомнит этот пример и следующие посты будут точнее</li>
            </ol>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Settings panel */}
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Параметры запроса</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Content type */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Тип контента</Label>
                <div className="grid grid-cols-2 gap-2">
                  {CONTENT_TYPES.map(({ value, label, icon: Icon, desc }) => (
                    <button
                      key={value}
                      onClick={() => setContentType(value)}
                      className={`flex items-start gap-2 p-3 rounded-xl border text-left transition-all ${
                        contentType === value
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/40 hover:bg-secondary/50'
                      }`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${contentType === value ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <p className={`text-xs font-semibold ${contentType === value ? 'text-primary' : 'text-foreground'}`}>{label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Phase */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Этап работы с аудиторией</Label>
                <Select value={phase} onValueChange={(v) => v && setPhase(v as WarmupPhase)}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASES.map(({ value, label, desc }) => (
                      <SelectItem key={value} value={value}>
                        <div>
                          <span>{label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">— {desc}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Advanced settings toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  ⚙ Дополнительные настройки
                </button>
                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">День прогрева</Label>
                      <Input
                        type="number"
                        min="1"
                        max="90"
                        value={dayNumber}
                        onChange={(e) => setDayNumber(e.target.value)}
                        className="bg-input border-border"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Всего дней</Label>
                      <Input
                        type="number"
                        min="1"
                        max="90"
                        value={totalDays}
                        onChange={(e) => setTotalDays(e.target.value)}
                        className="bg-input border-border"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Additional */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Дополнительные инструкции (опционально)</Label>
                <Textarea
                  placeholder="Напр: сделай более провокационным / добавь юмор / укороти..."
                  value={additionalInstructions}
                  onChange={(e) => setAdditionalInstructions(e.target.value)}
                  rows={3}
                  className="bg-input border-border resize-none text-sm"
                />
              </div>

              <Button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full gradient-accent text-white hover:opacity-90"
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Генерация...</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Сгенерировать {CONTENT_TYPES.find(t => t.value === contentType)?.label}</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Result panel */}
        <div className="space-y-4">
          {!generated ? (
            <Card className="border-border border-dashed bg-card/50">
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-accent opacity-60">
                  <SelectedTypeIcon className="h-8 w-8 text-white" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground">Выберите тип и этап, нажмите «Сгенерировать»</p>
                  <p className="text-sm text-muted-foreground mt-1">AI использует загруженные материалы проекта для создания уникального контента в твоём стиле</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <SelectedTypeIcon className="h-4 w-4 text-primary" />
                    {generated.item.title || `${contentType} · День ${generated.item.day_number}`}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs text-muted-foreground border-border">
                      v{generated.item.version_number}
                    </Badge>
                    {generated.item.is_approved && (
                      <Badge className="text-xs bg-green-500/15 text-green-400 border-green-500/25">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Одобрен
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Post text */}
                {(contentType === 'post' || editedText) && (
                  <ContentEditor
                    content={editedText}
                    onChange={setEditedText}
                    placeholder="Текст контента..."
                  />
                )}

                {/* Structured data (carousel, reels, stories) */}
                {generated.structuredData && contentType !== 'post' && (
                  <div className="rounded-xl border border-border bg-secondary/20 p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Структурированные данные ({contentType})</p>
                    <pre className="text-xs text-foreground overflow-auto max-h-48 leading-relaxed">
                      {JSON.stringify(generated.structuredData, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Hashtags */}
                {generated.item.hashtags && generated.item.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {generated.item.hashtags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs text-primary border-primary/30 bg-primary/5">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Version history */}
                {versions.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">История:</span>
                    {versions.map((v) => (
                      <button
                        key={v.version}
                        onClick={() => setEditedText(v.text)}
                        className="text-xs text-primary hover:underline"
                      >
                        v{v.version}
                      </button>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-border text-xs h-8"
                      onClick={handleGenerate}
                      disabled={loading}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      Перегенерировать
                    </Button>
                    <Button
                      size="sm"
                      className={`flex-1 text-xs h-8 ${approved ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30' : 'gradient-accent text-white hover:opacity-90'}`}
                      onClick={handleApprove}
                      disabled={approving || approved}
                    >
                      {approving ? (
                        <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Сохраняю...</>
                      ) : approved ? (
                        <><CheckCircle className="mr-1.5 h-3 w-3" />В банке стиля</>
                      ) : (
                        <><BookMarked className="mr-1.5 h-3 w-3" />Одобрить стиль</>
                      )}
                    </Button>
                  </div>
                  {generated.was_validated && (
                    <div className="flex items-center gap-1.5 text-[10px] text-green-400">
                      <ShieldCheck className="h-3 w-3" />
                      Проверено Валидатором Смыслов
                    </div>
                  )}
                  <ExportPanel content={{ ...generated.item, body_text: editedText }} />
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}
