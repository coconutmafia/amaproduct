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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Transcription ───────────────────────────────────────────────────────────
  // Accepts multiple files — transcribes sequentially and concatenates results.
  // Files >23 MB are byte-split into chunks (Whisper's 25 MB hard limit).
  //
  // iOS Safari issue: File objects from iCloud Drive are lazy references that
  // haven't been downloaded yet. Reading them via FormData/fetch throws
  // 'The string did not match the expected pattern.' (DOMException SyntaxError).
  // Fix: materialise each file to ArrayBuffer first — this forces iCloud to
  // download the file, and lets us catch the error per-file gracefully.
  const transcribeFiles = useCallback(async (files: File[]) => {
    setStep('transcribing')
    setProgress(null)
    const allParts: string[] = []

    try {
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'mp3'

        // Materialise: read the whole file into memory before processing.
        // Catches iCloud / unavailable file errors early, per file.
        let bytes: ArrayBuffer
        try {
          bytes = await file.arrayBuffer()
        } catch {
          toast.warning(`«${file.name}» не удалось прочитать — возможно, файл в iCloud и не загружен на устройство`)
          continue
        }

        const mime        = file.type || 'audio/mpeg'
        const blob        = new Blob([bytes], { type: mime })
        const totalChunks = Math.ceil(blob.size / CHUNK_BYTES)

        for (let ci = 0; ci < totalChunks; ci++) {
          setProgress({ fileIndex: fi + 1, totalFiles: files.length, chunkIndex: ci + 1, totalChunks })
          const start = ci * CHUNK_BYTES
          const end   = Math.min(start + CHUNK_BYTES, blob.size)
          const chunk = new File([blob.slice(start, end)], `chunk_${ci + 1}.${ext}`, { type: mime })

          const fd   = new FormData()
          fd.append('audio', chunk)
          const res  = await fetch('/api/ai/transcribe', { method: 'POST', body: fd })
          const data = await res.json() as { text?: string; error?: string }
          if (!res.ok || data.error) throw new Error(data.error ?? `Файл ${fi + 1}, часть ${ci + 1}: ошибка`)
          allParts.push(data.text ?? '')
        }
      }

      if (allParts.length === 0) {
        toast.error('Ни один файл не удалось прочитать')
        setStep('upload')
        setProgress(null)
        return
      }

      setTranscription(allParts.join('\n\n'))
      setProgress(null)
      setStep('transcribed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка расшифровки')
      setStep('upload')
      setProgress(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFiles = useCallback((fileList: File[]) => {
    const allowed = ['audio/', 'video/mp4', 'video/', 'application/ogg']
    const valid = fileList.filter(f =>
      allowed.some(p => f.type.startsWith(p)) || f.name.match(/\.(mp3|mp4|m4a|wav|ogg|oga|opus|webm|aac)$/i)
    )
    if (valid.length === 0) { toast.error('Поддерживаются: MP3, MP4, M4A, WAV, OGG, WEBM'); return }
    if (valid.length < fileList.length) toast.warning(`${fileList.length - valid.length} файл(ов) пропущено — неподдерживаемый формат`)

    const MAX_MB = 100
    for (const f of valid) {
      const mb = f.size / (1024 * 1024)
      if (mb > MAX_MB) { toast.error(`${f.name}: ${mb.toFixed(1)} МБ — максимум ${MAX_MB} МБ на файл`); return }
    }

    const totalMb  = valid.reduce((s, f) => s + f.size / (1024 * 1024), 0)
    const allWav   = valid.every(f => f.name.toLowerCase().endsWith('.wav'))
    const estMin   = allWav ? Math.max(1, Math.round(totalMb / 10)) : Math.max(1, Math.round(totalMb))
    setSelectedFile({
      name:   valid.length === 1 ? valid[0].name : `${valid.length} файла`,
      sizeMb: totalMb.toFixed(1),
      estMin: estMin > 1 ? `≈ ${estMin} мин` : '< 1 мин',
    })
    transcribeFiles(valid)
  }, [transcribeFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) handleFiles(files)
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
          {/* Hidden file input — referenced by label below for iOS Safari compatibility */}
          <input
            id="audio-file-input"
            ref={fileInputRef}
            type="file"
            accept=".mp3,.mp4,.m4a,.wav,.ogg,.oga,.opus,.webm,.aac"
            multiple
            className="hidden"
            onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) handleFiles(files); e.target.value = '' }}
          />

          {/* Drop zone — label wraps content so clicking anywhere triggers the native file picker on iOS */}
          <label
            htmlFor={step === 'upload' ? 'audio-file-input' : undefined}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition-all
              ${step === 'upload' ? 'cursor-pointer' : 'cursor-default'}
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
                    {progress
                      ? progress.totalFiles > 1
                        ? `Файл ${progress.fileIndex} из ${progress.totalFiles}${progress.totalChunks > 1 ? ` · часть ${progress.chunkIndex}/${progress.totalChunks}` : ''}...`
                        : progress.totalChunks > 1
                        ? `Расшифровываю часть ${progress.chunkIndex} из ${progress.totalChunks}...`
                        : 'Расшифровываю аудио...'
                      : 'Расшифровываю аудио...'}
                  </p>
                  {selectedFile && (
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
                    {progress && (progress.totalFiles > 1 || progress.totalChunks > 1)
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
                {/* Explicit button — also valid as a label child, so it opens the picker on iOS */}
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors">
                  <Upload className="h-3.5 w-3.5" /> Выбрать файл
                </span>
              </>
            )}
          </label>

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
