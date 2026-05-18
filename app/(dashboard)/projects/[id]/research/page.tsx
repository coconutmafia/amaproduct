'use client'

import { useState, useCallback, useRef, use } from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft, Upload, Mic, Loader2, ChevronDown, ChevronUp, Sparkles, Download, CheckCircle2, Users, FileText, Save, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { InterviewTable, Respondent } from '@/app/api/ai/research-analyze/route'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'transcribing' | 'transcribed' | 'analyzing1' | 'table1' | 'saving' | 'saved'

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
// ~4.5 MB body limit), and the API route fetches byte-ranges from there.
const CHUNK_BYTES = 24 * 1024 * 1024 // 24 MB

type ProgressState =
  | { stage: 'uploading';     fileIndex: number; totalFiles: number }
  | { stage: 'transcribing';  fileIndex: number; totalFiles: number; chunkIndex: number; totalChunks: number }

// ── Main component ────────────────────────────────────────────────────────────

export default function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [step, setStep]               = useState<Step>('upload')
  const [transcription, setTranscription] = useState('')
  const [table1, setTable1]           = useState<InterviewTable | null>(null)
  const [expandedRespondent, setExpandedRespondent] = useState<string | null>(null)
  const [isDragging, setIsDragging]   = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ name: string; sizeMb: string; estMin: string } | null>(null)
  // tracks both upload stage (to Supabase Storage) and transcription stage (chunks → Whisper)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  // shown while waiting for iCloud to finish downloading a file
  const [icloudWait, setIcloudWait] = useState<{ name: string; attempt: number; max: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Transcription ───────────────────────────────────────────────────────────
  // Uses file.slice() — a lazy Blob that lets iOS download iCloud files on
  // demand when fetch() reads it. No FileReader, no ArrayBuffer intermediary.
  // Files > CHUNK_BYTES are split and sent sequentially.

  const transcribeFiles = useCallback(async (files: File[]) => {
    setStep('transcribing')
    setProgress(null)
    setIcloudWait(null)

    const supabase     = createSupabaseClient()
    const allParts:    string[] = []
    const uploadedPaths: string[] = []

    try {
      // Verify session is active (the upload-url route does the real auth check)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Войди в систему, чтобы загрузить файл')

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]

        // Read metadata safely (may throw on iOS iCloud stubs)
        let fileName = `файл ${fi + 1}`
        let fileSize = 0
        try { fileName = file.name } catch { /* iCloud stub */ }
        try { fileSize = file.size } catch { /* iCloud stub */ }

        const rawExt = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
        const ext    = rawExt || 'mp3'

        // ── Step 1: upload to Supabase Storage via signed URL ───────────────
        // The server issues a one-time signed upload URL (no RLS needed).
        // The browser PUTs the file directly to Supabase — completely bypasses
        // Vercel's ~4.5 MB request-body limit.  On iOS, reading the File also
        // triggers an iCloud download automatically.
        setProgress({ stage: 'uploading', fileIndex: fi + 1, totalFiles: files.length })

        // 1a. Ask server for a signed upload URL
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

        // 1b. Upload directly to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('audio-temp')
          .uploadToSignedUrl(storagePath, uploadToken, file)

        if (uploadError) throw new Error(`Ошибка загрузки: ${uploadError.message}`)
        uploadedPaths.push(storagePath)

        // Resolve actual file size — needed for chunking.
        // If the File was an iCloud stub (size === 0) get the real size via HEAD.
        let actualSize = fileSize
        if (actualSize === 0) {
          const { data: sd } = await supabase.storage.from('audio-temp').createSignedUrl(storagePath, 60)
          if (sd?.signedUrl) {
            const hd = await fetch(sd.signedUrl, { method: 'HEAD' })
            actualSize = parseInt(hd.headers.get('content-length') ?? '0', 10)
          }
        }

        // ── Step 2: transcribe in 24 MB chunks via the API ──────────────────
        const totalChunks = actualSize > 0 ? Math.ceil(actualSize / CHUNK_BYTES) : 1

        for (let ci = 0; ci < totalChunks; ci++) {
          setProgress({ stage: 'transcribing', fileIndex: fi + 1, totalFiles: files.length, chunkIndex: ci + 1, totalChunks })

          const start = ci * CHUNK_BYTES
          const end   = actualSize > 0 ? Math.min(start + CHUNK_BYTES, actualSize) : undefined

          // Small JSON payload — well under any request-body limit.
          // The route fetches the byte-range from Supabase Storage directly.
          const isLastChunk = ci === totalChunks - 1
          const res  = await fetch('/api/ai/transcribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ storagePath, start, end, ext, isLastChunk }),
          })
          const bodyText = await res.text()
          let data: { text?: string; error?: string }
          try { data = JSON.parse(bodyText) as { text?: string; error?: string } }
          catch { throw new Error(`Сервер вернул ошибку ${res.status}. Попробуй ещё раз.`) }
          if (!res.ok || data.error) throw new Error(data.error ?? `Файл ${fi + 1}, часть ${ci + 1}: ошибка`)
          allParts.push(data.text ?? '')
        }
      }

      setTranscription(allParts.join('\n\n'))
      setProgress(null)
      setStep('transcribed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка расшифровки')
      setStep('upload')
      setProgress(null)
      setIcloudWait(null)
    } finally {
      // Always remove the temporary storage files, even on error
      if (uploadedPaths.length > 0) {
        await supabase.storage.from('audio-temp').remove(uploadedPaths).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFiles = useCallback((fileList: FileList) => {
    const count = fileList.length
    if (count === 0) return
    setSelectedFile({ name: count === 1 ? 'файл выбран' : `${count} файлов выбрано`, sizeMb: '…', estMin: '…' })
    const files = Array.from(fileList)
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
      toast.error(err instanceof Error ? err.message : 'Ошибка при перетаскивании файлов')
    }
  }, [handleFiles])

  // ── Analysis Step 1: → Table 1 ─────────────────────────────────────────────
  const analyzeTable1 = useCallback(async () => {
    setStep('analyzing1')
    try {
      const res  = await fetch('/api/ai/research-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: id, step: 'table1', transcription }),
      })
      const data = await res.json() as { table1?: InterviewTable; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Analysis failed')
      setTable1(data.table1 ?? null)
      setStep('table1')
      setExpandedRespondent(data.table1?.respondents[0]?.id ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка анализа')
      setStep('transcribed')
    }
  }, [id, transcription])

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
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения')
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
          { label: 'Таблица 1',    done: ['saving', 'saved'].includes(step) },
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
                <div className="space-y-2 w-full max-w-xs">
                  <p className="font-semibold text-foreground text-center">
                    {icloudWait
                      ? `☁️ Загружаю из iCloud...`
                      : progress?.stage === 'uploading'
                      ? progress.totalFiles > 1
                        ? `Загружаю файл ${progress.fileIndex} из ${progress.totalFiles}...`
                        : 'Загружаю файл...'
                      : progress?.stage === 'transcribing'
                      ? progress.totalFiles > 1
                        ? `Файл ${progress.fileIndex} из ${progress.totalFiles}${progress.totalChunks > 1 ? ` · часть ${progress.chunkIndex}/${progress.totalChunks}` : ''}...`
                        : progress.totalChunks > 1
                        ? `Расшифровываю часть ${progress.chunkIndex} из ${progress.totalChunks}...`
                        : 'Расшифровываю аудио...'
                      : 'Расшифровываю аудио...'}
                  </p>
                  {icloudWait && (
                    <p className="text-sm text-muted-foreground text-center">«{icloudWait.name}»</p>
                  )}
                  {!icloudWait && selectedFile && (
                    <p className="text-sm text-[#3A8A48] font-medium text-center">{selectedFile.name} · {selectedFile.sizeMb} МБ · {selectedFile.estMin}</p>
                  )}
                  {/* Overall progress bar */}
                  {progress?.stage === 'uploading' && (
                    <div className="w-full h-1.5 rounded-full bg-[#3A8A48]/15 overflow-hidden">
                      <div className="h-full rounded-full bg-[#3A8A48]/50 animate-pulse" style={{ width: '100%' }} />
                    </div>
                  )}
                  {progress?.stage === 'transcribing' && (progress.totalFiles > 1 || progress.totalChunks > 1) && (() => {
                    const done = (progress.fileIndex - 1) / progress.totalFiles
                    const cur  = (progress.chunkIndex / progress.totalChunks) / progress.totalFiles
                    return (
                      <div className="w-full h-1.5 rounded-full bg-[#3A8A48]/15 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#3A8A48] transition-all duration-500"
                          style={{ width: `${Math.round((done + cur) * 100)}%` }}
                        />
                      </div>
                    )
                  })()}
                  <p className="text-sm text-muted-foreground text-center">
                    {icloudWait
                      ? `iOS скачивает файл из iCloud — подожди (${icloudWait.attempt}/${icloudWait.max})`
                      : progress?.stage === 'uploading'
                      ? 'Загружаю файл — не закрывай страницу'
                      : progress?.stage === 'transcribing' && (progress.totalFiles > 1 || progress.totalChunks > 1)
                      ? 'Не закрывай страницу — это займёт несколько минут'
                      : selectedFile && parseInt(selectedFile.estMin) >= 10
                      ? 'Для длинных записей это может занять несколько минут — не закрывай страницу'
                      : 'Обычно 1–3 минуты — не закрывай страницу'}
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

      {/* ── Step: Analyzing Table 1 ── */}
      {step === 'analyzing1' && (
        <div className="rounded-xl border border-[#ECECEC] bg-white p-8 flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 text-[#3A8A48] animate-spin" />
          <div>
            <p className="font-semibold text-foreground">Анализирую интервью...</p>
            <p className="text-sm text-muted-foreground mt-1">Определяю участников, вопросы, цитаты и эмоциональные тоны</p>
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
                <p className="text-sm font-bold text-foreground">Таблица 1 — Расшифровка интервью</p>
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
                    <p className="text-sm font-bold text-foreground">Таблица 1 — Расшифровка интервью</p>
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
                  setTable1(null)
                  setExpandedRespondent(null)
                  setSelectedFile(null)
                  setProgress(null)
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
