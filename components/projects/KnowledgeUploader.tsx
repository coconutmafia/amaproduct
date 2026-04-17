'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Upload, FileText, Mic, Plus, X, Loader2,
  CheckCircle2, AlertCircle, File, ChevronDown, ChevronUp,
} from 'lucide-react'
import type { MaterialType } from '@/types'

const MATERIAL_TYPES: Array<{ value: MaterialType; label: string; category: string }> = [
  { value: 'audience_survey',     label: 'Результаты опроса аудитории',  category: 'АУДИТОРИЯ' },
  { value: 'interview_transcript',label: 'Транскрипт созвона',           category: 'АУДИТОРИЯ' },
  { value: 'audience_research',   label: 'Исследование аудитории',       category: 'АУДИТОРИЯ' },
  { value: 'unpacking_map',       label: 'Распаковка личности',          category: 'СТРАТЕГИЯ' },
  { value: 'meanings_map',        label: 'Карта смыслов блога',          category: 'СТРАТЕГИЯ' },
  { value: 'competitors',         label: 'Список конкурентов',           category: 'СТРАТЕГИЯ' },
  { value: 'tone_of_voice',       label: 'Tone of Voice',                category: 'СТРАТЕГИЯ' },
  { value: 'cases_reviews',       label: 'Кейсы и отзывы',              category: 'СОЦДОКАЗАТЕЛЬСТВА' },
  { value: 'marketing_strategy',  label: 'Маркетинговая стратегия',      category: 'МАРКЕТИНГ' },
  { value: 'marketing_tactics',   label: 'Маркетинговая тактика',        category: 'МАРКЕТИНГ' },
  { value: 'funnel_description',  label: 'Описание воронок',             category: 'МАРКЕТИНГ' },
  { value: 'chatbot_description', label: 'Описание чат-ботов',           category: 'МАРКЕТИНГ' },
  { value: 'product_description', label: 'Описание продукта',            category: 'МАРКЕТИНГ' },
  { value: 'content_reference',   label: 'Референсы контента',           category: 'МАРКЕТИНГ' },
  { value: 'other',               label: 'Другое',                       category: 'ПРОЧЕЕ' },
  { value: 'additional',          label: 'Дополнительные материалы',      category: 'ПРОЧЕЕ' },
]

const SYSTEM_TYPES = [
  { value: 'methodology',  label: 'Методология запуска' },
  { value: 'framework',    label: 'Фреймворк прогрева' },
  { value: 'tov_system',   label: 'Система TOV' },
  { value: 'example',      label: 'Пример успешного запуска' },
  { value: 'template',     label: 'Шаблон контента' },
  { value: 'additional',   label: 'Дополнительные материалы' },
]

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'

interface QueueItem {
  id: string
  file?: File
  text?: string
  title: string
  status: UploadStatus
  error?: string
}

interface KnowledgeUploaderProps {
  projectId: string
  onUploadComplete?: () => void
  isSystemVault?: boolean
}

