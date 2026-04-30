'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import { UnpackingInterview } from '@/components/projects/UnpackingInterview'
import { toast } from 'sonner'
import {
  CheckCircle2, Circle, Loader, AlertCircle, Upload, BookOpen,
  X, File, Loader2, Plus, FileText, Mic, ChevronDown, ChevronUp,
  Info, MessageSquare, Sparkles, Trash2, Copy, Check,
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
  { key: 'АУДИТОРИЯ', title: 'АУДИТОРИЯ', types: ['audience_survey', 'interview_transcript', 'audience_research'] },
  { key: 'СТРАТЕГИЯ', title: 'СТРАТЕГИЯ', types: ['unpacking_map', 'meanings_map', 'competitors', 'tone_of_voice'] },
  { key: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА', title: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА', types: ['cases_reviews'] },
  { key: 'МАРКЕТИНГ', title: 'МАРКЕТИНГ', types: ['marketing_strategy', 'marketing_tactics', 'funnel_description', 'chatbot_description'] },
]

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
  if (status === 'processing') return <Loader className="h-3.5 w-3.5 text-yellow-400 animate-spin shrink-0" />
  if (status === 'error') return <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
  return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

// ── Upload Dialog ─────────────────────────────────────────────────────────────
interface UploadDialogProps {
  projectId: string
  materialType: string
  typeLabel: string
  open: boolean
  onClose: () => void
  onSuccess: (newMaterials: Material[]) => void
}

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'
interface QueueItem {
  id: string; file?: File; text?: string; title: string
  status: UploadStatus; error?: string; materialId?: string
}

