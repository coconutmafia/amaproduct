'use client'

import { useState, useCallback, useRef, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Mic, Loader2, ChevronDown, ChevronUp, Sparkles, Download, CheckCircle2, Users, Map, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { InterviewTable, MeaningsMap, Respondent, MeaningsCategory } from '@/app/api/ai/research-analyze/route'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'transcribing' | 'transcribed' | 'analyzing1' | 'table1' | 'analyzing2' | 'done'

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

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  pain:      { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-800',    badge: 'bg-red-100 text-red-700' },
  need:      { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  badge: 'bg-green-100 text-green-700' },
  trigger:   { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
  objection: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700' },
}

const TYPE_LABELS: Record<string, string> = {
  pain: 'Боль', need: 'Потребность', trigger: 'Триггер', objection: 'Возражение',
}

// Whisper API hard limit is 25 MB per request.
// For larger files the client slices into ≤23 MB byte chunks and sends each
// sequentially, then concatenates the transcripts.
const CHUNK_BYTES = 23 * 1024 * 1024 // 23 MB — safely under Whisper's 25 MB limit

// ── Main component ────────────────────────────────────────────────────────────

export default function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [step, setStep]               = useState<Step>('upload')
  const [transcription, setTranscription] = useState('')
  const [table1, setTable1]           = useState<InterviewTable | null>(null)
  const [table2, setTable2]           = useState<MeaningsMap | null>(null)
  const [expandedRespondent, setExpandedRespondent] = useState<string | null>(null)
  const [isDragging, setIsDragging]   = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ name: string; sizeMb: string; estMin: string } | null>(null)
  // fileIndex/totalFiles track which file we're on; chunkIndex/totalChunks track byte-chunks within that file
  const [progress, setProgress] = useState<{ fileIndex: number; totalFiles: number; chunkIndex: number; totalChunks: number } | null>(null)
  // shown while waiting for iCloud to finish downloading a file
  const [icloudWait, setIcloudWait] = useState<{ name: string; attempt: number; max: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Transcription ───────────────────────────────────────────────────────────
  // Accepts multiple files — transcribes sequentially and concatenates results.
  // Files >23 MB are byte-split into chunks (Whisper's 25 MB hard limit).
  //
  // iOS / iCloud: File objects may be cloud-only (not downloaded yet).
  // We retry arrayBuffer() up to ICLOUD_MAX_ATTEMPTS times with a delay —
  // iOS downloads the file in the background after the user picks it, so
  // retrying is enough to let it finish.
  const ICLOUD_MAX_ATTEMPTS = 15  // up to ~60 s of waiting (4 s × 15)
  const ICLOUD_RETRY_MS     = 4000

  // iOS sometimes returns UTI strings (e.g. 'dyn.ah62d4rv4ge81g3py') instead of
  // proper MIME types for iCloud files. Passing a UTI to new File({type}) causes
  // WebKit to throw 'The string did not match the expected pattern.'
  // This helper ensures only valid MIME types are used.
  const safeMime = (raw: string): string =>
    /^[a-zA-Z][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/.test(raw)
      ? raw
      : 'audio/mpeg'

  const transcribeFiles = useCallback(async (files: File[]) => {
    setStep('transcribing')
    setProgress(null)
    setIcloudWait(null)
    const allParts: string[] = []

    try {
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]

        // ── Materialise with iCloud retry ────────────────────────────────────
        // On iOS, File objects (especially from iCloud Drive) may be lazy
        // placeholders — even .name/.type/.size can throw before the file is
        // ready. We wrap the entire read (including property access) in a
        // retry loop so iOS has time to download the file in the background.
        let bytes:    ArrayBuffer | null = null
        let fileName: string            = `файл ${fi + 1}`
        let fileType: string            = 'audio/mpeg'

        for (let attempt = 1; attempt <= ICLOUD_MAX_ATTEMPTS; attempt++) {
          try {
            bytes    = await file.arrayBuffer()    // triggers iCloud download
            fileName = file.name                   // safe to read after success
            fileType = safeMime(file.type || '')
            break
          } catch {
            if (attempt < ICLOUD_MAX_ATTEMPTS) {
              // Show current file label — use index until name is readable
              let label = `файл ${fi + 1}`
              try { label = file.name } catch { /* still not ready */ }
              setIcloudWait({ name: label, attempt, max: ICLOUD_MAX_ATTEMPTS })
              await new Promise(r => setTimeout(r, ICLOUD_RETRY_MS))
            }
          }
        }
        setIcloudWait(null)

        if (!bytes) {
          throw new Error(`«${fileName}» не удалось загрузить. Открой приложение «Файлы», дождись загрузки и попробуй снова.`)
        }

        // ── Validate size after materialisation ───────────────────────────────
        const MAX_BYTES = 100 * 1024 * 1024
        if (bytes.byteLength > MAX_BYTES) {
          throw new Error(`«${fileName}» слишком большой (${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ) — максимум 100 МБ на файл`)
        }

        const ext         = fileName.split('.').pop()?.toLowerCase() ?? 'mp3'
        const mime        = safeMime(fileType)   // guaranteed valid MIME
        const blob        = new Blob([bytes], { type: mime })
        const totalChunks = Math.ceil(blob.size / CHUNK_BYTES)

        for (let ci = 0; ci < totalChunks; ci++) {
          setProgress({ fileIndex: fi + 1, totalFiles: files.length, chunkIndex: ci + 1, totalChunks })
          const start = ci * CHUNK_BYTES
          const end   = Math.min(start + CHUNK_BYTES, blob.size)
          // Use blob.slice (not new File) — avoids WebKit DOMException on iOS
          const chunkBlob = blob.slice(start, end, mime)

          const fd   = new FormData()
          fd.append('audio', chunkBlob, `chunk_${ci + 1}.${ext}`)
          const res  = await fetch('/api/ai/transcribe', { method: 'POST', body: fd })
          const data = await res.json() as { text?: string; error?: string }
          if (!res.ok || data.error) throw new Error(data.error ?? `Файл ${fi + 1}, часть ${ci + 1}: ошибка`)
          allParts.push(data.text ?? '')
        }
      }

      setTranscription(allParts.join('\n\n'))
      setProgress(null)
      setStep('transcribed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('did not match the expected pattern')) {
        toast.error('Не удалось прочитать аудиофайл. Попробуй скачать файл в приложение «Файлы» и загрузить оттуда.')
      } else {
        toast.error(msg || 'Ошибка расшифровки')
      }
      setStep('upload')
      setProgress(null)
      setIcloudWait(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // handleFiles: receives FileList directly — no Array.from, no property access.
  // All file reading happens lazily inside transcribeFiles with iCloud retry.
  const handleFiles = useCallback((fileList: FileList) => {
    const count = fileList.length
    if (count === 0) return
    setSelectedFile({ name: count === 1 ? 'файл выбран' : `${count} файлов выбрано`, sizeMb: '…', estMin: '…' })
    // Build a plain array by index access — deferred inside transcribeFiles
    const files: File[] = []
    for (let i = 0; i < count; i++) {
      try { const f = fileList.item(i); if (f) files.push(f) } catch { /* skip */ }
    }
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

  // ── Analysis Step 2: → Meanings Map ────────────────────────────────────────
  const analyzeTable2 = useCallback(async () => {
    if (!table1) return
    setStep('analyzing2')
    try {
      const res  = await fetch('/api/ai/research-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: id, step: 'table2', table1 }),
      })
      const data = await res.json() as { table2?: MeaningsMap; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Mapping failed')
      setTable2(data.table2 ?? null)
      setStep('done')
      toast.success('Карта смыслов сохранена в материалы проекта')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания карты')
      setStep('table1')
    }
  }, [id, table1])

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

  const exportTable2CSV = useCallback(() => {
    if (!table2) return
    const rows: string[][] = [['Тип', 'Категория', 'Формулировки клиентов', 'Глубинный триггер', 'Возражение', 'Идея контента']]
    for (const c of table2.categories) {
      rows.push([TYPE_LABELS[c.type] ?? c.type, c.category, c.customer_words.join(' | '), c.deep_trigger, c.objection, c.content_idea])
    }
    downloadCSV(rows, 'meanings-map.csv')
  }, [table2])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0">
          <Link href={`/projects/${id}/knowledge`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-lg font-bold text-foreground">Исследование аудитории</h1>
          <p className="text-xs text-muted-foreground">Загрузи аудиозапись интервью — AI расшифрует и соберёт карту смыслов</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-2 text-xs">
        {[
          { label: 'Загрузка', done: step !== 'upload' && step !== 'transcribing' },
          { label: 'Расшифровка', done: ['table1', 'analyzing1', 'analyzing2', 'done'].includes(step) },
          { label: 'Таблица 1', done: ['analyzing2', 'done'].includes(step) },
          { label: 'Карта смыслов', done: step === 'done' },
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
                      : progress
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
                  {progress && (progress.totalFiles > 1 || progress.totalChunks > 1) && (() => {
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
                      : progress && (progress.totalFiles > 1 || progress.totalChunks > 1)
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
      {(step === 'table1' || step === 'analyzing2' || step === 'done') && table1 && (
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
            <Button onClick={analyzeTable2} className="bg-[#3A8A48] hover:bg-[#2E6E3A] text-white">
              <Map className="h-4 w-4 mr-2" />
              Создать карту смыслов
            </Button>
          )}
          {step === 'analyzing2' && (
            <div className="rounded-xl border border-[#ECECEC] bg-white p-6 flex items-center gap-4">
              <Loader2 className="h-6 w-6 text-[#3A8A48] animate-spin shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Строю карту смыслов...</p>
                <p className="text-xs text-muted-foreground mt-0.5">Группирую боли, выделяю формулировки клиентов</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Table 2: Meanings Map ── */}
      {step === 'done' && table2 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3A8A48]/10">
                <Map className="h-3.5 w-3.5 text-[#3A8A48]" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Таблица 2 — Карта смыслов</p>
                <p className="text-xs text-muted-foreground">{table2.categories.length} категорий · сохранено в материалы проекта</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportTable2CSV} className="h-8 text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {table2.categories.map((c: MeaningsCategory, ci) => {
              const colors = TYPE_COLORS[c.type] ?? TYPE_COLORS.pain
              return (
                <div key={ci} className={`rounded-xl border p-4 space-y-3 ${colors.bg} ${colors.border}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-bold ${colors.text}`}>{c.category}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${colors.badge} shrink-0`}>
                      {TYPE_LABELS[c.type] ?? c.type}
                    </span>
                  </div>

                  {/* Customer words — the most important part */}
                  <div>
                    <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wide mb-1.5">Словами клиентов</p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.customer_words.map((w, wi) => (
                        <span key={wi} className="text-xs bg-white/80 border border-white px-2 py-0.5 rounded-md font-medium text-foreground">
                          «{w}»
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="font-semibold text-foreground/70">Глубинный триггер: </span>
                      <span className={colors.text}>{c.deep_trigger}</span>
                    </div>
                    {c.objection && (
                      <div>
                        <span className="font-semibold text-foreground/70">Возражение: </span>
                        <span className={colors.text}>{c.objection}</span>
                      </div>
                    )}
                    {c.content_idea && (
                      <div className="mt-2 pt-2 border-t border-white/50">
                        <div className="flex items-start gap-1.5">
                          <Sparkles className="h-3 w-3 text-[#3A8A48] mt-0.5 shrink-0" />
                          <span className="text-foreground/80">{c.content_idea}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rounded-xl border border-[#3A8A48]/20 bg-[#3A8A48]/5 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-[#3A8A48] mt-0.5 shrink-0" />
            <p className="text-sm text-[#2E6E3A]">
              Карта смыслов сохранена в материалы проекта. Теперь AI будет автоматически использовать формулировки твоей аудитории при генерации контента.
            </p>
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