export function KnowledgeUploader({ projectId, onUploadComplete, isSystemVault = false }: KnowledgeUploaderProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  const [open, setOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  // Тип для всех файлов в этой сессии загрузки
  const [globalType, setGlobalType] = useState<string>(isSystemVault ? 'methodology' : 'tone_of_voice')

  // Очередь файлов
  const [queue, setQueue] = useState<QueueItem[]>([])

  // Текстовый блок
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [showTextBlock, setShowTextBlock] = useState(false)

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const newItems: QueueItem[] = arr.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      title: f.name.replace(/\.[^.]+$/, ''), // имя без расширения
      status: 'pending',
    }))
    setQueue(prev => [...prev, ...newItems])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const removeFromQueue = (id: string) => setQueue(prev => prev.filter(i => i.id !== id))

  const updateTitle = (id: string, title: string) =>
    setQueue(prev => prev.map(i => i.id === id ? { ...i, title } : i))

  const addTextItem = () => {
    if (!textContent.trim()) { toast.error('Вставьте текст'); return }
    if (!textTitle.trim()) { toast.error('Введите название'); return }
    setQueue(prev => [...prev, {
      id: `text-${Date.now()}`,
      text: textContent.trim(),
      title: textTitle.trim(),
      status: 'pending',
    }])
    setTextTitle('')
    setTextContent('')
    setShowTextBlock(false)
    toast.success('Текст добавлен в очередь')
  }

  // Загрузка одного элемента
  const uploadOne = async (item: QueueItem): Promise<boolean> => {
    const formData = new FormData()
    formData.append('projectId', projectId)
    formData.append('title', item.title || 'Без названия')
    formData.append('materialType', globalType)
    formData.append('isSystemVault', String(isSystemVault))

    if (item.file) formData.append('file', item.file)
    if (item.text) formData.append('textContent', item.text)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Ошибка ${res.status}`)
    }
    return true
  }

  // Загрузить все
  const handleUploadAll = async () => {
    const pending = queue.filter(i => i.status === 'pending')
    if (pending.length === 0) { toast.error('Нет файлов для загрузки'); return }

    setIsUploading(true)
    let successCount = 0
    let errorCount = 0

    for (const item of pending) {
      // Отмечаем как загружаемый
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i))

      try {
        await uploadOne(item)
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done' } : i))
        successCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка'
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', error: msg } : i))
        errorCount++
      }
    }

    setIsUploading(false)

    if (successCount > 0) toast.success(`Загружено: ${successCount} материалов`)
    if (errorCount > 0) toast.error(`Ошибок: ${errorCount}`)

    // Если все успешно — закрываем
    if (errorCount === 0) {
      setTimeout(() => {
        setOpen(false)
        setQueue([])
        onUploadComplete?.()
        router.refresh()
      }, 800)
    } else {
      onUploadComplete?.()
      router.refresh()
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechAPI) { toast.error('Голосовой ввод не поддерживается'); return }
    const r = new SpeechAPI()
    r.lang = 'ru-RU'; r.continuous = true; r.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = Array.from(e.results as any[]).map((x: any) => x[0].transcript).join('')
      setTextContent(prev => prev + ' ' + t)
    }
    r.onerror = () => setIsRecording(false)
    r.onend = () => setIsRecording(false)
    recognitionRef.current = r
    r.start()
    setIsRecording(true)
  }

  const statusIcon = (status: UploadStatus) => {
    if (status === 'uploading') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
    if (status === 'done')     return <CheckCircle2 className="h-4 w-4 text-green-500" />
    if (status === 'error')    return <AlertCircle className="h-4 w-4 text-destructive" />
    return <File className="h-4 w-4 text-muted-foreground" />
  }

  const pendingCount = queue.filter(i => i.status === 'pending').length
  const doneCount    = queue.filter(i => i.status === 'done').length
  const errorCount   = queue.filter(i => i.status === 'error').length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isUploading) { setOpen(v); if (!v) setQueue([]) } }}>
      <DialogTrigger className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white gradient-accent hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" />
        Загрузить материалы
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isSystemVault ? 'База знаний системы' : 'Материалы проекта'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Тип материала — общий для всей загрузки */}
          <div className="space-y-1.5">
            <Label>Тип материала <span className="text-muted-foreground text-xs">(для всех файлов)</span></Label>
            <Select value={globalType} onValueChange={(v) => v && setGlobalType(v)}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {isSystemVault
                  ? SYSTEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)
                  : MATERIAL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)
                }
              </SelectContent>
            </Select>
          </div>

          {/* Drag & Drop зона — множественные файлы */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all ${
              isDragging
                ? 'border-primary bg-primary/10 scale-[1.01]'
                : 'border-border hover:border-primary/50 hover:bg-secondary/30'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.csv,.docx,.doc"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
            <Upload className={`h-8 w-8 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Перетащите файлы или нажмите для выбора
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Можно выбрать несколько файлов сразу · TXT, MD, CSV, DOCX
              </p>
              <p className="text-xs text-muted-foreground">
                Для PDF и Google Docs — скопируй текст и используй кнопку ниже
              </p>
            </div>
          </div>

          {/* Список файлов в очереди */}
          {queue.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">
                  Очередь загрузки
                  <span className="ml-2 text-muted-foreground font-normal">
                    {pendingCount > 0 && `${pendingCount} ожидают`}
                    {doneCount > 0 && ` · ${doneCount} готово`}
                    {errorCount > 0 && ` · ${errorCount} ошибок`}
                  </span>
                </Label>
                {!isUploading && (
                  <button
                    onClick={() => setQueue([])}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Очистить все
                  </button>
                )}
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {queue.map(item => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                      item.status === 'done'     ? 'border-green-200 bg-green-50 dark:border-green-500/20 dark:bg-green-500/5' :
                      item.status === 'error'    ? 'border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/5' :
                      item.status === 'uploading'? 'border-primary/30 bg-primary/5' :
                      'border-border bg-secondary/20'
                    }`}
                  >
                    {statusIcon(item.status)}
                    <div className="flex-1 min-w-0">
                      {item.status === 'pending' ? (
                        <Input
                          value={item.title}
                          onChange={(e) => updateTitle(item.id, e.target.value)}
                          className="h-7 text-xs bg-transparent border-none px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          placeholder="Название материала"
                        />
                      ) : (
                        <p className="text-xs font-medium truncate">{item.title}</p>
                      )}
                      {item.file && (
                        <p className="text-[10px] text-muted-foreground">{item.file.name}</p>
                      )}
                      {item.text && (
                        <p className="text-[10px] text-muted-foreground">
                          Текст · {item.text.slice(0, 40)}...
                        </p>
                      )}
                      {item.error && (
                        <p className="text-[10px] text-destructive">{item.error}</p>
                      )}
                    </div>
                    {item.status !== 'uploading' && item.status !== 'done' && (
                      <button
                        onClick={() => removeFromQueue(item.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {item.status === 'done' && (
                      <Badge className="text-[10px] bg-green-500/15 text-green-600 border-green-200 dark:text-green-400 dark:border-green-500/25 shrink-0">
                        Готово
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Кнопка добавить текст */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setShowTextBlock(!showTextBlock)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/50 transition-colors"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                Добавить текст вручную (PDF, Google Docs)
              </span>
              {showTextBlock ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showTextBlock && (
              <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                <Input
                  placeholder="Название этого материала *"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  className="bg-input border-border text-sm"
                />
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Вставьте текст</Label>
                    <button
                      onClick={toggleRecording}
                      className={`flex items-center gap-1 text-xs transition-colors ${
                        isRecording ? 'text-red-400' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Mic className={`h-3 w-3 ${isRecording ? 'animate-pulse' : ''}`} />
                      {isRecording ? 'Стоп' : 'Голос'}
                    </button>
                  </div>
                  <Textarea
                    placeholder="Скопируй и вставь текст из PDF, Google Docs, Word..."
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    rows={4}
                    className="bg-input border-border resize-none text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addTextItem}
                  className="w-full border-dashed border-primary/50 text-primary hover:bg-primary/5"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Добавить в очередь
                </Button>
              </div>
            )}
          </div>

          {/* Кнопки */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1 border-border"
              onClick={() => { setOpen(false); setQueue([]) }}
              disabled={isUploading}
            >
              Отмена
            </Button>
            <Button
              className="flex-1 gradient-accent text-white hover:opacity-90"
              onClick={handleUploadAll}
              disabled={isUploading || queue.filter(i => i.status === 'pending').length === 0}
            >
              {isUploading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загружаем...</>
              ) : (
                <><Upload className="mr-2 h-4 w-4" />
                  Загрузить {pendingCount > 0 ? `(${pendingCount})` : 'всё'}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