function UploadDialog({ projectId, materialType, typeLabel, open, onClose, onSuccess }: UploadDialogProps) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [showText, setShowText] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const shouldRecordRef = useRef(false)
  const restartCountRef = useRef(0)

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

  const startRecognitionSession = () => {
    if (!shouldRecordRef.current) return
    if (restartCountRef.current > 60) { shouldRecordRef.current = false; setIsRecording(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = new SR()
    r.lang = 'ru-RU'; r.continuous = true; r.interimResults = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (ev: any) => {
      restartCountRef.current = 0
      let finalText = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript
      }
      if (finalText) setTextContent(p => p ? p + ' ' + finalText : finalText)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onerror = (e: any) => {
      if (e.error === 'no-speech') return
      shouldRecordRef.current = false; setIsRecording(false)
      if (e.error === 'not-allowed') toast.error('Нет доступа к микрофону. Разреши в настройках браузера.')
    }
    r.onend = () => {
      if (shouldRecordRef.current) {
        restartCountRef.current++
        setTimeout(() => { if (shouldRecordRef.current) startRecognitionSession() }, 200)
      } else {
        setIsRecording(false)
      }
    }
    recognitionRef.current = r
    try { r.start() } catch { shouldRecordRef.current = false; setIsRecording(false) }
  }

  const toggleRecording = () => {
    if (isRecording) {
      shouldRecordRef.current = false
      restartCountRef.current = 0
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { toast.error('Голосовой ввод не поддерживается'); return }
    shouldRecordRef.current = true
    restartCountRef.current = 0
    startRecognitionSession()
    setIsRecording(true)
  }

  const uploadOne = async (item: QueueItem): Promise<{ materialId: string; processingStatus: string }> => {
    const fd = new FormData()
    fd.append('projectId', projectId)
    fd.append('title', item.title || 'Без названия')
    fd.append('materialType', materialType)
    fd.append('isSystemVault', 'false')
    if (item.file) fd.append('file', item.file)
    if (item.text) fd.append('textContent', item.text)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Ошибка ${res.status}`) }
    return res.json()
  }

  const handleUpload = async () => {
    const pending = queue.filter(i => i.status === 'pending')
    if (!pending.length) { toast.error('Нет файлов для загрузки'); return }
    setIsUploading(true)
    const uploaded: Material[] = []
    let err = 0

    for (const item of pending) {
      setQueue(p => p.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i))
      try {
        const { materialId, processingStatus } = await uploadOne(item)
        setQueue(p => p.map(i => i.id === item.id ? { ...i, status: 'done', materialId } : i))
        uploaded.push({ id: materialId, material_type: materialType, title: item.title, processing_status: processingStatus })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка'
        setQueue(p => p.map(i => i.id === item.id ? { ...i, status: 'error', error: msg } : i))
        err++
      }
    }

    setIsUploading(false)
    if (uploaded.length > 0) toast.success(`Загружено: ${uploaded.length}`)
    if (err > 0) toast.error(`Ошибок: ${err}`)

    if (uploaded.length > 0) {
      onSuccess(uploaded)
      // Close if no errors
      if (err === 0) {
        setTimeout(() => { setQueue([]); onClose() }, 400)
      }
    }
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
                  {item.status === 'uploading' && <span className="text-primary text-[10px]">Загружаем...</span>}
                  {item.status === 'done' && <span className="text-green-500 text-[10px]">Готово ✓</span>}
                  {item.error && <span className="text-destructive text-[10px] shrink-0">{item.error}</span>}
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

// ── Import from other project dialog ─────────────────────────────────────────
interface OtherProject {
  id: string
  name: string
  materials: { id: string; material_type: string; title: string; processing_status: string }[]
}

function ImportMaterialsDialog({
  projectId,
  open,
  onClose,
  onSuccess,
}: {
  projectId: string
  open: boolean
  onClose: () => void
  onSuccess: (materials: Material[]) => void
}) {
  const [projects, setProjects] = useState<OtherProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoadingProjects(true)
    fetch(`/api/materials?excludeProject=${projectId}`)
      .then(r => r.json())
      .then(d => setProjects(d.projects || []))
      .catch(() => toast.error('Не удалось загрузить проекты'))
      .finally(() => setLoadingProjects(false))
  }, [open, projectId])

  const selectedProject = projects.find(p => p.id === selectedProjectId)

  const toggleMaterial = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleImport = async () => {
    if (!selectedIds.size) return
    setImporting(true)
    try {
      const res = await fetch('/api/materials/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialIds: [...selectedIds], targetProjectId: projectId }),
      })
      const data = await res.json() as { imported: number; errors: number; materials: Material[] }
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || 'Ошибка')
      toast.success(`Импортировано: ${data.imported}${data.errors ? `, ошибок: ${data.errors}` : ''}`)
      onSuccess(data.materials)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка импорта')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !importing) onClose() }}>
      <DialogContent className="sm:max-w-lg border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импортировать материалы из другого проекта</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <p className="text-xs text-muted-foreground">
            Некоторые материалы (аудитория, тон-оф-войс, конкуренты) часто одинаковые для разных продуктов. Выбери проект и импортируй нужные файлы.
          </p>

          {loadingProjects ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Нет других проектов с загруженными материалами
            </div>
          ) : (
            <>
              <Select value={selectedProjectId} onValueChange={id => { setSelectedProjectId(id ?? ''); setSelectedIds(new Set()) }}>
                <SelectTrigger className="border-border">
                  <SelectValue placeholder="Выбери проект" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedProject && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  <p className="text-xs text-muted-foreground">Выбери материалы для импорта:</p>
                  {selectedProject.materials.map(m => {
                    const isSelected = selectedIds.has(m.id)
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleMaterial(m.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                          isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
                        }`}
                      >
                        <div className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center ${
                          isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                        }`}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{m.title}</p>
                          <p className="text-xs text-muted-foreground">{TYPE_META[m.material_type]?.label || m.material_type}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={importing}>Отмена</Button>
            <Button
              className="flex-1 gradient-accent text-white hover:opacity-90"
              onClick={handleImport}
              disabled={importing || selectedIds.size === 0}
            >
              {importing
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Импортируем...</>
                : <><Copy className="mr-2 h-4 w-4" />Импортировать ({selectedIds.size})</>
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export function KnowledgePageClient({ projectId, completenessScore, initialMaterials, userName }: Props) {
  const [uploadFor, setUploadFor] = useState<string | null>(null)
  const [showInterview, setShowInterview] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [materials, setMaterials] = useState(initialMaterials)
  // Recalculate score dynamically as materials change (same weights as upload API)
  const score = useMemo(() => {
    const types = new Set(materials.map(m => m.material_type))
    let s = 0
    if (types.has('tone_of_voice'))       s += 25
    if (types.has('unpacking_map'))       s += 15
    if (types.has('cases_reviews'))       s += 15
    if (types.has('marketing_strategy'))  s += 15
    if (types.has('funnel_description'))  s += 10
    if (types.has('audience_research'))   s += 10
    if (types.has('competitors'))         s += 5
    if (types.has('product_description')) s += 5
    return Math.min(100, Math.max(s, completenessScore))
  }, [materials, completenessScore])
  const [showHint, setShowHint] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const materialsByType = materials.reduce<Record<string, Material[]>>((acc, m) => {
    if (!acc[m.material_type]) acc[m.material_type] = []
    acc[m.material_type]!.push(m)
    return acc
  }, {})

  // Called after upload — add new materials to state instantly (no page refresh)
  const handleUploaded = (newMaterials: Material[]) => {
    setMaterials(prev => [...newMaterials, ...prev])
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    // Optimistic remove
    setMaterials(prev => prev.filter(m => m.id !== id))
    try {
      const res = await fetch(`/api/materials?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка удаления')
      toast.success('Материал удалён')
    } catch {
      // Rollback on error — re-fetch would be ideal but we don't have the item anymore
      toast.error('Не удалось удалить материал')
      // Soft refresh to restore correct state
      window.location.reload()
    } finally {
      setDeletingId(null)
    }
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
          <ProgressIndicator score={score} loadedTypes={materials.map(m => m.material_type)} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-8 border-border gap-1.5"
          onClick={() => setShowImport(true)}
        >
          <Copy className="h-3 w-3" />
          Использовать материалы из другого проекта
        </Button>
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

                return (
                  <div key={type}>
                    <div className={`p-4 rounded-xl border transition-colors ${
                      hasItems ? 'border-green-500/20 bg-green-500/5' : 'border-border bg-secondary/20'
                    }`}>
                      {/* Label row */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {hasItems
                            ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                            : <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          }
                          <p className="text-sm font-semibold text-foreground leading-snug">
                            {meta?.label || type}
                          </p>
                        </div>
                        <button
                          onClick={() => setShowHint(showHint === type ? null : type)}
                          className="text-xs text-primary/70 hover:text-primary transition-colors whitespace-nowrap shrink-0"
                        >
                          {showHint === type ? 'Скрыть' : 'Подробнее'}
                        </button>
                      </div>

                      {/* Hint panel */}
                      {showHint === type && meta && (
                        <div className="mb-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-xs text-muted-foreground">
                          {meta.hint}
                        </div>
                      )}

                      {/* Uploaded files list */}
                      {items.length > 0 && (
                        <div className="mb-3 space-y-1.5">
                          {items.map(item => (
                            <div key={item.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background/60 border border-border/60 text-xs min-w-0">
                              <StatusIcon status={item.processing_status} />
                              <span className="flex-1 min-w-0 truncate text-foreground/80">{item.title}</span>
                              <button
                                onClick={() => handleDelete(item.id)}
                                disabled={deletingId === item.id}
                                className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                                title="Удалить"
                              >
                                {deletingId === item.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Trash2 className="h-3 w-3" />
                                }
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Upload button */}
                      <div className="flex items-center gap-2">
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
                          {hasItems ? 'Добавить ещё' : 'Загрузить'}
                        </Button>
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
          onSuccess={(newMaterials) => {
            handleUploaded(newMaterials)
            setUploadFor(null)
          }}
        />
      )}

      {/* Unpacking interview dialog */}
      <UnpackingInterview
        projectId={projectId}
        open={showInterview}
        onClose={() => setShowInterview(false)}
        onSuccess={() => window.location.reload()}
      />

      <ImportMaterialsDialog
        projectId={projectId}
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={(newMaterials) => {
          handleUploaded(newMaterials)
          setShowImport(false)
        }}
      />
    </>
  )
}
