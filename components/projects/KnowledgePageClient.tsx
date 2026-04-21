'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import { UnpackingInterview } from '@/components/projects/UnpackingInterview'
import { toast } from 'sonner'
import {
  CheckCircle2, Circle, Loader, AlertCircle, Upload, BookOpen,
  X, File, Loader2, Plus, FileText, Mic, ChevronDown, ChevronUp,
  Info, MessageSquare, Sparkles,
} from 'lucide-react'

interface Material {
  id: string
  material_type: string
  title: string
  processing_status: string
}

interface Props {
  projectId: string
  completenessScore: number
  initialMaterials: Material[]
  userName?: string
}

// ── Descriptions & hints per type ────────────────────────────────────────────
const TYPE_META: Record<string, { label: string; hint: string; category: string }> = {
  audience_survey: {
    label: 'Результаты опросов',
    hint: 'Загрузи результаты опросов, которые ты проводил(а) в Stories, постах или через Google Forms — они помогут лучше понять аудиторию.',
    category: 'АУДИТОРИЯ',
  },
  interview_transcript: {
    label: 'Транскрипты созвонов',
    hint: 'Если проводил(а) глубинные интервью с подписчиками (CustDev, кастдевы) — загрузи расшифровки. Текстовый формат.',
    category: 'АУДИТОРИЯ',
  },
  audience_research: {
    label: 'Исследование аудитории',
    hint: 'Любые аналитические данные о твоей аудитории: демография, интересы, боли, желания.',
    category: 'АУДИТОРИЯ',
  },
  unpacking_map: {
    label: 'Распаковка личности',
    hint: 'Подробная информация о тебе: ценности, история, экспертиза, жизненный путь. Загрузи файл с распаковкой или пройди интервью прямо здесь.',
    category: 'СТРАТЕГИЯ',
  },
  meanings_map: {
    label: 'Карта смыслов блога',
    hint: 'Документ с ключевыми смыслами, которые ты транслируешь через блог — о чём ты, зачем тебя читать.',
    category: 'СТРАТЕГИЯ',
  },
  competitors: {
    label: 'Конкуренты',
    hint: 'Список конкурентов с описанием их сильных и слабых сторон. Поможет выстроить отстройку и взять лучшее.',
    category: 'СТРАТЕГИЯ',
  },
  tone_of_voice: {
    label: 'Tone of Voice',
    hint: 'Как ты общаешься с аудиторией: стиль речи, слова-маркеры, что можно и нельзя говорить в твоём блоге.',
    category: 'СТРАТЕГИЯ',
  },
  cases_reviews: {
    label: 'Кейсы и отзывы',
    hint: 'Скриншоты или тексты отзывов клиентов, кейсы результатов — используются в контенте как социальные доказательства.',
    category: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА',
  },
  marketing_strategy: {
    label: 'Маркетинговая стратегия',
    hint: 'Общий стратегический документ: позиционирование, цели, ключевые сообщения.',
    category: 'МАРКЕТИНГ',
  },
  marketing_tactics: {
    label: 'Маркетинговая тактика',
    hint: 'Конкретная тактика продвижения и продаж: где и как ты привлекаешь аудиторию, как ты доводишь её до продажи.',
    category: 'МАРКЕТИНГ',
  },
  funnel_description: {
    label: 'Описание воронок',
    hint: 'Как устроены твои воронки продаж: шаги, точки входа, что происходит на каждом этапе.',
    category: 'МАРКЕТИНГ',
  },
  chatbot_description: {
    label: 'Описание чат-ботов',
    hint: 'Скрипты, сценарии, тексты или описание чат-ботов Telegram/Instagram, если они есть.',
    category: 'МАРКЕТИНГ',
  },
}

const CATEGORIES = [
  {
    key: 'АУДИТОРИЯ',
    title: 'АУДИТОРИЯ',
    types: ['audience_survey', 'interview_transcript', 'audience_research'],
  },
  {
    key: 'СТРАТЕГИЯ',
    title: 'СТРАТЕГИЯ',
    types: ['unpacking_map', 'meanings_map', 'competitors', 'tone_of_voice'],
  },
  {
    key: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА',
    title: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА',
    types: ['cases_reviews'],
  },
  {
    key: 'МАРКЕТИНГ',
    title: 'МАРКЕТИНГ',
    types: ['marketing_strategy', 'marketing_tactics', 'funnel_description', 'chatbot_description'],
  },
]

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
  if (status === 'processing') return <Loader className="h-4 w-4 text-yellow-400 animate-spin shrink-0" />
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
  return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
}

