'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Upload, FileText, Mic, Plus, X, Loader2 } from 'lucide-react'
import type { MaterialType } from '@/types'

const MATERIAL_TYPES: Array<{ value: MaterialType; label: string; category: string }> = [
  { value: 'audience_survey', label: 'Результаты опроса аудитории', category: 'АУДИТОРИЯ' },
  { value: 'interview_transcript', label: 'Транскрипт созвона', category: 'АУДИТОРИЯ' },
  { value: 'audience_research', label: 'Исследование аудитории', category: 'АУДИТОРИЯ' },
  { value: 'unpacking_map', label: 'Распаковка личности', category: 'СТРАТЕГИЯ' },
  { value: 'meanings_map', label: 'Карта смыслов блога', category: 'СТРАТЕГИЯ' },
  { value: 'competitors', label: 'Список конкурентов', category: 'СТРАТЕГИЯ' },
  { value: 'tone_of_voice', label: 'Tone of Voice', category: 'СТРАТЕГИЯ' },
  { value: 'cases_reviews', label: 'Кейсы и отзывы', category: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА' },
  { value: 'marketing_strategy', label: 'Маркетинговая стратегия', category: 'МАРКЕТИНГ' },
  { value: 'marketing_tactics', label: 'Маркетинговая тактика', category: 'МАРКЕТИНГ' },
  { value: 'funnel_description', label: 'Описание воронок', category: 'МАРКЕТИНГ' },
  { value: 'chatbot_description', label: 'Описание чат-ботов', category: 'МАРКЕТИНГ' },
  { value: 'product_description', label: 'Описание продукта', category: 'МАРКЕТИНГ' },
  { value: 'content_reference', label: 'Референсы контента', category: 'МАРКЕТИНГ' },
  { value: 'other', label: 'Другое', category: 'ПРОЧЕЕ' },
]

interface KnowledgeUploaderProps {
  projectId: string
  onUploadComplete?: () => void
  isSystemVault?: boolean
}

export function KnowledgeUploader({ projectId, onUploadComplete, isSystemVault = false }: KnowledgeUploaderProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [materialType, setMaterialType] = useState<MaterialType>('tone_of_voice')
  const [contentType, setContentType] = useState<string>('methodology')
  const [textContent, setTextContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }, [])

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Голосовой ввод не поддерживается в этом браузере')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return
    const recognition = new SpeechRecognitionAPI()
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript)
        .join('')
      setTextContent((prev) => prev + ' ' + transcript)
    }
    recognition.onerror = () => setIsRecording(false)
    recognition.onend = () => setIsRecording(false)
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Введите название материала')
      return
    }
    if (!textContent.trim() && !file) {
      toast.error('Добавьте текст или загрузите файл')
      return
    }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('projectId', projectId)
      formData.append('title', title)
      formData.append('materialType', isSystemVault ? contentType : materialType)
      formData.append('isSystemVault', String(isSystemVault))
      if (textContent) formData.append('textContent', textContent)
      if (file) formData.append('file', file)

      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(await res.text())

      toast.success('Материал загружен и обрабатывается')
      setOpen(false)
      setTitle('')
      setTextContent('')
      setFile(null)
      onUploadComplete?.()
      router.refresh()
    } catch (error) {
      toast.error('Ошибка загрузки материала')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white gradient-accent hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" />
        Загрузить материал
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg border-border bg-card">
        <DialogHeader>
          <DialogTitle>
            {isSystemVault ? 'Добавить в базу знаний системы' : 'Загрузить материал проекта'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Тип материала</Label>
            {isSystemVault ? (
              <Select value={contentType} onValueChange={(v) => v && setContentType(v)}>
                <SelectTrigger className="bg-input border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="methodology">Методология запуска</SelectItem>
                  <SelectItem value="framework">Фреймворк прогрева</SelectItem>
                  <SelectItem value="tov_system">Система TOV</SelectItem>
                  <SelectItem value="example">Пример успешного запуска</SelectItem>
                  <SelectItem value="template">Шаблон контента</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Select value={materialType} onValueChange={(v) => v && setMaterialType(v as MaterialType)}>
                <SelectTrigger className="bg-input border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {MATERIAL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input
              placeholder="Напр: TOV документ Анны"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-input border-border"
            />
          </div>

          {/* File drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors ${
              isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-secondary/50'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.doc,.txt,.md,.xlsx,.csv,.mp3,.m4a,.wav,.mp4,.mov,.jpg,.jpeg,.png"
              onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
            />
            {file ? (
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-sm text-foreground">{file.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null) }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm text-foreground">Перетащите файл или нажмите</p>
                  <p className="text-xs text-muted-foreground">PDF, DOCX, TXT, MP3, MP4, XLSX, PNG</p>
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Или вставьте текст</Label>
              <button
                onClick={toggleRecording}
                className={`flex items-center gap-1 text-xs transition-colors ${isRecording ? 'text-red-400' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Mic className={`h-3.5 w-3.5 ${isRecording ? 'animate-pulse' : ''}`} />
                {isRecording ? 'Остановить' : 'Надиктовать'}
              </button>
            </div>
            <Textarea
              placeholder="Вставьте текст материала или надиктуйте голосом..."
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              rows={5}
              className="bg-input border-border resize-none text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-border"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              className="flex-1 gradient-accent text-white hover:opacity-90"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Загрузить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
