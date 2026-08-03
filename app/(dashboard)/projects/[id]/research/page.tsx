'use client'

import { useState, useCallback, useEffect, useRef, use } from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/friendlyError'
import { isDefinitelyNotMedia, NOT_MEDIA_MESSAGE } from '@/lib/media/notMedia'
import Link from 'next/link'
import { ArrowLeft, Upload, Mic, Loader2, ChevronDown, ChevronUp, Sparkles, Download, CheckCircle2, Users, FileText, Save, Plus, X, Circle, RefreshCw } from 'lucide-react'
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
  jobId?:      string  // серверный джоб этого файла — нужен для «Повторить»
  retryable?:  boolean // сервер сказал: причина временная, повтор продолжит с места обрыва
}

const BLOCK_LABELS: Record<string, string> = {
  point_a:   'Точка А',
  point_b:   'Точка Б',
  barriers:  'Барьеры',
  criteria:  'Критерии',
  other:     'Прочее',
}

// ── Черновик исследования в localStorage ─────────────────────────────────────
// «Не было ошибки, просто сбрасывает и снова начинать с начала» (клиент,
// 31 июля): телефон выгружает вкладку во время долгой расшифровки/таблицы,
// перезагрузка стирала ВСЁ состояние страницы — при живом серверном джобе.
// Черновик хранит текст/таблицу/живые джобы; при открытии страница
// восстанавливает шаг и ДОГОНЯЕТ недоделанные джобы поллингом.
type ResearchDraft = {
  transcription?: string
  transcriptionParts?: { name: string; text: string }[]
  transcriptMaterialIds?: string[]
  table1?: InterviewTable | null
  activeJobs?: { jobId: string; name: string }[]
  // Недоделанный анализ таблицы: готовые батчи переживают выгрузку вкладки
  // и падение одного батча — продолжаем с nextBatch, а не с нуля (батч = деньги
  // и минуты). fp привязывает прогресс к конкретной расшифровке.
  analysisPartial?: {
    respondents: Respondent[]
    nextBatch: number
    totalBatches: number
    fp: string
  } | null
}
function readDraft(key: string): ResearchDraft | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as ResearchDraft : null } catch { return null }
}
function patchDraft(key: string, patch: Partial<ResearchDraft>) {
  try { localStorage.setItem(key, JSON.stringify({ ...(readDraft(key) ?? {}), ...patch })) } catch { /* квота/приватный режим — не мешаем работе */ }
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
// Ошибка джоба с довеском: можно ли продолжить с места обрыва («Повторить»).
export type TranscribeJobError = Error & { retryable?: boolean }

function pollTranscribeJob(
  jobId: string,
  onProgress: (doneChunks: number, totalChunks: number | null) => void,
): Promise<{ text: string; materialId: string | null }> {
  let consecutiveFailures = 0
  const MAX_CONSECUTIVE_FAILURES = 30 // ~2 min of nothing-but-errors → genuinely give up
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        const body = await res.json() as {
          job?: { status: string; progress?: { doneChunks?: number; totalChunks?: number | null }; result?: { text?: string; materialId?: string | null; retryable?: boolean }; error?: string }
          error?: string
        }
        if (!res.ok || !body.job) { reject(new Error(body.error ?? 'Не удалось получить статус расшифровки')); return }
        consecutiveFailures = 0
        const { status, progress, result, error } = body.job
        onProgress(progress?.doneChunks ?? 0, progress?.totalChunks ?? null)
        if (status === 'done') { resolve({ text: result?.text ?? '', materialId: result?.materialId ?? null }); return }
        if (status === 'error') {
          const e: TranscribeJobError = new Error(error ?? 'Ошибка расшифровки')
          e.retryable = result?.retryable === true
          reject(e)
          return
        }
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
  // Материалы расшифровок, уже сохранённые transcribe-джобом (по одному на
  // файл) — save-шаг переиспользует их и не создаёт дубль.
  const [transcriptMaterialIds, setTranscriptMaterialIds] = useState<string[]>([])
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

  // Черновик (см. ResearchDraft выше): восстановление после выгрузки вкладки.
  const draftKey = `ama_research_${id}`
  const restoredRef = useRef(false)

  const resumeJobs = useCallback(async (
    jobs: { jobId: string; name: string }[],
    priorParts: { name: string; text: string }[],
    priorIds: string[],
  ) => {
    setStep('transcribing')
    setFileQueue(jobs.map(j => ({ name: j.name, status: 'transcribing' as const, jobId: j.jobId })))
    const allParts = [...priorParts]
    const ids = [...priorIds]
    const errors: string[] = []
    for (let i = 0; i < jobs.length; i++) {
      try {
        const { text, materialId } = await pollTranscribeJob(jobs[i].jobId, (done, total) => {
          setFileQueue(prev => prev.map((f, fi) => fi === i ? { ...f, chunkIndex: done, totalChunks: total ?? done } : f))
        })
        allParts.push({ name: jobs[i].name, text })
        if (materialId) ids.push(materialId)
        setFileQueue(prev => prev.map((f, fi) => fi === i ? { ...f, status: 'done' as const } : f))
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка расшифровки'
        errors.push(msg)
        const retryable = (e as TranscribeJobError).retryable === true
        setFileQueue(prev => prev.map((f, fi) => fi === i ? { ...f, status: 'error' as const, error: msg, retryable } : f))
      }
      patchDraft(draftKey, { transcriptionParts: allParts, transcriptMaterialIds: ids, activeJobs: jobs.slice(i + 1) })
    }
    patchDraft(draftKey, { activeJobs: [] })
    if (allParts.length > 0) {
      setTranscriptionParts(allParts)
      setTranscriptMaterialIds(ids)
      setTranscription(allParts.map(p => p.text).join('\n\n'))
      setStep('transcribed')
      if (errors.length) toast.error(`Часть файлов не расшифровалась: ${friendlyUploadError(errors[0])}`)
    } else {
      setStep('upload')
      if (errors.length) toast.error(friendlyUploadError(errors[0]))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // Восстановление при открытии страницы: незаконченный шаг + догон живых джобов.
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const d = readDraft(draftKey)
    if (!d) return
    if (d.transcriptionParts?.length) setTranscriptionParts(d.transcriptionParts)
    if (d.transcriptMaterialIds?.length) setTranscriptMaterialIds(d.transcriptMaterialIds)
    if (d.transcription) setTranscription(d.transcription)
    if (d.table1) setTable1(d.table1)
    if (d.activeJobs?.length) {
      toast.message('Расшифровка шла на сервере, пока страница была закрыта — догоняю…')
      void resumeJobs(d.activeJobs, d.transcriptionParts ?? [], d.transcriptMaterialIds ?? [])
    } else if (d.table1) {
      setStep('table1')
      toast.message('Восстановил незаконченное исследование — таблица на месте')
    } else if (d.transcription) {
      setStep('transcribed')
      if (d.analysisPartial && d.analysisPartial.nextBatch < d.analysisPartial.totalBatches) {
        toast.message(`Анализ прервался на части ${d.analysisPartial.nextBatch + 1} из ${d.analysisPartial.totalBatches} — нажми «Создать таблицу исследования», продолжу с того же места`)
      } else {
        toast.message('Восстановил расшифровку — продолжай с того же места')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Автосохранение черновика; после «Сохранено» черновик больше не нужен.
  useEffect(() => {
    if (step === 'saved') { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } return }
    if (!transcription && !table1 && transcriptionParts.length === 0) return
    patchDraft(draftKey, { transcription, transcriptionParts, transcriptMaterialIds, table1 })
  }, [step, transcription, transcriptionParts, transcriptMaterialIds, table1, draftKey])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Transcription ───────────────────────────────────────────────────────────
  // Uses file.slice() — a lazy Blob that lets iOS download iCloud files on
  // demand when fetch() reads it. No FileReader, no ArrayBuffer intermediary.
  // Long files are split into time windows and sent sequentially.

  const transcribeFiles = useCallback(async (files: File[]) => {
    setStep('transcribing')
    setProgress(null)
    setIcloudWait(null)
    setTranscriptMaterialIds([]) // новая партия файлов — прежние id не наши
    patchDraft(draftKey, { transcription: '', transcriptionParts: [], transcriptMaterialIds: [], table1: null, activeJobs: [], analysisPartial: null })

    const supabase  = createSupabaseClient()
    const allParts: { name: string; text: string }[] = []
    const runIds: string[] = [] // materialId по каждому файлу — для черновика и save
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

    // ── ФАЗА 1: залить ВСЕ файлы и стартовать ВСЕ джобы, поллинг потом ────────
    // Раньше файлы шли строго по одному (upload₁ → джоб₁ до конца → upload₂ …):
    // умри вкладка на первом часовом интервью — остальные файлы даже не начаты
    // и молча теряются. Теперь заливки короткие и идут подряд, а расшифровки
    // крутятся на сервере ПАРАЛЛЕЛЬНО; после старта последнего джоба вкладка
    // больше ничего не держит — все джобы в черновике, resumeJobs их догонит.
    const started: { fi: number; jobId: string; name: string }[] = []
    for (let fi = 0; fi < files.length; fi++) {
      const uploadedPaths: string[] = []
      try {
        const file = files[fi]
        const fileName = initNames[fi]

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

        // ── 2. Старт фонового джоба (roadmap #8): сервер сам доведёт до конца
        // (само-продолжение через after()), клиент только поллит статус.
        const durationSec = await getAudioDuration(file)

        const startRes = await fetch('/api/jobs/transcribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          // saveTranscriptMaterial: расшифровка ложится в материалы сразу по
          // готовности джоба — не зависит от успеха шага таблицы (урок 31 июля).
          body:    JSON.stringify({ projectId: id, storagePath, ext, durationSec: durationSec > 0 ? durationSec : undefined, saveTranscriptMaterial: true }),
        })
        const startBody = await startRes.json() as { jobId?: string; error?: string }
        if (!startRes.ok || startBody.error || !startBody.jobId) {
          throw new Error(startBody.error ?? 'Не удалось запустить расшифровку')
        }

        // Джоб — в черновик СРАЗУ: умри вкладка сейчас, при возврате страница
        // его догонит (resumeJobs), а не начнёт с нуля.
        patchDraft(draftKey, { activeJobs: [...(readDraft(draftKey)?.activeJobs ?? []), { jobId: startBody.jobId, name: fileName }] })
        started.push({ fi, jobId: startBody.jobId, name: fileName })
        updateFile(fi, { status: 'transcribing', jobId: startBody.jobId })
      } catch (err) {
        // Файл не дошёл до старта джоба — помечаем и продолжаем с остальными.
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка'
        fileErrors.push(msg)
        updateFile(fi, { status: 'error', error: msg })
        // Залитый, но не пригодившийся файл подчищаем; файлы СО стартовавшим
        // джобом не трогаем — их жизненным циклом управляет сам джоб (и
        // «Повторить» им нужен файл на месте).
        if (uploadedPaths.length > 0) {
          await supabase.storage.from('audio-temp').remove(uploadedPaths).catch(() => {})
        }
      }
    }

    // ── ФАЗА 2: параллельный поллинг всех джобов, сборка в порядке файлов ────
    const results = await Promise.all(started.map(s =>
      pollTranscribeJob(s.jobId, (doneChunks, totalChunks) => {
        updateFile(s.fi, { status: 'transcribing', chunkIndex: doneChunks, totalChunks: totalChunks ?? doneChunks })
      })
        .then(r => ({ s, ok: true as const, text: r.text, materialId: r.materialId }))
        .catch((e: unknown) => ({
          s,
          ok: false as const,
          error: e instanceof Error ? e.message : 'Ошибка расшифровки',
          retryable: (e as TranscribeJobError).retryable === true,
        }))
    ))

    for (const r of results) { // порядок results = порядок started = порядок файлов
      if (r.ok) {
        allParts.push({ name: r.s.name, text: r.text })
        if (r.materialId) runIds.push(r.materialId)
        updateFile(r.s.fi, { status: 'done' })
      } else {
        fileErrors.push(r.error)
        updateFile(r.s.fi, { status: 'error', error: r.error, retryable: r.retryable })
      }
    }
    patchDraft(draftKey, { transcriptionParts: allParts, transcriptMaterialIds: runIds, activeJobs: [] })

    setProgress(null)

    if (allParts.length > 0) {
      setTranscriptionParts(allParts)
      setTranscriptMaterialIds(runIds)
      setTranscription(allParts.map(p => p.text).join('\n\n'))
      setStep('transcribed')
      if (fileErrors.length > 0) {
        toast.error(`Часть файлов не расшифровалась: ${friendlyUploadError(fileErrors[0])}`)
      }
    } else {
      // Показываем НАСТОЯЩУЮ причину (квота / формат / пустая заглушка iCloud),
      // но через фильтр от технических хвостов — сырец и так уходит в Sentry.
      const reason = [...new Set(fileErrors)].map(e => friendlyUploadError(e)).join('; ').slice(0, 300)
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

  // ── Повтор упавшего файла: продолжить джоб с места обрыва ────────────────────
  // Кнопка появляется у файла со статусом error, когда сервер сказал, что
  // причина временная (retryable) — файл остался в хранилище, прогресс в джобе.
  const retryFile = useCallback(async (fi: number) => {
    const f = fileQueue[fi]
    if (!f?.jobId) return
    setFileQueue(prev => prev.map((s, i) => i === fi ? { ...s, status: 'transcribing', error: undefined } : s))
    try {
      const res = await fetch('/api/jobs/transcribe/retry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId: f.jobId }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) throw new Error(body.error ?? 'Не удалось перезапустить расшифровку')

      // Живой джоб — обратно в черновик: выгрузка вкладки во время повтора
      // не страшна, resumeJobs догонит.
      patchDraft(draftKey, { activeJobs: [...(readDraft(draftKey)?.activeJobs ?? []).filter(j => j.jobId !== f.jobId), { jobId: f.jobId, name: f.name }] })

      const { text, materialId } = await pollTranscribeJob(f.jobId, (done, total) => {
        setFileQueue(prev => prev.map((s, i) => i === fi ? { ...s, chunkIndex: done, totalChunks: total ?? done } : s))
      })

      setFileQueue(prev => prev.map((s, i) => i === fi ? { ...s, status: 'done' } : s))
      // Дозаписываем часть в конец (позиция «как загружалось» уже потеряна —
      // спасение важнее порядка). Черновик обновится автосейвом.
      setTranscriptionParts(prev => {
        const next = [...prev, { name: f.name, text }]
        setTranscription(next.map(p => p.text).join('\n\n'))
        return next
      })
      if (materialId) setTranscriptMaterialIds(prev => [...prev, materialId])
      patchDraft(draftKey, { activeJobs: (readDraft(draftKey)?.activeJobs ?? []).filter(j => j.jobId !== f.jobId), analysisPartial: null })
      setStep(s => (s === 'upload' || s === 'transcribing') ? 'transcribed' : s)
      toast.success(`«${f.name}» дорасшифрован`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка расшифровки'
      const retryable = (e as TranscribeJobError).retryable === true
      patchDraft(draftKey, { activeJobs: (readDraft(draftKey)?.activeJobs ?? []).filter(j => j.jobId !== f.jobId) })
      setFileQueue(prev => prev.map((s, i) => i === fi ? { ...s, status: 'error', error: msg, retryable } : s))
      toast.error(friendlyUploadError(msg))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileQueue, draftKey])

  // ── Analysis: batch by 3 files to stay within AI output token limit ──────────
  // With many files the combined transcription can produce 10-15 respondents,
  // which requires 15-20K output tokens — more than the model's 8K cap.
  // Processing 3 files at a time keeps output comfortably under the limit.
  // Готовые батчи копятся в черновике (analysisPartial): упал батч 4 из 5 или
  // телефон выгрузил вкладку — следующий запуск продолжит с места обрыва,
  // а не пересчитает (и не переоплатит) всё заново.
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

      // Отпечаток расшифровки: прогресс прошлого анализа валиден только для
      // того же самого текста.
      const fp = `${parts.length}:${parts.reduce((n, p) => n + p.text.length, 0)}`
      const saved = readDraft(draftKey)?.analysisPartial
      const allRespondents: Respondent[] = []
      let startBatch = 0
      if (saved && saved.fp === fp && saved.nextBatch > 0 && Array.isArray(saved.respondents)) {
        if (saved.nextBatch >= batches.length) {
          // Все батчи уже посчитаны (вкладка умерла между последним батчем и
          // показом таблицы) — собираем таблицу из черновика без единого вызова.
          patchDraft(draftKey, { analysisPartial: null })
          setTable1({ respondents: saved.respondents })
          setAnalysisBatch(null)
          setStep('table1')
          setExpandedRespondent(saved.respondents[0]?.id ?? null)
          return
        }
        allRespondents.push(...saved.respondents)
        startBatch = saved.nextBatch
        toast.message(`Продолжаю анализ с части ${startBatch + 1} из ${batches.length}`)
      }
      setAnalysisBatch({ current: startBatch, total: batches.length })

      for (let bi = startBatch; bi < batches.length; bi++) {
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
        patchDraft(draftKey, { analysisPartial: { respondents: allRespondents, nextBatch: bi + 1, totalBatches: batches.length, fp } })
      }

      patchDraft(draftKey, { analysisPartial: null })
      const combined: InterviewTable = { respondents: allRespondents }
      setTable1(combined)
      setAnalysisBatch(null)
      setStep('table1')
      setExpandedRespondent(allRespondents[0]?.id ?? null)
    } catch (err) {
      const partial = readDraft(draftKey)?.analysisPartial
      const suffix = partial && partial.nextBatch > 0 && partial.nextBatch < partial.totalBatches
        ? ` Готовые части (${partial.nextBatch} из ${partial.totalBatches}) сохранены — нажми ещё раз, продолжу с места обрыва.`
        : ''
      toast.error(friendlyError(err, 'Ошибка анализа') + suffix)
      setAnalysisBatch(null)
      setStep('transcribed')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, transcription, transcriptionParts, draftKey])

  // ── Save to materials ───────────────────────────────────────────────────────
  const saveToMaterials = useCallback(async () => {
    if (!table1) return
    setStep('saving')
    try {
      const res = await fetch('/api/ai/research-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: id, step: 'save', transcription, table1, transcriptMaterialIds }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Save failed')
      setStep('saved')
    } catch (err) {
      toast.error(friendlyError(err, 'Ошибка сохранения'))
      setStep('table1')
    }
  }, [id, transcription, table1, transcriptMaterialIds])

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
                          {f.status === 'error' && f.retryable && f.jobId && (
                            <button
                              type="button"
                              onClick={() => retryFile(i)}
                              className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-white text-[11px] font-medium text-red-700 hover:bg-red-50 transition-colors"
                            >
                              <RefreshCw className="h-3 w-3" /> Повторить — продолжу с места обрыва
                            </button>
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

                  <p className="text-xs text-muted-foreground text-center">
                    {fileQueue.some(f => f.status === 'pending' || f.status === 'uploading')
                      ? 'Идёт отправка файлов — не закрывай вкладку, пока файлы не отправятся на сервер'
                      : 'Расшифровка идёт на сервере — можно заблокировать экран и даже закрыть вкладку: вернёшься сюда, и всё догонится'}
                  </p>
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
                {/* Limit hint — цифра из env, как и сама проверка (не хардкод) */}
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
                  <span>⏱ До {MAX_AUDIO_MB} МБ (≈ {MAX_AUDIO_MB} минут MP3)</span>
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

      {/* ── Упавшие файлы: остаются видимыми и ПОСЛЕ ухода с экрана очереди ──
          Раньше при частичном успехе очередь исчезала вместе с ошибками — файл
          с временной ошибкой (перегруз/кредиты) нельзя было повторить, только
          перезаливать. Теперь ошибка живёт здесь до повтора или новой партии. */}
      {(step === 'upload' || step === 'transcribed') && fileQueue.some(f => f.status === 'error' || f.status === 'transcribing') && (
        <div className="space-y-1.5">
          {fileQueue.map((f, i) => f.status === 'error' ? (
            <div key={i} className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs text-left">
              <div className="flex items-center gap-2">
                <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <span className="flex-1 truncate font-medium text-foreground">{f.name}</span>
                <span className="shrink-0 text-[11px] text-red-600">Ошибка</span>
              </div>
              {f.error && (
                <p className="mt-1.5 text-[11px] text-red-600 leading-snug break-words">
                  {friendlyUploadError(f.error)}
                </p>
              )}
              {f.retryable && f.jobId && (
                <button
                  type="button"
                  onClick={() => retryFile(i)}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-white text-[11px] font-medium text-red-700 hover:bg-red-50 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" /> Повторить — продолжу с места обрыва
                </button>
              )}
            </div>
          ) : f.status === 'transcribing' ? (
            <div key={i} className="px-3 py-2 rounded-lg border border-[#3A8A48]/25 bg-[#3A8A48]/5 text-xs text-left">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3A8A48] shrink-0" />
                <span className="flex-1 truncate font-medium text-foreground">{f.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {f.totalChunks && f.totalChunks > 1 ? `Часть ${f.chunkIndex}/${f.totalChunks}` : 'Дорасшифровываю...'}
                </span>
              </div>
            </div>
          ) : null)}
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
