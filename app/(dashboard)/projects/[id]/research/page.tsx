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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Transcription ───────────────────────────────────────────────────────────
  const transcribeFile = useCallback(async (file: File) => {
    setStep('transcribing')
    const fd = new FormData()
    fd.append('audio', file)
    try {
      const res = await fetch('/api/ai/transcribe', { method: 'POST', body: fd })
      const data = await res.json() as { text?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Transcription failed')
      setTranscription(data.text ?? '')
      setStep('transcribed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка расшифровки')
      setStep('upload')
    }
  }, [])

  const handleFile = useCallback((file: File) => {
    const allowed = ['audio/', 'video/mp4', 'video/']
    if (!allowed.some(p => file.type.startsWith(p)) && !file.name.match(/\.(mp3|mp4|m4a|wav|ogg|webm|aac)$/i)) {
      toast.error('Поддерживаются: MP3, MP4, M4A, WAV, OGG, WEBM')
      return
    }
    const MAX_MB = 25
    const sizeMb = file.size / (1024 * 1024)
    if (sizeMb > MAX_MB) {
      toast.error(`Файл ${sizeMb.toFixed(1)} МБ — максимум ${MAX_MB} МБ (≈ 30 минут MP3/M4A)`)
      return
    }

    // Estimate duration: MP3/M4A/AAC ≈ 1 min per MB at 128kbps; WAV ≈ 5× smaller duration
    const isWav = file.name.toLowerCase().endsWith('.wav')
    const estMin = isWav ? Math.max(1, Math.round(sizeMb / 10)) : Math.max(1, Math.round(sizeMb))
    setSelectedFile({
      name:   file.name,
      sizeMb: sizeMb.toFixed(1),
      estMin: estMin > 1 ? `≈ ${estMin} мин` : '< 1 мин',
    })

    transcribeFile(file)
  }, [transcribeFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

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
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
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
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => step === 'upload' && fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all
              ${isDragging ? 'border-[#3A8A48] bg-[#3A8A48]/5' : 'border-[#DEDEDE] hover:border-[#3A8A48]/50 hover:bg-[#3A8A48]/3'}
              ${step === 'transcribing' ? 'pointer-events-none opacity-70' : ''}`}
          >
            {step === 'transcribing' ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3A8A48]/10">
                  <Loader2 className="h-7 w-7 text-[#3A8A48] animate-spin" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Расшифровываю аудио...</p>
                  {selectedFile && (
                    <p className="text-sm text-[#3A8A48] font-medium">{selectedFile.name} · {selectedFile.sizeMb} МБ · {selectedFile.estMin}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {selectedFile && parseInt(selectedFile.estMin) >= 10
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
                  <p className="text-sm text-muted-foreground">или нажми чтобы выбрать файл</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">MP3, MP4, M4A, WAV, OGG, WEBM</p>
                </div>
                {/* Limit hint */}
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
                  <span>⏱ Максимум ~30 минут записи (до 25 МБ)</span>
                  <span className="text-amber-400">·</span>
                  <span>Запись длиннее — сохрани двумя файлами</span>
                </div>
                <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> Выбрать файл
                </Button>
              </>
            )}
            <input ref={fileInputRef} type="file" accept="audio/*,video/mp4,.mp4,.m4a,.mp3,.wav,.ogg,.webm" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
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
