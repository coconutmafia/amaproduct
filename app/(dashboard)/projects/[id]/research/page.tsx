'use client'

import { useState, useCallback, useRef, use } from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/friendlyError'
import { isDefinitelyNotMedia, NOT_MEDIA_MESSAGE } from '@/lib/media/notMedia'
import Link from 'next/link'
import { ArrowLeft, Upload, Mic, Loader2, ChevronDown, ChevronUp, Sparkles, Download, CheckCircle2, Users, FileText, Save, Plus, X, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { InterviewTable, Respondent } from '@/app/api/ai/research-analyze/route'

// Максимальный размер аудиофайла (МБ). Должен совпадать с лимитом загрузки
// Supabase (Free = 50 МБ жёстко; Pro — сколько выставишь в Project Settings →
// Storage). Меняется через env NEXT_PUBLIC_MAX_AUDIO_MB (Vercel) без правки кода.
// Пред-проверка на клиенте ловит превышение ДО заливки — сразу понятная ошибка,
// без ожидания провала загрузки большого файла.
const MAX_AUDIO_MB    = Number(process.env.NEXT_PUBLIC_MAX_AUDIO_MB) || 50
const MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024

// Понятное сообщение об ошибке загрузки/расшифровки аудио — вместо сырого
// «The object exceeded the maximum allowed size» и т.п. (тестер не понимает,
// что не так). Показывается целиком, отдельной строкой под именем файла.
function friendlyUploadError(raw: string): string {
  const m = raw || ''
  if (/exceeded the maximum allowed size|maximum allowed size|payload too large|entity too large|\b413\b/i.test(m)) {
    return 'Файл слишком большой — не поместился в лимит загрузки. Разбей интервью на части по 30–40 минут и загрузи по отдельности (или сожми запись в mp3 с меньшим битрейтом).'
  }
  if (/mime|not allowed|unsupported|invalid.*type/i.test(m)) {
    return 'Формат файла не поддерживается. Загрузи запись в mp3, m4a или wav.'
  }
  if (/failed to fetch|networkerror|network error|timeout|timed out|aborted|econn/i.test(m)) {
    return 'Не удалось загрузить — похоже, проблема со связью. Проверь интернет и попробуй ещё раз.'
  }
  if (/сессия истекла/i.test(m)) return m
  // Русское осмысленное сообщение сервера показываем как есть, иначе — общий текст.
  return friendlyError(m, 'Не удалось обработать файл. Попробуй ещё раз или загрузи в другом формате (mp3/m4a).')
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'transcribing' | 'transcribed' | 'analyzing1' | 'table1' | 'saving' | 'saved'

type FileStatus = {
  name:        string
  status:      'pending' | 'uploading' | 'transcribing' | 'done' | 'error'
  chunkIndex?: number
  totalChunks?: number
  error?:      string
}

const BLOCK_LABELS: Record<string, string> = {
  point_a:   'Точка А',
  point_b:   'Точка Б',
  barriers:  'Барьеры',
  criteria:  'Критерии',
  other:     'Прочее',
}

const BLOCK_COLORS: Record<string, string> = {
  point_a:   'bg-red-50 text-red-700 border-red-200',
  point_b:   'bg-green-50 text-green-700 border-green-200',
  barriers:  'bg-orange-50 text-orange-700 border-orange-200',
  criteria:  'bg-blue-50 text-blue-700 border-blue-200',
  other:     'bg-gray-50 text-gray-600 border-gray-200',
}

// Whisper's hard limit is 25 MB per request.
// We slice into 24 MB chunks on the client side — safely under Whisper's cap.
// The file is uploaded directly to Supabase Storage (bypassing Vercel's
// ~4.5 MB body limit), and the API route cuts TIME windows from there with ffmpeg.

// Read an audio file's duration on-device (to split it into time windows).
// Returns 0 if the format/stub can't report it → server does one whole-file pass.
function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const el = document.createElement('audio')
      el.preload = 'metadata'
      const url = URL.createObjectURL(file)
      const finish = (d: number) => { try { URL.revokeObjectURL(url) } catch { /* */ }; resolve(Number.isFinite(d) && d > 0 ? d : 0) }
      el.onloadedmetadata = () => finish(el.duration)
      el.onerror = () => finish(0)
      el.src = url
    } catch { resolve(0) }
  })
}

