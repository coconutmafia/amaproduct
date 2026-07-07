'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import { UnpackingInterview } from '@/components/projects/UnpackingInterview'
import { ToneFromContentDialog } from '@/components/projects/ToneFromContentDialog'
import { InstagramAccountDialog } from '@/components/projects/InstagramAccountDialog'
import { BlogAuditDialog } from '@/components/projects/BlogAuditDialog'
import { CompetitorAnalysis } from '@/components/projects/CompetitorAnalysis'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { toast } from 'sonner'
import Link from 'next/link'
import { friendlyError } from '@/lib/friendlyError'
import { computeCompleteness } from '@/lib/completeness'
import { audienceResearchToAoa, meaningsMapToAoa } from '@/lib/researchTables'
import { downloadXlsx } from '@/lib/utils/xlsxTable'
import {
  CheckCircle2, Circle, Loader, AlertCircle, Upload, BookOpen,
  X, File, Loader2, Plus, FileText, ChevronDown, ChevronUp,
  Info, MessageSquare, Sparkles, Trash2, Copy, Check, Pencil, AudioLines,
  Download,
} from 'lucide-react'

interface Material {
  id: string
  material_type: string
  title: string
  processing_status: string
}

// Reload the page but keep the scroll position — long AI operations end
// with a reload to show the new material, and a plain reload jumps to the
// top, forcing the user to scroll back down to the section they were in.
function reloadKeepScroll() {
  try { sessionStorage.setItem('ama_scroll_restore', String(window.scrollY)) } catch { /* ignore */ }
  window.location.reload()
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
  my_instagram: {
    label: 'Мой Instagram',
    hint: 'Подключи 1 свой публичный аккаунт — AI заберёт последние 25 постов и сделает разбор твоего голоса и позиционирования.',
    category: 'INSTAGRAM',
  },
  competitors: {
    label: 'Конкуренты в Instagram',
    hint: 'До 5 публичных Instagram-аккаунтов конкурентов. AI разберёт что у них работает: темы, hooks, формулировки — чтобы научиться у лучших.',
    category: 'INSTAGRAM',
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
  blog_lines: {
    label: 'Линии блога',
    hint: 'Нарративные линии твоего блога — профессиональная и личные. Создают сериальность и нативный прогрев.',
    category: 'ЛИЧНОСТЬ',
  },
}

const CATEGORIES = [
  { key: 'АУДИТОРИЯ', title: 'АУДИТОРИЯ', types: ['audience_survey', 'interview_transcript', 'audience_research'] },
  { key: 'INSTAGRAM', title: 'INSTAGRAM', types: ['my_instagram', 'competitors'] },
  { key: 'СТРАТЕГИЯ', title: 'СТРАТЕГИЯ', types: ['unpacking_map', 'meanings_map', 'tone_of_voice'] },
  { key: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА', title: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА', types: ['cases_reviews'] },
  { key: 'МАРКЕТИНГ', title: 'МАРКЕТИНГ', types: ['marketing_strategy', 'marketing_tactics', 'funnel_description', 'chatbot_description'] },
  { key: 'ЛИЧНОСТЬ', title: 'ЛИЧНОСТЬ', types: ['blog_lines'] },
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
    let pending = queue.filter(i => i.status === 'pending')
    // Auto-include text typed/dictated but not yet added to the queue — the
    // user shouldn't need a separate "Добавить в очередь" click first.
    if (textContent.trim()) {
      if (!textTitle.trim()) { toast.error('Введи название для текста'); return }
      const textItem = { id: `t-${Date.now()}`, text: textContent.trim(), title: textTitle.trim(), status: 'pending' as const }
      setQueue(prev => [...prev, textItem])
      setTextTitle(''); setTextContent(''); setShowText(false)
      pending = [...pending, textItem]
    }
    if (!pending.length) { toast.error('Добавь файл или текст для загрузки'); return }
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

          {/* ── Audio transcription CTA — only for interview transcripts ── */}
          {materialType === 'interview_transcript' && (
            <Link
              href={`/projects/${projectId}/research`}
              onClick={onClose}
              className="block"
            >
              <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-4 hover:border-primary/50 hover:bg-primary/10 transition-all cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-accent">
                    <AudioLines className="h-4.5 w-4.5 text-white" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-foreground">Есть аудиозапись созвона?</p>
                    <p className="text-xs text-muted-foreground">
                      Загрузи аудио — AI расшифрует, составит таблицу интервью и карту смыслов автоматически
                    </p>
                    <p className="text-xs font-medium text-primary mt-1">Открыть AI-транскрибацию →</p>
                  </div>
                </div>
              </div>
            </Link>
          )}

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
              <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Добавить текст</span>
              {showText ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showText && (
              <div className="px-4 pb-4 pt-3 space-y-2 border-t border-border">
                <Input placeholder="Название *" value={textTitle} onChange={(e) => setTextTitle(e.target.value)} className="text-sm" />
                <Label className="text-xs text-muted-foreground">Текст — вставь или надиктуй голосом</Label>
                <VoiceTextarea placeholder="Вставь текст... или надиктуй голосом" value={textContent} onChange={setTextContent} rows={3} className="text-sm resize-none" />
                <p className="text-[11px] text-muted-foreground">
                  Заполни название и текст — и жми «Загрузить» внизу. Кнопка ниже нужна, только если хочешь добавить сразу несколько текстов.
                </p>
                <Button size="sm" variant="outline" onClick={addText} className="w-full border-dashed">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Добавить ещё один текст
                </Button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setQueue([]); onClose() }} disabled={isUploading}>Отмена</Button>
            <Button className="flex-1 gradient-accent text-white hover:opacity-90" onClick={handleUpload} disabled={isUploading || (pending === 0 && !textContent.trim())}>
              {isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загружаем...</> : <><Upload className="mr-2 h-4 w-4" />Загрузить{pending > 0 ? ` (${pending})` : ''}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Import from other project dialog ─────────────────────────────────────────

// Evergreen = done once, reused across products. Project-specific = changes per launch.
const EVERGREEN_TYPES = new Set([
  'audience_survey', 'interview_transcript', 'audience_research',
  'interview_transcription', 'meanings_map', 'unpacking_map',
  'tone_of_voice', 'tov', 'blog_lines', 'competitors', 'marketing_strategy',
])

interface GlobalMaterial {
  id: string
  project_id: string
  project_name: string
  material_type: string
  title: string
  processing_status: string
}

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
  const [tab, setTab] = useState<'global' | 'project'>('global')
  const [loading, setLoading] = useState(false)
  const [globalMaterials, setGlobalMaterials] = useState<GlobalMaterial[]>([])
  const [projects, setProjects] = useState<OtherProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSelectedIds(new Set())
    // Load both global and project lists in parallel
    Promise.all([
      fetch(`/api/materials?excludeProject=${projectId}&mode=global`).then(r => r.json()),
      fetch(`/api/materials?excludeProject=${projectId}`).then(r => r.json()),
    ])
      .then(([gData, pData]) => {
        setGlobalMaterials((gData as { global: GlobalMaterial[] }).global || [])
        setProjects((pData as { projects: OtherProject[] }).projects || [])
      })
      .catch(() => toast.error('Не удалось загрузить материалы'))
      .finally(() => setLoading(false))
  }, [open, projectId])

  const selectedProject = projects.find(p => p.id === selectedProjectId)

  const toggle = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const selectAllGlobal = () => setSelectedIds(new Set(globalMaterials.map(m => m.id)))

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
      toast.error(friendlyError(e, 'Ошибка импорта'))
    } finally {
      setImporting(false)
    }
  }

  // Group global materials by type category
  const globalByCategory = globalMaterials.reduce<Record<string, GlobalMaterial[]>>((acc, m) => {
    const cat = TYPE_META[m.material_type]?.category ?? 'ПРОЧЕЕ'
    if (!acc[cat]) acc[cat] = []
    acc[cat]!.push(m)
    return acc
  }, {})

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !importing) onClose() }}>
      <DialogContent className="sm:max-w-lg border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импортировать материалы</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex rounded-xl border border-border overflow-hidden text-sm font-medium">
          <button
            onClick={() => { setTab('global'); setSelectedIds(new Set()) }}
            className={`flex-1 py-2 transition-colors ${tab === 'global' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
          >
            ⭐ Общая база
          </button>
          <button
            onClick={() => { setTab('project'); setSelectedIds(new Set()) }}
            className={`flex-1 py-2 transition-colors ${tab === 'project' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
          >
            📁 Из проекта
          </button>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tab === 'global' ? (
            /* ── Global base tab ── */
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Постоянные материалы</span> — делаются один раз и подходят для всех продуктов: распаковка, TOV, исследование аудитории, карта смыслов.
                </p>
                {globalMaterials.length > 0 && (
                  <button onClick={selectAllGlobal} className="text-xs text-primary whitespace-nowrap hover:underline shrink-0">
                    Выбрать все
                  </button>
                )}
              </div>

              {globalMaterials.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  В других проектах нет постоянных материалов.<br />
                  <span className="text-xs">TOV, распаковка, исследование аудитории появятся здесь автоматически.</span>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {Object.entries(globalByCategory).map(([cat, items]) => (
                    <div key={cat}>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">{cat}</p>
                      <div className="space-y-1">
                        {items.map(m => {
                          const isSel = selectedIds.has(m.id)
                          return (
                            <button key={m.id} onClick={() => toggle(m.id)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                                isSel ? 'border-primary bg-primary/8' : 'border-border bg-card hover:border-primary/40'
                              }`}>
                              <div className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center ${
                                isSel ? 'border-primary bg-primary' : 'border-muted-foreground/50'
                              }`}>
                                {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{m.title}</p>
                                <p className="text-xs text-muted-foreground">{TYPE_META[m.material_type]?.label || m.material_type}</p>
                              </div>
                              <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:block truncate max-w-[80px]">{m.project_name}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* ── From project tab ── */
            <>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Проектные материалы</span> — воронки, продукты, кейсы. Меняются под каждый запуск.
              </p>
              {projects.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">Нет других проектов с материалами</div>
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
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {selectedProject.materials.map(m => {
                        const isSel = selectedIds.has(m.id)
                        const isEvergreen = EVERGREEN_TYPES.has(m.material_type)
                        return (
                          <button key={m.id} onClick={() => toggle(m.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                              isSel ? 'border-primary bg-primary/8' : 'border-border bg-card hover:border-primary/40'
                            }`}>
                            <div className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center ${
                              isSel ? 'border-primary bg-primary' : 'border-muted-foreground/50'
                            }`}>
                              {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{m.title}</p>
                              <p className="text-xs text-muted-foreground">{TYPE_META[m.material_type]?.label || m.material_type}</p>
                            </div>
                            {isEvergreen && <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">постоянный</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={importing}>Отмена</Button>
            <Button
              className="flex-1 bg-[#3A8A48] hover:bg-[#2E6E3A] text-white"
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

// ── Blog Lines Dialog ─────────────────────────────────────────────────────────
interface BlogLinesDialogProps {
  projectId: string
  open: boolean
  onClose: () => void
  onSuccess: (newMaterials: Material[]) => void
  initialContent?: string
  editingId?: string
}

interface NarrativeLine {
  name: string
  past: string
  present: string
  future: string
}

function parseBlogLinesContent(content: string) {
  const result = {
    profPast: '', profPresent: '', profFuture: '',
    personal1: { name: '', past: '', present: '', future: '' } as NarrativeLine,
    personal2: { name: '', past: '', present: '', future: '' } as NarrativeLine,
    showPersonal2: false,
  }

  // Split into sections by blank lines or section headers
  const lines = content.split('\n')
  let currentSection: 'prof' | 'p1' | 'p2' | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (/^ПРОФЕССИОНАЛЬНАЯ ЛИНИЯ/i.test(line)) {
      currentSection = 'prof'
      continue
    }
    if (/^ЛИЧНАЯ ЛИНИЯ\s*1\s*[—:\-]/i.test(line)) {
      currentSection = 'p1'
      const name = line.replace(/^ЛИЧНАЯ ЛИНИЯ\s*1\s*[—:\-]\s*/i, '').trim()
      result.personal1.name = name && name.toLowerCase() !== 'без названия' ? name : ''
      continue
    }
    if (/^ЛИЧНАЯ ЛИНИЯ\s*2\s*[—:\-]/i.test(line)) {
      currentSection = 'p2'
      result.showPersonal2 = true
      const name = line.replace(/^ЛИЧНАЯ ЛИНИЯ\s*2\s*[—:\-]\s*/i, '').trim()
      result.personal2.name = name && name.toLowerCase() !== 'без названия' ? name : ''
      continue
    }

    const pastMatch = line.match(/^Прошлое:\s*(.*)/i)
    const presentMatch = line.match(/^Настоящее:\s*(.*)/i)
    const futureMatch = line.match(/^Будущее:\s*(.*)/i)

    if (pastMatch) {
      const val = pastMatch[1]?.trim() === '—' ? '' : pastMatch[1]?.trim() ?? ''
      if (currentSection === 'prof') result.profPast = val
      else if (currentSection === 'p1') result.personal1.past = val
      else if (currentSection === 'p2') result.personal2.past = val
    } else if (presentMatch) {
      const val = presentMatch[1]?.trim() === '—' ? '' : presentMatch[1]?.trim() ?? ''
      if (currentSection === 'prof') result.profPresent = val
      else if (currentSection === 'p1') result.personal1.present = val
      else if (currentSection === 'p2') result.personal2.present = val
    } else if (futureMatch) {
      const val = futureMatch[1]?.trim() === '—' ? '' : futureMatch[1]?.trim() ?? ''
      if (currentSection === 'prof') result.profFuture = val
      else if (currentSection === 'p1') result.personal1.future = val
      else if (currentSection === 'p2') result.personal2.future = val
    }
  }

  return result
}

function BlogLinesDialog({ projectId, open, onClose, onSuccess, initialContent, editingId }: BlogLinesDialogProps) {
  const [profPast, setProfPast] = useState('')
  const [profPresent, setProfPresent] = useState('')
  const [profFuture, setProfFuture] = useState('')

  const [personal1, setPersonal1] = useState<NarrativeLine>({ name: '', past: '', present: '', future: '' })
  const [personal2, setPersonal2] = useState<NarrativeLine>({ name: '', past: '', present: '', future: '' })
  const [showPersonal2, setShowPersonal2] = useState(false)
  const [saving, setSaving] = useState(false)

  // Pre-fill fields when initialContent is provided
  useEffect(() => {
    if (open && initialContent) {
      const parsed = parseBlogLinesContent(initialContent)
      setProfPast(parsed.profPast)
      setProfPresent(parsed.profPresent)
      setProfFuture(parsed.profFuture)
      setPersonal1(parsed.personal1)
      setPersonal2(parsed.personal2)
      setShowPersonal2(parsed.showPersonal2)
    } else if (open && !initialContent) {
      // Reset when opening fresh
      setProfPast('')
      setProfPresent('')
      setProfFuture('')
      setPersonal1({ name: '', past: '', present: '', future: '' })
      setPersonal2({ name: '', past: '', present: '', future: '' })
      setShowPersonal2(false)
    }
  }, [open, initialContent])

  const handleSave = async () => {
    const lines: string[] = []

    lines.push('ПРОФЕССИОНАЛЬНАЯ ЛИНИЯ')
    lines.push(`Прошлое: ${profPast.trim() || '—'}`)
    lines.push(`Настоящее: ${profPresent.trim() || '—'}`)
    lines.push(`Будущее: ${profFuture.trim() || '—'}`)

    if (personal1.name.trim() || personal1.past.trim() || personal1.present.trim() || personal1.future.trim()) {
      lines.push('')
      lines.push(`ЛИЧНАЯ ЛИНИЯ 1 — ${personal1.name.trim() || 'Без названия'}`)
      lines.push(`Прошлое: ${personal1.past.trim() || '—'}`)
      lines.push(`Настоящее: ${personal1.present.trim() || '—'}`)
      lines.push(`Будущее: ${personal1.future.trim() || '—'}`)
    }

    if (showPersonal2 && (personal2.name.trim() || personal2.past.trim() || personal2.present.trim() || personal2.future.trim())) {
      lines.push('')
      lines.push(`ЛИЧНАЯ ЛИНИЯ 2 — ${personal2.name.trim() || 'Без названия'}`)
      lines.push(`Прошлое: ${personal2.past.trim() || '—'}`)
      lines.push(`Настоящее: ${personal2.present.trim() || '—'}`)
      lines.push(`Будущее: ${personal2.future.trim() || '—'}`)
    }

    const textContent = lines.join('\n')

    setSaving(true)
    try {
      if (editingId) {
        // PATCH — update existing material
        const res = await fetch(`/api/materials/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_content: textContent }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error || `Ошибка ${res.status}`)
        }
        toast.success('Линии блога обновлены')
        // Return the existing material (no change to list, just updated content)
        onSuccess([{ id: editingId, material_type: 'blog_lines', title: 'Линии блога', processing_status: 'ready' }])
      } else {
        // POST — create new material
        const fd = new FormData()
        fd.append('projectId', projectId)
        fd.append('title', 'Линии блога')
        fd.append('materialType', 'blog_lines')
        fd.append('isSystemVault', 'false')
        fd.append('textContent', textContent)

        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error || `Ошибка ${res.status}`)
        }
        const { materialId, processingStatus } = await res.json() as { materialId: string; processingStatus: string }
        toast.success('Линии блога сохранены')
        onSuccess([{ id: materialId, material_type: 'blog_lines', title: 'Линии блога', processing_status: processingStatus }])
      }
      onClose()
    } catch (e) {
      toast.error(friendlyError(e, 'Ошибка сохранения'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving && !v) onClose() }}>
      <DialogContent className="sm:max-w-lg border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Линии блога</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-1">
          <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <span>{TYPE_META['blog_lines']!.hint}</span>
          </div>

          {/* Professional line */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Профессиональная линия</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Прошлое</Label>
                <VoiceTextarea
                  value={profPast}
                  onChange={setProfPast}
                  placeholder="Что было в прошлом? Откуда ты пришёл(ла) в профессию..."
                  className="bg-background border border-border text-sm min-h-[80px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Настоящее</Label>
                <VoiceTextarea
                  value={profPresent}
                  onChange={setProfPresent}
                  placeholder="Где ты сейчас? Чем занимаешься, что делаешь..."
                  className="bg-background border border-border text-sm min-h-[80px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Будущее</Label>
                <VoiceTextarea
                  value={profFuture}
                  onChange={setProfFuture}
                  placeholder="Куда движешься? Цели, планы, вектор развития..."
                  className="bg-background border border-border text-sm min-h-[80px]"
                />
              </div>
            </div>
          </div>

          {/* Personal line 1 */}
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-semibold">Личная линия 1 <span className="text-xs text-muted-foreground font-normal">(необязательно)</span></p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Название линии</Label>
              <Input
                placeholder="Например: Переезд, Материнство, Здоровье..."
                value={personal1.name}
                onChange={(e) => setPersonal1(p => ({ ...p, name: e.target.value }))}
                className="text-sm"
              />
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Прошлое</Label>
                <VoiceTextarea
                  value={personal1.past}
                  onChange={(v) => setPersonal1(p => ({ ...p, past: v }))}
                  placeholder="Как это начиналось..."
                  className="bg-background border border-border text-sm min-h-[80px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Настоящее</Label>
                <VoiceTextarea
                  value={personal1.present}
                  onChange={(v) => setPersonal1(p => ({ ...p, present: v }))}
                  placeholder="Где ты сейчас в этой теме..."
                  className="bg-background border border-border text-sm min-h-[80px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Будущее</Label>
                <VoiceTextarea
                  value={personal1.future}
                  onChange={(v) => setPersonal1(p => ({ ...p, future: v }))}
                  placeholder="К чему стремишься..."
                  className="bg-background border border-border text-sm min-h-[80px]"
                />
              </div>
            </div>
          </div>

          {/* Personal line 2 */}
          {!showPersonal2 ? (
            <button
              type="button"
              onClick={() => setShowPersonal2(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить ещё линию
            </button>
          ) : (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Личная линия 2 <span className="text-xs text-muted-foreground font-normal">(необязательно)</span></p>
                <button
                  type="button"
                  onClick={() => { setShowPersonal2(false); setPersonal2({ name: '', past: '', present: '', future: '' }) }}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Убрать
                </button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Название линии</Label>
                <Input
                  placeholder="Например: Спорт, Творчество, Отношения..."
                  value={personal2.name}
                  onChange={(e) => setPersonal2(p => ({ ...p, name: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Прошлое</Label>
                  <VoiceTextarea
                    value={personal2.past}
                    onChange={(v) => setPersonal2(p => ({ ...p, past: v }))}
                    placeholder="Как это начиналось..."
                    className="bg-background border border-border text-sm min-h-[80px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Настоящее</Label>
                  <VoiceTextarea
                    value={personal2.present}
                    onChange={(v) => setPersonal2(p => ({ ...p, present: v }))}
                    placeholder="Где ты сейчас в этой теме..."
                    className="bg-background border border-border text-sm min-h-[80px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Будущее</Label>
                  <VoiceTextarea
                    value={personal2.future}
                    onChange={(v) => setPersonal2(p => ({ ...p, future: v }))}
                    placeholder="К чему стремишься..."
                    className="bg-background border border-border text-sm min-h-[80px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Отмена</Button>
            <Button
              className="flex-1 gradient-accent text-white hover:opacity-90"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Сохраняем...</> : 'Сохранить'}
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
  const [showBlogLines, setShowBlogLines] = useState(false)
  const [showInterview, setShowInterview] = useState(false)
  const [showToneFromContent, setShowToneFromContent] = useState(false)
  const [igDialogType, setIgDialogType] = useState<'my_instagram' | 'competitors' | null>(null)
  const [showBlogAudit, setShowBlogAudit] = useState(false)
  const [auditScore10, setAuditScore10] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [materials, setMaterials] = useState(initialMaterials)
  // Restore scroll position after a reloadKeepScroll() — so finishing a long
  // AI operation drops the user back where they were, not at the top.
  useEffect(() => {
    const y = sessionStorage.getItem('ama_scroll_restore')
    if (y) {
      sessionStorage.removeItem('ama_scroll_restore')
      requestAnimationFrame(() => window.scrollTo(0, parseInt(y, 10) || 0))
    }
  }, [])
  const [editingBlogLines, setEditingBlogLines] = useState<{ id: string; content: string } | null>(null)
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null)
  // Live score — same shared formula and same ready-only filter as the
  // server (upload/delete routes). No Math.max floor: the number must be
  // able to go DOWN when a material is deleted.
  const score = useMemo(
    () => computeCompleteness(
      materials.filter(m => m.processing_status === 'ready').map(m => m.material_type)
    ),
    [materials],
  )
  const [showHint, setShowHint] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [generatingMeanings, setGeneratingMeanings] = useState(false)

  const materialsByType = materials.reduce<Record<string, Material[]>>((acc, m) => {
    if (!acc[m.material_type]) acc[m.material_type] = []
    acc[m.material_type]!.push(m)
    return acc
  }, {})

  // Cached blog-audit score → «X/10» badge on the connected account card.
  // Refetches when the audit dialog closes (a fresh run may have updated it).
  useEffect(() => {
    if (!materials.some(m => m.material_type === 'my_instagram')) { setAuditScore10(null); return }
    let alive = true
    fetch(`/api/blog-audit?projectId=${projectId}`)
      .then(r => r.json())
      .then((d: { result?: { score10?: number } | null }) => {
        if (alive) setAuditScore10(typeof d.result?.score10 === 'number' ? d.result.score10 : null)
      })
      .catch(() => { /* no cache — no badge */ })
    return () => { alive = false }
  }, [projectId, showBlogAudit, materials])

  // Called after upload — add new materials to state instantly (no page refresh)
  const handleUploaded = (newMaterials: Material[]) => {
    setMaterials(prev => [...newMaterials, ...prev])
  }

  const handleEditBlogLines = async (id: string) => {
    setLoadingEditId(id)
    try {
      const res = await fetch(`/api/materials/${id}`)
      if (!res.ok) throw new Error('Ошибка загрузки')
      const data = await res.json() as { raw_content: string }
      setEditingBlogLines({ id, content: data.raw_content || '' })
      setShowBlogLines(true)
    } catch {
      toast.error('Не удалось загрузить содержимое')
    } finally {
      setLoadingEditId(null)
    }
  }

  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const downloadMaterial = async (id: string, title: string, type?: string) => {
    setDownloadingId(id)
    try {
      const res = await fetch(`/api/materials/${id}`)
      if (!res.ok) throw new Error('Ошибка загрузки')
      const data = await res.json() as { raw_content?: string }
      const content = data.raw_content || ''
      if (!content.trim()) { toast.error('В материале пока нет содержимого'); return }
      const safe = (title || 'material').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 80) || 'material'

      // Structured research materials → real XLSX (true columns; comma-CSV
      // showed as one column in RU Excel / iOS). Pivoted/restructured per spec.
      let aoa: string[][] | null = null
      if (type === 'audience_research') aoa = audienceResearchToAoa(content)
      else if (type === 'meanings_map') aoa = meaningsMapToAoa(content)
      if (aoa && aoa.length > 1) {
        await downloadXlsx(safe, type === 'audience_research' ? 'Исследование' : 'Карта смыслов', aoa)
        return
      }

      // Text materials → styled HTML so it opens with a clean, readable font
      // (not the monospace .txt viewer). Renders nicely on phone/desktop.
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       max-width:720px;margin:0 auto;padding:28px 20px;color:#1a1a1a;line-height:1.6;font-size:16px;background:#fff}
  h1{font-size:22px;font-weight:700;margin:0 0 6px}
  .meta{color:#888;font-size:13px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #eee}
  .content{white-space:pre-wrap}
</style></head><body>
<h1>${esc(title)}</h1>
<div class="meta">Материал проекта · AMA</div>
<div class="content">${esc(content)}</div>
</body></html>`
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href = url; a.download = `${safe}.html`; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Не удалось скачать материал')
    } finally {
      setDownloadingId(null)
    }
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
      reloadKeepScroll()
    } finally {
      setDeletingId(null)
    }
  }

  // SSE stream — same pattern as warmup-plan (proven to work on this host).
  // Server heartbeats every chunk + 10s ping so the connection never goes
  // silent. One AI pass over all interviews. Result is also saved server-
  // side, so a dropped connection still leaves the map (refresh shows it).
  const generateMeaningsMap = async () => {
    setGeneratingMeanings(true)
    const loadingToast = toast.loading('Собираю карту смыслов из всех интервью (≈1 минута). Не закрывай страницу.')
    try {
      const res = await fetch('/api/ai/research-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, step: 'generate_meanings' }),
      })
      if (!res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? 'Ошибка генерации')
      }
      if (!res.body) throw new Error('Нет ответа от сервера')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', done = false, errMsg = ''

      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const ev of parts) {
          const line = ev.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const m = JSON.parse(line.slice(6)) as { type: string; message?: string }
            if (m.type === 'status' && m.message) toast.loading(m.message, { id: loadingToast })
            else if (m.type === 'done') done = true
            else if (m.type === 'error') errMsg = m.message ?? 'Ошибка генерации карты смыслов'
          } catch { /* heartbeat */ }
        }
      }

      if (errMsg) throw new Error(errMsg)
      if (!done) throw new Error('Связь оборвалась, но карта могла сохраниться — обнови страницу через минуту.')

      toast.dismiss(loadingToast)
      toast.success('Карта смыслов готова и сохранена в материалы')
      reloadKeepScroll()
    } catch (err) {
      toast.dismiss(loadingToast)
      toast.error(friendlyError(err, 'Ошибка генерации карты смыслов'), { duration: 60000 })
    } finally {
      setGeneratingMeanings(false)
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
                              {type === 'blog_lines' && (
                                <button
                                  onClick={() => handleEditBlogLines(item.id)}
                                  disabled={loadingEditId === item.id}
                                  className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
                                  title="Редактировать"
                                >
                                  {loadingEditId === item.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Pencil className="h-3 w-3" />
                                  }
                                </button>
                              )}
                              <button
                                onClick={() => downloadMaterial(item.id, item.title, type)}
                                disabled={downloadingId === item.id}
                                className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
                                title="Скачать"
                              >
                                {downloadingId === item.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Download className="h-3 w-3" />
                                }
                              </button>
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
                      <div className="flex flex-wrap items-center gap-2">
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
                        {/* Audio transcription shortcut for interview_transcript */}
                        {type === 'interview_transcript' && (
                          <Link href={`/projects/${projectId}/research`}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-8 px-3 border-primary/40 text-primary hover:bg-primary/10"
                            >
                              <AudioLines className="h-3 w-3 mr-1.5" />
                              Из аудио
                            </Button>
                          </Link>
                        )}
                        {type === 'meanings_map' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={generatingMeanings}
                            className="text-xs h-8 px-3 border-primary/40 text-primary hover:bg-primary/10"
                            onClick={generateMeaningsMap}
                          >
                            {generatingMeanings ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1.5" />}
                            {generatingMeanings ? 'Генерирую...' : 'Сгенерировать из исследования'}
                          </Button>
                        )}
                        {type === 'tone_of_voice' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8 px-3 border-primary/40 text-primary hover:bg-primary/10"
                            onClick={() => setShowToneFromContent(true)}
                          >
                            <Sparkles className="h-3 w-3 mr-1.5" />
                            Из моих текстов
                          </Button>
                        )}
                        {/* Instagram types: server-enforced quota (1 own / 5 competitors).
                            We hide the button when full; backend rejects anyway. */}
                        {(type === 'my_instagram' || type === 'competitors') ? (() => {
                          const limit = type === 'my_instagram' ? 1 : 5
                          const used  = items.length
                          if (used >= limit) {
                            if (type === 'my_instagram') {
                              return (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-muted-foreground">Аккаунт подключён</span>
                                  {auditScore10 !== null && (
                                    <span
                                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                        auditScore10 <= 3 ? 'bg-red-500/15 text-red-600'
                                          : auditScore10 <= 5.5 ? 'bg-orange-500/15 text-orange-600'
                                          : auditScore10 <= 7.5 ? 'bg-amber-500/15 text-amber-600'
                                          : 'bg-green-500/15 text-green-600'
                                      }`}
                                      title="Оценка блога к продажам по последней диагностике"
                                    >
                                      {auditScore10.toFixed(1)}/10
                                    </span>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-8 px-3 border-primary/40 text-primary hover:bg-primary/10"
                                    onClick={() => setShowBlogAudit(true)}
                                  >
                                    <Sparkles className="h-3 w-3 mr-1.5" />
                                    {auditScore10 !== null ? 'Перепроверить блог' : 'Диагностика блога'}
                                  </Button>
                                </div>
                              )
                            }
                            return (
                              <span className="text-xs text-muted-foreground">
                                {`Достигнут лимит ${limit}/5 — удали один, чтобы добавить новый`}
                              </span>
                            )
                          }
                          return (
                            <Button
                              size="sm"
                              variant={hasItems ? 'outline' : 'default'}
                              className={`text-xs h-8 px-4 ${hasItems ? 'border-border' : 'gradient-accent text-white hover:opacity-90 border-0'}`}
                              onClick={() => setIgDialogType(type as 'my_instagram' | 'competitors')}
                            >
                              <Upload className="h-3 w-3 mr-1.5" />
                              {type === 'my_instagram' ? 'Подключить аккаунт' : (hasItems ? `Добавить ещё (${used}/5)` : 'Добавить конкурента')}
                            </Button>
                          )
                        })() : (
                          <Button
                            size="sm"
                            variant={hasItems ? 'outline' : 'default'}
                            className={`text-xs h-8 px-4 ${hasItems ? 'border-border' : 'gradient-accent text-white hover:opacity-90 border-0'}`}
                            onClick={() => type === 'blog_lines' ? (setEditingBlogLines(null), setShowBlogLines(true)) : setUploadFor(type)}
                          >
                            <Upload className="h-3 w-3 mr-1.5" />
                            {hasItems ? 'Добавить ещё' : 'Загрузить'}
                          </Button>
                        )}
                        {type === 'competitors' && hasItems && (
                          <CompetitorAnalysis projectId={projectId} />
                        )}
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

      {/* Blog Lines dialog */}
      <BlogLinesDialog
        projectId={projectId}
        open={showBlogLines}
        onClose={() => { setShowBlogLines(false); setEditingBlogLines(null) }}
        onSuccess={(newMaterials) => {
          if (!editingBlogLines) {
            handleUploaded(newMaterials)
          }
          setShowBlogLines(false)
          setEditingBlogLines(null)
        }}
        initialContent={editingBlogLines?.content}
        editingId={editingBlogLines?.id}
      />

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
        onSuccess={() => reloadKeepScroll()}
      />

      {/* Tone of Voice from user's own content */}
      <ToneFromContentDialog
        projectId={projectId}
        open={showToneFromContent}
        onClose={() => setShowToneFromContent(false)}
        onSuccess={() => reloadKeepScroll()}
      />

      {/* Instagram account (own / competitor) scrape + analyze */}
      {igDialogType && (
        <InstagramAccountDialog
          projectId={projectId}
          accountType={igDialogType}
          remainingSlots={Math.max(1, (igDialogType === 'my_instagram' ? 1 : 5) - materials.filter(m => m.material_type === igDialogType).length)}
          open={!!igDialogType}
          onClose={() => setIgDialogType(null)}
          onSuccess={() => reloadKeepScroll()}
        />
      )}

      {/* Диагностика блога к продажам (по подключённому my_instagram) */}
      <BlogAuditDialog
        projectId={projectId}
        open={showBlogAudit}
        onClose={() => setShowBlogAudit(false)}
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