// ── Upload Dialog ─────────────────────────────────────────────────────────────
interface UploadDialogProps {
  projectId: string
  materialType: string
  typeLabel: string
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'
interface QueueItem {
  id: string; file?: File; text?: string; title: string
  status: UploadStatus; error?: string
}

function UploadDialog({ projectId, materialType, typeLabel, open, onClose, onSuccess }: UploadDialogProps) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [showText, setShowText] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = { current: null as any }

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files)
    setQueue(prev => [...prev, ...arr.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      title: f.name.replace(/\.[^.]+$/, ''),
      status: 'pending' as const,
    }))])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  const addText = () => {
    if (!textContent.trim()) { toast.error('Вставьте текст'); return }
    if (!textTitle.trim()) { toast.error('Введите название'); return }
    setQueue(prev => [...prev, { id: `t-${Date.now()}`, text: textContent.trim(), title: textTitle.trim(), status: 'pending' }])
    setTextTitle(''); setTextContent(''); setShowText(false)
  }

  const toggleRecording = () => {
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { toast.error('Голосовой ввод не поддерживается'); return }
    const r = new SR(); r.lang = 'ru-RU'; r.continuous = true; r.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (ev: any) => setTextContent(p => p + ' ' + Array.from(ev.results as any[]).map((x: any) => x[0].transcript).join(''))
    r.onerror = () => setIsRecording(false)
    r.onend = () => setIsRecording(false)
    recognitionRef.current = r; r.start(); setIsRecording(true)
  }

  const uploadOne = async (item: QueueItem) => {
    const fd = new FormData()
    fd.append('projectId', projectId)
    fd.append('title', item.title || 'Без названия')
    fd.append('materialType', materialType)
    fd.append('isSystemVault', 'false')
    if (item.file) fd.append('file', item.file)
    if (item.text) fd.append('textContent', item.text)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Ошибка ${res.status}`) }
  }

  const handleUpload = async () => {
    const pending = queue.filter(i => i.status === 'pending')
    if (!pending.length) { toast.error('Нет файлов для загрузки'); return }
    setIsUploading(true)
    let ok = 0; let err = 0
    for (const item of pending) {
      setQueue(p => p.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i))
      try {
        await uploadOne(item)
        setQueue(p => p.map(i => i.id === item.id ? { ...i, status: 'done' } : i))
        ok++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка'
        setQueue(p => p.map(i => i.id === item.id ? { ...i, status: 'error', error: msg } : i))
        err++
      }
    }
    setIsUploading(false)
    if (ok > 0) toast.success(`Загружено: ${ok}`)
    if (err > 0) toast.error(`Ошибок: ${err}`)
    if (err === 0) { setTimeout(() => { setQueue([]); onClose(); onSuccess() }, 600) }
    else { onSuccess() }
  }

  const pending = queue.filter(i => i.status === 'pending').length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isUploading && !v) { setQueue([]); onClose() } }}>
      <DialogContent className="sm:max-w-lg border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{typeLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Hint from meta */}
          {TYPE_META[materialType] && (
            <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <span>{TYPE_META[materialType].hint}</span>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById(`file-input-${materialType}`)?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-secondary/30 p-6 cursor-pointer transition-all"
          >
            <input
              id={`file-input-${materialType}`}
              type="file" multiple className="hidden"
              accept=".pdf,.txt,.md,.csv,.docx,.doc,.xlsx,.xls,.pages,.numbers,.rtf,.odt"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
            <Upload className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-center text-muted-foreground">
              Перетащи файлы или нажми для выбора<br />
              <span className="text-xs">PDF, DOCX, TXT, CSV, XLSX и другие</span>
            </p>
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {queue.map(item => (
                <div key={item.id} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                  item.status === 'done' ? 'border-green-500/20 bg-green-500/5' :
                  item.status === 'error' ? 'border-red-500/20 bg-red-500/5' :
                  item.status === 'uploading' ? 'border-primary/30 bg-primary/5' : 'border-border'
                }`}>
                  {item.status === 'uploading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" /> :
                   item.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> :
                   item.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" /> :
                   <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="flex-1 truncate">{item.title}</span>
                  {item.error && <span className="text-destructive text-[10px]">{item.error}</span>}
                  {item.status === 'pending' && (
                    <button onClick={() => setQueue(p => p.filter(i => i.id !== item.id))}>
                      <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Text input */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setShowText(!showText)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/50 transition-colors text-muted-foreground"
            >
              <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Добавить текст (PDF, Google Docs)</span>
              {showText ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showText && (
              <div className="px-4 pb-4 pt-3 space-y-2 border-t border-border">
                <Input placeholder="Название *" value={textTitle} onChange={(e) => setTextTitle(e.target.value)} className="text-sm" />
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Текст</Label>
                  <button onClick={toggleRecording} className={`flex items-center gap-1 text-xs ${isRecording ? 'text-red-400' : 'text-muted-foreground'}`}>
                    <Mic className={`h-3 w-3 ${isRecording ? 'animate-pulse' : ''}`} />
                    {isRecording ? 'Стоп' : 'Голос'}
                  </button>
                </div>
                <Textarea placeholder="Вставь текст..." value={textContent} onChange={(e) => setTextContent(e.target.value)} rows={3} className="text-sm resize-none" />
                <Button size="sm" variant="outline" onClick={addText} className="w-full border-dashed">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Добавить в очередь
                </Button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setQueue([]); onClose() }} disabled={isUploading}>Отмена</Button>
            <Button className="flex-1 gradient-accent text-white hover:opacity-90" onClick={handleUpload} disabled={isUploading || pending === 0}>
              {isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загружаем...</> : <><Upload className="mr-2 h-4 w-4" />Загрузить{pending > 0 ? ` (${pending})` : ''}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export function KnowledgePageClient({ projectId, completenessScore, initialMaterials, userName }: Props) {
  const router = useRouter()
  const [uploadFor, setUploadFor] = useState<string | null>(null)
  const [showInterview, setShowInterview] = useState(false)
  const [score, setScore] = useState(completenessScore)
  const [materials, setMaterials] = useState(initialMaterials)
  const [showHint, setShowHint] = useState<string | null>(null)

  const materialsByType = materials.reduce<Record<string, Material[]>>((acc, m) => {
    if (!acc[m.material_type]) acc[m.material_type] = []
    acc[m.material_type]!.push(m)
    return acc
  }, {})

  const handleSuccess = () => {
    router.refresh()
  }

  return (
    <>
      {/* Progress */}
      <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card">
        <BookOpen className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium mb-2">
            Чем больше материалов — тем точнее и персональнее контент!
          </p>
          <ProgressIndicator score={score} />
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-4">
        {CATEGORIES.map((cat) => (
          <Card key={cat.key} className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground tracking-wider">
                {cat.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              {cat.types.map((type) => {
                const meta = TYPE_META[type]
                const items = materialsByType[type] || []
                const hasItems = items.length > 0
                const latest = items[0]

                return (
                  <div key={type}>
                    <div className={`p-4 rounded-xl border transition-colors ${
                      hasItems
                        ? 'border-green-500/20 bg-green-500/5'
                        : 'border-border bg-secondary/20'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          <StatusIcon status={latest?.processing_status || 'none'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Label row */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-foreground leading-snug">
                                {meta?.label || type}
                                {items.length > 1 && (
                                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">({items.length})</span>
                                )}
                              </p>
                              {latest && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{latest.title}</p>
                              )}
                            </div>
                            {/* Подробнее text link */}
                            <button
                              onClick={() => setShowHint(showHint === type ? null : type)}
                              className="text-xs text-primary/70 hover:text-primary transition-colors whitespace-nowrap shrink-0 mt-0.5"
                            >
                              {showHint === type ? 'Скрыть' : 'Подробнее'}
                            </button>
                          </div>

                          {/* Hint panel */}
                          {showHint === type && meta && (
                            <div className="mt-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-xs text-muted-foreground">
                              {meta.hint}
                            </div>
                          )}

                          {/* Upload button below label */}
                          <div className="flex items-center gap-2 mt-3">
                            {type === 'unpacking_map' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-8 px-3 border-primary/40 text-primary hover:bg-primary/10"
                                onClick={() => setShowInterview(true)}
                              >
                                <MessageSquare className="h-3 w-3 mr-1.5" />
                                Пройти интервью
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={hasItems ? 'outline' : 'default'}
                              className={`text-xs h-8 px-4 ${hasItems ? 'border-border' : 'gradient-accent text-white hover:opacity-90 border-0'}`}
                              onClick={() => setUploadFor(type)}
                            >
                              <Upload className="h-3 w-3 mr-1.5" />
                              {hasItems ? 'Добавить файл' : 'Загрузить'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Completion prompt */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground">
          {userName ? `Отлично, ${userName}! Ты справилась 🎉` : 'Отлично! 🎉'}
        </p>
        <p className="text-sm text-muted-foreground">
          Теперь переходи к следующему шагу — создай план прогрева, и AI выстроит стратегию контента под твой запуск.
        </p>
        <a
          href={`/projects/${projectId}/strategy`}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold gradient-accent text-white hover:opacity-90 transition-opacity"
        >
          <Sparkles className="h-4 w-4" />
          Создать план прогрева
        </a>
      </div>

      {/* Upload dialog */}
      {uploadFor && (
        <UploadDialog
          projectId={projectId}
          materialType={uploadFor}
          typeLabel={TYPE_META[uploadFor]?.label || uploadFor}
          open={!!uploadFor}
          onClose={() => setUploadFor(null)}
          onSuccess={handleSuccess}
        />
      )}

      {/* Unpacking interview dialog */}
      <UnpackingInterview
        projectId={projectId}
        open={showInterview}
        onClose={() => setShowInterview(false)}
        onSuccess={handleSuccess}
      />
    </>
  )
}