// Poll a background transcription job (roadmap #8) until it's done or errors.
// Safe across a locked/backgrounded phone: setTimeout is throttled while the
// tab is backgrounded, not cancelled — polling simply resumes once it wakes,
// and by then the server-side job may already be finished.
function pollTranscribeJob(
  jobId: string,
  onProgress: (doneChunks: number, totalChunks: number | null) => void,
): Promise<string> {
  let consecutiveFailures = 0
  const MAX_CONSECUTIVE_FAILURES = 30 // ~2 min of nothing-but-errors → genuinely give up
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        const body = await res.json() as {
          job?: { status: string; progress?: { doneChunks?: number; totalChunks?: number | null }; result?: { text?: string }; error?: string }
          error?: string
        }
        if (!res.ok || !body.job) { reject(new Error(body.error ?? 'Не удалось получить статус расшифровки')); return }
        consecutiveFailures = 0
        const { status, progress, result, error } = body.job
        onProgress(progress?.doneChunks ?? 0, progress?.totalChunks ?? null)
        if (status === 'done') { resolve(result?.text ?? ''); return }
        if (status === 'error') { reject(new Error(error ?? 'Ошибка расшифровки')); return }
        setTimeout(poll, 2500)
      } catch {
        // Transient network hiccup (e.g. tab just woke up) — keep polling
        // rather than failing the whole transcription over one dropped request.
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          reject(new Error('Нет связи с сервером — проверь интернет и попробуй снова'))
          return
        }
        setTimeout(poll, 4000)
      }
    }
    poll()
  })
}

type ProgressState =
  | { stage: 'uploading';     fileIndex: number; totalFiles: number }
  | { stage: 'transcribing';  fileIndex: number; totalFiles: number; chunkIndex: number; totalChunks: number }

// ── Main component ────────────────────────────────────────────────────────────

export default function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [step, setStep]               = useState<Step>('upload')
  const [transcription, setTranscription] = useState('')
  // per-file parts — used for batch analysis (avoid hitting AI output token limit)
  const [transcriptionParts, setTranscriptionParts] = useState<{ name: string; text: string }[]>([])
  const [table1, setTable1]           = useState<InterviewTable | null>(null)
  const [analysisBatch, setAnalysisBatch] = useState<{ current: number; total: number } | null>(null)
  const [expandedRespondent, setExpandedRespondent] = useState<string | null>(null)
  const [isDragging, setIsDragging]   = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ name: string; sizeMb: string; estMin: string } | null>(null)
  // tracks both upload stage (to Supabase Storage) and transcription stage (chunks → Whisper)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  // shown while waiting for iCloud to finish downloading a file
  const [icloudWait, setIcloudWait] = useState<{ name: string; attempt: number; max: number } | null>(null)
  // per-file status for multi-file processing
  const [fileQueue, setFileQueue] = useState<FileStatus[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Transcription ───────────────────────────────────────────────────────────
  // Uses file.slice() — a lazy Blob that lets iOS download iCloud files on
  // demand when fetch() reads it. No FileReader, no ArrayBuffer intermediary.
  // Long files are split into time windows and sent sequentially.

  const transcribeFiles = useCallback(async (files: File[]) => {
    setStep('transcribing')
    setProgress(null)
    setIcloudWait(null)

    const supabase  = createSupabaseClient()
    const allParts: { name: string; text: string }[] = []
    const fileErrors: string[] = []

    // Initialise per-file queue so the user sees all files upfront
    const initNames = files.map((f, i) => {
      let name = `файл ${i + 1}`
      try { name = f.name } catch { /* iCloud stub */ }
      return name
    })
    setFileQueue(initNames.map(name => ({ name, status: 'pending' })))

    const updateFile = (fi: number, patch: Partial<FileStatus>) =>
      setFileQueue(prev => prev.map((s, i) => i === fi ? { ...s, ...patch } : s))

    // Auth check once
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      toast.error('Войди в систему, чтобы загрузить файлы')
      setStep('upload')
      return
    }

    for (let fi = 0; fi < files.length; fi++) {
      const uploadedPaths: string[] = []

      try {
        const file = files[fi]
        let fileName = initNames[fi]

        const rawExt = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
        const ext    = rawExt || 'mp3'

        // Пред-проверка типа: у инпута нет accept (iOS Safari + iCloud, см. ниже),
        // поэтому картинку/документ выбрать можно — и раньше она молча доезжала до
        // ffmpeg, а человек получал в лицо его командную строку. Ловим здесь: до
        // заливки, не тратя ни трафик человека, ни место в audio-temp.
        // MIME может отсутствовать у файла-заглушки из iCloud — тогда решает
        // расширение, а неизвестное расширение считается допустимым.
        let fileMime = ''
        try { fileMime = file.type } catch { /* iCloud stub — читаем только ext */ }
        if (isDefinitelyNotMedia({ ext: rawExt, mime: fileMime })) {
          throw new Error(NOT_MEDIA_MESSAGE)
        }

        // Пред-проверка размера: не тратим время на заведомо провальную заливку
        // большого файла — сразу понятная ошибка с конкретными цифрами.
        if (file.size > MAX_AUDIO_BYTES) {
          throw new Error(`Файл ${(file.size / 1024 / 1024).toFixed(0)} МБ больше лимита ${MAX_AUDIO_MB} МБ. Разбей интервью на части по 30–40 минут и загрузи по отдельности.`)
        }

        // ── 1. Upload to Supabase Storage via signed URL ────────────────────
        updateFile(fi, { status: 'uploading' })

        const urlRes  = await fetch('/api/ai/transcribe/upload-url', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ext }),
        })
        const urlBody = await urlRes.text()
        let urlData: { path?: string; token?: string; error?: string }
        try { urlData = JSON.parse(urlBody) as typeof urlData }
        catch { throw new Error(`Ошибка получения ссылки (${urlRes.status})`) }
        if (!urlRes.ok || urlData.error) throw new Error(urlData.error ?? 'Ошибка получения ссылки')

        const storagePath = urlData.path!
        const uploadToken = urlData.token!

        const { error: uploadError } = await supabase.storage
          .from('audio-temp')
          .uploadToSignedUrl(storagePath, uploadToken, file)
        if (uploadError) throw new Error(`Ошибка загрузки: ${uploadError.message}`)
        uploadedPaths.push(storagePath)

        // ── 2. Transcribe as a BACKGROUND JOB — server runs it to completion ────
        // (roadmap #8). Previously the client itself looped chunk-by-chunk over
        // HTTP, which meant a locked/backgrounded phone could stall or drop the
        // whole transcription mid-way. Now one call starts a server-side job
        // (self-continuing across invocations via next/server's `after()`), and
        // the client just polls status — safe to lock the screen; the job keeps
        // running either way, and polling simply resumes once the tab wakes.
        const durationSec = await getAudioDuration(file)

        const startRes = await fetch('/api/jobs/transcribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ projectId: id, storagePath, ext, durationSec: durationSec > 0 ? durationSec : undefined }),
        })
        const startBody = await startRes.json() as { jobId?: string; error?: string }
        if (!startRes.ok || startBody.error || !startBody.jobId) {
          throw new Error(startBody.error ?? 'Не удалось запустить расшифровку')
        }

        const finalText = await pollTranscribeJob(startBody.jobId, (doneChunks, totalChunks) => {
          updateFile(fi, { status: 'transcribing', chunkIndex: doneChunks, totalChunks: totalChunks ?? doneChunks })
        })

        allParts.push({ name: fileName, text: finalText })
        updateFile(fi, { status: 'done' })

      } catch (err) {
        // ── One file failed — mark it and continue with the rest ────────────
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка'
        fileErrors.push(msg)
        updateFile(fi, { status: 'error', error: msg })
      } finally {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from('audio-temp').remove(uploadedPaths).catch(() => {})
        }
      }
    }

    setProgress(null)

    if (allParts.length > 0) {
      setTranscriptionParts(allParts)
      setTranscription(allParts.map(p => p.text).join('\n\n'))
      setStep('transcribed')
    } else {
      // Surface the ACTUAL reason (quota / ffmpeg / empty iCloud stub / storage)
      // instead of a generic message — so the user (and we) see what to fix.
      const reason = [...new Set(fileErrors)].join('; ').slice(0, 300)
      toast.error(reason ? `Не удалось расшифровать: ${reason}` : 'Ни один файл не удалось расшифровать')
      setStep('upload')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFiles = useCallback((fileList: FileList) => {
    const count = fileList.length
    if (count === 0) return
    setSelectedFile({ name: count === 1 ? 'файл выбран' : `${count} файлов выбрано`, sizeMb: '…', estMin: '…' })
    // Sort by filename so касдев1, касдев2, касдев3 are processed in order
    const files = Array.from(fileList).sort((a, b) => {
      try { return a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' }) }
      catch { return 0 }
    })
    if (files.length === 0) { toast.error('Не удалось прочитать файлы'); return }
    transcribeFiles(files)
  }, [transcribeFiles])

  // openPicker: called from the button — a direct trusted user gesture on iOS.
  // We do NOT read files in onChange (e.target.files throws DOMException for
  // iCloud files on iOS Safari). Instead we wait for the change event via a
  // one-time listener, then read from the ref — different code path, no throw.
  const openPicker = useCallback(() => {
    const input = fileInputRef.current
    if (!input) return

    const onChanged = () => {
      input.removeEventListener('change', onChanged)
      // Small delay: give iOS time to make the FileList accessible
      setTimeout(() => {
        try {
          const fl = input.files
          if (fl && fl.length > 0) handleFiles(fl)
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          if (msg.includes('did not match the expected pattern')) {
            toast.error('iOS не может прочитать файлы из iCloud прямо сейчас. Открой «Файлы», загрузи их на устройство и попробуй снова.')
          } else {
            toast.error(msg || 'Ошибка при чтении файлов')
          }
        }
        try { input.value = '' } catch { /* ignore */ }
      }, 300)
    }

    input.addEventListener('change', onChanged)
    try {
      input.click()
    } catch {
      input.removeEventListener('change', onChanged)
    }
  }, [handleFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    try {
      const fl = e.dataTransfer.files
      if (fl && fl.length > 0) handleFiles(fl)
    } catch (err) {
      toast.error(friendlyError(err, 'Ошибка при перетаскивании файлов'))
    }
  }, [handleFiles])

  // ── Analysis: batch by 3 files to stay within AI output token limit ──────────
  // With many files the combined transcription can produce 10-15 respondents,
  // which requires 15-20K output tokens — more than the model's 8K cap.
  // Processing 3 files at a time keeps output comfortably under the limit.
  const analyzeTable1 = useCallback(async () => {
    setStep('analyzing1')
    setAnalysisBatch(null)
    try {
      const BATCH = 3
      const parts = transcriptionParts.length > 0
        ? transcriptionParts
        : [{ name: 'Интервью', text: transcription }]

      const batches: typeof parts[] = []
      for (let i = 0; i < parts.length; i += BATCH) batches.push(parts.slice(i, i + BATCH))

      const allRespondents: Respondent[] = []
      setAnalysisBatch({ current: 0, total: batches.length })

      for (let bi = 0; bi < batches.length; bi++) {
        setAnalysisBatch({ current: bi + 1, total: batches.length })
        const batchText = batches[bi]
          .map((p, i) => batches[bi].length > 1 ? `[Файл ${bi * BATCH + i + 1}: ${p.name}]\n${p.text}` : p.text)
          .join('\n\n---\n\n')

        const res  = await fetch('/api/ai/research-analyze', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ projectId: id, step: 'table1', transcription: batchText }),
        })
        const data = await res.json() as { table1?: InterviewTable; error?: string }
        if (!res.ok || data.error) throw new Error(data.error ?? `Батч ${bi + 1}: ошибка анализа`)
        allRespondents.push(...(data.table1?.respondents ?? []))
      }

      const combined: InterviewTable = { respondents: allRespondents }
      setTable1(combined)
      setAnalysisBatch(null)
      setStep('table1')
      setExpandedRespondent(allRespondents[0]?.id ?? null)
    } catch (err) {
      toast.error(friendlyError(err, 'Ошибка анализа'))
      setAnalysisBatch(null)
      setStep('transcribed')
    }
  }, [id, transcription, transcriptionParts])

  // ── Save to materials ───────────────────────────────────────────────────────
  const saveToMaterials = useCallback(async () => {
    if (!table1) return
    setStep('saving')
    try {
      const res = await fetch('/api/ai/research-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: id, step: 'save', transcription, table1 }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Save failed')
      setStep('saved')
    } catch (err) {
      toast.error(friendlyError(err, 'Ошибка сохранения'))
      setStep('table1')
    }
  }, [id, transcription, table1])

  // ── Export helpers ──────────────────────────────────────────────────────────
  const exportTable1CSV = useCallback(() => {
    if (!table1) return
    const rows: string[][] = [['Участник', 'Сегмент', 'Блок', 'Вопрос', 'Ответ', 'Ключевые цитаты', 'Тон']]
    for (const r of table1.respondents) {
      for (const a of r.answers) {
        rows.push([r.name || r.id, r.segment, BLOCK_LABELS[a.block] ?? a.block, a.question, a.full_answer, a.key_quotes.join(' | '), a.emotional_tone])
      }
    }
    downloadCSV(rows, 'interview-table.csv')
  }, [table1])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0">
          <Link href={`/projects/${id}/knowledge`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-lg font-bold text-foreground">Исследование аудитории</h1>
          <p className="text-xs text-muted-foreground">Загрузи аудиозапись интервью — AI расшифрует и соберёт таблицу исследования</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-2 text-xs">
        {[
          { label: 'Загрузка',     done: step !== 'upload' && step !== 'transcribing' },
          { label: 'Расшифровка',  done: ['table1', 'analyzing1', 'saving', 'saved'].includes(step) },
          { label: 'Таблица',      done: ['saving', 'saved'].includes(step) },
          { label: 'Сохранено',    done: step === 'saved' },
        ].map((s, i, arr) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`flex items-center gap-1 font-medium ${s.done ? 'text-[#3A8A48]' : 'text-muted-foreground'}`}>
              {s.done && <CheckCircle2 className="h-3.5 w-3.5" />}
              {s.label}
            </span>
            {i < arr.length - 1 && <span className="text-muted-foreground/40">→</span>}
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {(step === 'upload' || step === 'transcribing') && (
        <div className="space-y-4">
          {/* Hidden file input.
              No accept attr — iOS Safari throws DOMException when accept is set
              with iCloud files. No onChange — we read via ref in openPicker()
              to avoid iOS touching e.target.files before we're ready. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={() => {
              // Intentionally empty — files are read via ref in openPicker()
              // to work around iOS Safari DOMException on e.target.files access
            }}
          />

          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition-all
              ${isDragging ? 'border-[#3A8A48] bg-[#3A8A48]/5' : 'border-[#DEDEDE] hover:border-[#3A8A48]/50 hover:bg-[#3A8A48]/3'}
              ${step === 'transcribing' ? 'pointer-events-none opacity-70' : ''}`}
          >
            {step === 'transcribing' ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3A8A48]/10">
                  <Loader2 className="h-7 w-7 text-[#3A8A48] animate-spin" />
                </div>
                <div className="space-y-3 w-full max-w-sm">
                  <p className="font-semibold text-foreground text-center">
                    {fileQueue.length > 1 ? `Расшифровываю ${fileQueue.length} файлов...` : 'Расшифровываю аудио...'}
                  </p>

                  {/* Per-file status list */}
                  {fileQueue.length > 0 && (
                    <div className="space-y-1.5 w-full">
                      {fileQueue.map((f, i) => (
                        <div key={i} className={`px-3 py-2 rounded-lg border text-xs transition-colors text-left ${
                          f.status === 'done'        ? 'border-green-200  bg-green-50' :
                          f.status === 'error'       ? 'border-red-200    bg-red-50' :
                          f.status === 'uploading' ||
                          f.status === 'transcribing'? 'border-[#3A8A48]/25 bg-[#3A8A48]/5' :
                          'border-[#ECECEC] bg-white/60'
                        }`}>
                          <div className="flex items-center gap-2">
                            {f.status === 'uploading' || f.status === 'transcribing'
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3A8A48] shrink-0" />
                              : f.status === 'done'
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              : f.status === 'error'
                              ? <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                            <span className="flex-1 truncate font-medium text-foreground">{f.name}</span>
                            <span className={`shrink-0 text-[11px] ${f.status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>
                              {f.status === 'uploading'    ? 'Загружаю...' :
                               f.status === 'transcribing' ? (f.totalChunks && f.totalChunks > 1 ? `Часть ${f.chunkIndex}/${f.totalChunks}` : 'Расшифровываю...') :
                               f.status === 'done'         ? 'Готово ✓' :
                               f.status === 'error'        ? 'Ошибка' :
                               'Ожидание...'}
                            </span>
                          </div>
                          {f.status === 'error' && f.error && (
                            <p className="mt-1.5 text-[11px] text-red-600 leading-snug break-words">
                              {friendlyUploadError(f.error)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Progress bar — fraction of done files */}
                  {fileQueue.length > 1 && (() => {
                    const done = fileQueue.filter(f => f.status === 'done' || f.status === 'error').length
                    return (
                      <div className="w-full h-1.5 rounded-full bg-[#3A8A48]/15 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#3A8A48] transition-all duration-500"
                          style={{ width: `${Math.round((done / fileQueue.length) * 100)}%` }}
                        />
                      </div>
                    )
                  })()}

                  <p className="text-xs text-muted-foreground text-center">Расшифровка идёт на сервере — экран телефона можно заблокировать. Просто не закрывай эту вкладку</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3A8A48]/10">
                  <Mic className="h-7 w-7 text-[#3A8A48]" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Перетащи аудиозапись интервью</p>
                  <p className="text-sm text-muted-foreground">или нажми чтобы выбрать файл(ы)</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">MP3, MP4, M4A, WAV, OGG, WEBM</p>
                </div>
                {/* Limit hint */}
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
                  <span>⏱ До 100 МБ (≈ 100 минут MP3)</span>
                  <span className="text-amber-400">·</span>
                  <span>Большие файлы разбиваются автоматически</span>
                </div>
                <button
                  type="button"
                  onClick={openPicker}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" /> Выбрать файл
                </button>
              </>
            )}
          </div>

          {/* Manual text fallback */}
          {step === 'upload' && (
            <details className="rounded-xl border border-[#ECECEC] overflow-hidden">
              <summary className="px-4 py-3 text-sm text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" /> Или вставь расшифровку текстом
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <textarea
                  className="w-full h-40 text-sm border border-[#ECECEC] rounded-xl p-3 resize-none focus:outline-none focus:border-[#3A8A48]/50 text-foreground bg-background"
                  placeholder="Вставь сюда готовую расшифровку интервью..."
                  value={transcription}
                  onChange={e => setTranscription(e.target.value)}
                />
                {transcription.length > 50 && (
                  <Button size="sm" onClick={() => setStep('transcribed')} className="bg-[#3A8A48] hover:bg-[#2E6E3A] text-white">
                    Использовать этот текст →
                  </Button>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Step: Transcription done ── */}
      {step === 'transcribed' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#3A8A48]/30 bg-[#3A8A48]/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#3A8A48]" />
                <p className="text-sm font-semibold text-[#3A8A48]">Расшифровка готова</p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setStep('upload')}>Загрузить другой файл</Button>
            </div>
            <div className="rounded-lg border border-[#ECECEC] bg-white p-3 max-h-48 overflow-y-auto">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{transcription}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={analyzeTable1} className="bg-[#3A8A48] hover:bg-[#2E6E3A] text-white">
              <Users className="h-4 w-4 mr-2" />
              Создать таблицу исследования
            </Button>
          </div>
        </div>
      )}

      {/* ── Step: Analyzing ── */}
      {step === 'analyzing1' && (
        <div className="rounded-xl border border-[#ECECEC] bg-white p-8 flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 text-[#3A8A48] animate-spin" />
          <div>
            <p className="font-semibold text-foreground">
              {analysisBatch && analysisBatch.total > 1
                ? `Анализирую часть ${analysisBatch.current} из ${analysisBatch.total}...`
                : 'Анализирую интервью...'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Определяю участников, вопросы, цитаты и эмоциональные тоны</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Это займёт несколько минут — не закрывай страницу</p>
            {analysisBatch && analysisBatch.total > 1 && (
              <div className="mt-3 w-48 h-1.5 rounded-full bg-[#3A8A48]/15 overflow-hidden mx-auto">
                <div
                  className="h-full rounded-full bg-[#3A8A48] transition-all duration-500"
                  style={{ width: `${Math.round(((analysisBatch.current - 1) / analysisBatch.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Table 1 ── */}
      {(step === 'table1' || step === 'saving') && table1 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100">
                <Users className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Таблица исследования</p>
                <p className="text-xs text-muted-foreground">{table1.respondents.length} участников</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportTable1CSV} className="h-8 text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>

          {/* Participants summary chips */}
          <div className="flex flex-wrap gap-2">
            {table1.respondents.map((r: Respondent) => (
              <button
                key={r.id}
                onClick={() => setExpandedRespondent(expandedRespondent === r.id ? null : r.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all
                  ${expandedRespondent === r.id
                    ? 'border-blue-400 bg-blue-50 text-blue-800'
                    : 'border-[#ECECEC] bg-white text-foreground hover:border-blue-300 hover:bg-blue-50/50'}`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold shrink-0">
                  {(r.name || r.id).slice(0, 2).toUpperCase()}
                </span>
                <span className="max-w-[120px] truncate">{r.name || r.id}</span>
                {r.segment && <span className="text-muted-foreground truncate max-w-[80px] hidden sm:block">· {r.segment}</span>}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {table1.respondents.map((r: Respondent) => (
              <div key={r.id} className="rounded-xl border border-[#ECECEC] bg-white overflow-hidden">
                <button
                  onClick={() => setExpandedRespondent(expandedRespondent === r.id ? null : r.id)}
                  className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-[#FAFAFA] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                      {(r.name || r.id).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{r.name || r.id}</p>
                      {r.segment && <p className="text-xs text-muted-foreground">{r.segment}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground/60 hidden sm:block">· {r.answers.length} ответов</span>
                  </div>
                  {expandedRespondent === r.id
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>

                {expandedRespondent === r.id && (
                  <div className="border-t border-[#F0F0F0] divide-y divide-[#F0F0F0]">
                    {r.answers.map((a, ai) => (
                      <div key={ai} className="p-3.5 space-y-2">
                        <div className="flex items-start gap-2 flex-wrap">
                          <span className={`inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded border ${BLOCK_COLORS[a.block] ?? BLOCK_COLORS.other}`}>
                            {BLOCK_LABELS[a.block] ?? a.block}
                          </span>
                          <p className="text-xs font-medium text-muted-foreground">{a.question}</p>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">{a.full_answer}</p>
                        {a.key_quotes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {a.key_quotes.map((q, qi) => (
                              <span key={qi} className="text-xs bg-yellow-50 text-yellow-800 border border-yellow-200 px-2 py-0.5 rounded-md font-medium">
                                «{q}»
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground/60 italic">Тон: {a.emotional_tone}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {step === 'table1' && (
            <Button onClick={saveToMaterials} className="bg-[#3A8A48] hover:bg-[#2E6E3A] text-white">
              <Save className="h-4 w-4 mr-2" />
              Сохранить в материалы
            </Button>
          )}
          {step === 'saving' && (
            <div className="rounded-xl border border-[#ECECEC] bg-white p-6 flex items-center gap-4">
              <Loader2 className="h-6 w-6 text-[#3A8A48] animate-spin shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Сохраняю в материалы...</p>
                <p className="text-xs text-muted-foreground mt-0.5">Расшифровка и таблица сохраняются в базу знаний</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Saved ── */}
      {step === 'saved' && (
        <div className="space-y-4">
          {/* Show the table read-only with chips */}
          {table1 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Таблица исследования</p>
                    <p className="text-xs text-muted-foreground">{table1.respondents.length} участников</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={exportTable1CSV} className="h-8 text-xs gap-1.5">
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>

              {/* Participants chips */}
              <div className="flex flex-wrap gap-2">
                {table1.respondents.map((r: Respondent) => (
                  <button
                    key={r.id}
                    onClick={() => setExpandedRespondent(expandedRespondent === r.id ? null : r.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all
                      ${expandedRespondent === r.id
                        ? 'border-blue-400 bg-blue-50 text-blue-800'
                        : 'border-[#ECECEC] bg-white text-foreground hover:border-blue-300 hover:bg-blue-50/50'}`}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold shrink-0">
                      {(r.name || r.id).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="max-w-[120px] truncate">{r.name || r.id}</span>
                    {r.segment && <span className="text-muted-foreground truncate max-w-[80px] hidden sm:block">· {r.segment}</span>}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {table1.respondents.map((r: Respondent) => (
                  <div key={r.id} className="rounded-xl border border-[#ECECEC] bg-white overflow-hidden">
                    <button
                      onClick={() => setExpandedRespondent(expandedRespondent === r.id ? null : r.id)}
                      className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-[#FAFAFA] transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                          {(r.name || r.id).slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{r.name || r.id}</p>
                          {r.segment && <p className="text-xs text-muted-foreground">{r.segment}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground/60 hidden sm:block">· {r.answers.length} ответов</span>
                      </div>
                      {expandedRespondent === r.id
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </button>

                    {expandedRespondent === r.id && (
                      <div className="border-t border-[#F0F0F0] divide-y divide-[#F0F0F0]">
                        {r.answers.map((a, ai) => (
                          <div key={ai} className="p-3.5 space-y-2">
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className={`inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded border ${BLOCK_COLORS[a.block] ?? BLOCK_COLORS.other}`}>
                                {BLOCK_LABELS[a.block] ?? a.block}
                              </span>
                              <p className="text-xs font-medium text-muted-foreground">{a.question}</p>
                            </div>
                            <p className="text-sm text-foreground leading-relaxed">{a.full_answer}</p>
                            {a.key_quotes.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {a.key_quotes.map((q, qi) => (
                                  <span key={qi} className="text-xs bg-yellow-50 text-yellow-800 border border-yellow-200 px-2 py-0.5 rounded-md font-medium">
                                    «{q}»
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="text-[10px] text-muted-foreground/60 italic">Тон: {a.emotional_tone}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Success message + actions */}
          <div className="rounded-xl border border-[#3A8A48]/20 bg-[#3A8A48]/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-[#3A8A48] mt-0.5 shrink-0" />
              <p className="text-sm text-[#2E6E3A]">
                Расшифровка и таблица исследования сохранены в материалы проекта. Теперь AI будет использовать данные этого интервью при генерации контента.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('upload')
                  setTranscription('')
                  setTranscriptionParts([])
                  setTable1(null)
                  setExpandedRespondent(null)
                  setSelectedFile(null)
                  setProgress(null)
                  setFileQueue([])
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Добавить ещё интервью
              </Button>
              <Button asChild className="bg-[#3A8A48] hover:bg-[#2E6E3A] text-white gap-2">
                <Link href={`/projects/${id}/knowledge`}>
                  <Sparkles className="h-4 w-4" />
                  Перейти к материалам
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────

function downloadCSV(rows: string[][], filename: string) {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
  const csv    = rows.map(r => r.map(escape).join(',')).join('\n')
  const blob   = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
