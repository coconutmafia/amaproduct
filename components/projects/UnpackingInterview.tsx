'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Mic, MicOff, ChevronRight, ChevronLeft, CheckCircle2,
  Loader2, Download, Sparkles, MessageSquare,
} from 'lucide-react'

// ── Questions ─────────────────────────────────────────────────────────────────
const QUESTIONS = [
  {
    id: 'who',
    question: 'Расскажи о себе — кто ты, чем занимаешься, как давно?',
    hint: 'Имя, профессия, сколько лет в теме, чему обучаешь или в чём помогаешь',
  },
  {
    id: 'why',
    question: 'Почему именно эта сфера? Как ты к ней пришёл(а)?',
    hint: 'История выбора ниши, что привлекло, был ли поворотный момент',
  },
  {
    id: 'values',
    question: 'Какие ценности для тебя самые важные в жизни и в работе?',
    hint: 'Что для тебя важнее всего — честность, свобода, результат, семья, рост...',
  },
  {
    id: 'achievement',
    question: 'Каким своим результатом или достижением ты гордишься больше всего?',
    hint: 'Личный или профессиональный результат, которым по-настоящему гордишься',
  },
  {
    id: 'difference',
    question: 'Что тебя отличает от других экспертов в твоей нише?',
    hint: 'Твой уникальный подход, метод, точка зрения или опыт',
  },
  {
    id: 'transformation',
    question: 'Какие трансформации происходят с твоими клиентами или подписчиками?',
    hint: 'Конкретные результаты — что меняется в их жизни после работы с тобой',
  },
  {
    id: 'audience',
    question: 'Опиши своего идеального подписчика или клиента — кто он?',
    hint: 'Кому ты помогаешь, какие у них боли, желания, страхи, мечты',
  },
  {
    id: 'failure',
    question: 'Была ли ситуация, когда ты ошибся(лась) или провалился(лась)? Что это тебе дало?',
    hint: 'Честная история неудачи, которая многому научила — придаёт человечности',
  },
  {
    id: 'style',
    question: 'Как бы ты описал(а) свой стиль общения? Какой ты в блоге?',
    hint: 'Серьёзный или с юмором, строгий или душевный, провокатор или наставник',
  },
  {
    id: 'dream',
    question: 'О чём ты мечтаешь? Каким видишь своё дело через 3–5 лет?',
    hint: 'Большая цель, которая вдохновляет тебя каждый день',
  },
]

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function UnpackingInterview({ projectId, open, onClose, onSuccess }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0) // 0 = intro, 1..N = questions, N+1 = done
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentText, setCurrentText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const recognitionRef = useRef<unknown>(null)

  const currentQ = step >= 1 && step <= QUESTIONS.length ? QUESTIONS[step - 1] : null
  const totalSteps = QUESTIONS.length
  const progress = step === 0 ? 0 : Math.round((step / totalSteps) * 100)

  // ── Voice recording ────────────────────────────────────────────────────────
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(recognitionRef.current as any)?.stop()
      setIsRecording(false)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      toast.error('Голосовой ввод не поддерживается в этом браузере')
      return
    }
    const r = new SR()
    r.lang = 'ru-RU'
    r.continuous = true
    r.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = Array.from(e.results as any[]).map((x: any) => x[0].transcript).join('')
      setCurrentText(prev => prev ? prev + ' ' + text : text)
    }
    r.onerror = () => setIsRecording(false)
    r.onend = () => setIsRecording(false)
    recognitionRef.current = r
    r.start()
    setIsRecording(true)
  }, [isRecording])

  // ── Navigation ─────────────────────────────────────────────────────────────
  const saveCurrentAnswer = useCallback(() => {
    if (currentQ && currentText.trim()) {
      setAnswers(prev => ({ ...prev, [currentQ.id]: currentText.trim() }))
    }
  }, [currentQ, currentText])

  const goNext = useCallback(() => {
    if (isRecording) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(recognitionRef.current as any)?.stop()
      setIsRecording(false)
    }
    saveCurrentAnswer()
    if (step < totalSteps) {
      const nextId = QUESTIONS[step]?.id
      setCurrentText(answers[nextId] || '')
      setStep(s => s + 1)
    } else {
      // All done — go to review
      setStep(totalSteps + 1)
    }
  }, [isRecording, saveCurrentAnswer, step, totalSteps, answers])

  const goPrev = useCallback(() => {
    saveCurrentAnswer()
    const prevId = QUESTIONS[step - 2]?.id
    setCurrentText(prevId ? (answers[prevId] || '') : '')
    setStep(s => s - 1)
  }, [saveCurrentAnswer, step, answers])

  // ── Build document text ────────────────────────────────────────────────────
  const buildDocument = useCallback(() => {
    let doc = '# РАСПАКОВКА ЛИЧНОСТИ\n\n'
    QUESTIONS.forEach(q => {
      const ans = answers[q.id]
      if (ans) {
        doc += `## ${q.question}\n${ans}\n\n`
      }
    })
    return doc
  }, [answers])

  // ── Save to knowledge base ─────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const doc = buildDocument()
    if (!doc.trim() || doc === '# РАСПАКОВКА ЛИЧНОСТИ\n\n') {
      toast.error('Нет ответов для сохранения')
      return
    }
    setIsSaving(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('title', 'Распаковка личности (интервью)')
      fd.append('materialType', 'unpacking_map')
      fd.append('isSystemVault', 'false')
      fd.append('textContent', doc)

      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Ошибка сохранения')
      }
      toast.success('Распаковка сохранена в материалы проекта! 🎉')
      router.refresh()
      onSuccess()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setIsSaving(false)
    }
  }, [buildDocument, projectId, router, onSuccess, onClose])

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    setIsDownloading(true)
    const doc = buildDocument()
    const blob = new Blob([doc], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'распаковка-личности.txt'
    a.click()
    URL.revokeObjectURL(url)
    setIsDownloading(false)
  }, [buildDocument])

  const answeredCount = Object.values(answers).filter(Boolean).length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isSaving) onClose() }}>
      <DialogContent className="sm:max-w-lg border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-5 w-5 text-primary" />
            Распаковка личности
          </DialogTitle>
        </DialogHeader>

        {/* ── INTRO ── */}
        {step === 0 && (
          <div className="space-y-5 mt-2">
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Что это такое?</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Это интервью из {totalSteps} вопросов о тебе — твоей истории, ценностях, стиле.
                Отвечай голосом или текстом. AI запомнит всё это и будет писать контент, который
                звучит именно как ты.
              </p>
              <p className="text-xs text-primary font-medium">
                ⏱ Занимает 10–15 минут
              </p>
            </div>

            <div className="space-y-2">
              {['Отвечай честно и развёрнуто — чем больше деталей, тем лучше', 'Можно говорить голосом — нажми на микрофон', 'Можно пропустить вопрос и вернуться позже', 'В конце скачаешь или сохранишь в базу'].map((tip, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">{i + 1}</span>
                  {tip}
                </div>
              ))}
            </div>

            <Button
              className="w-full gradient-accent text-white hover:opacity-90"
              onClick={() => { setCurrentText(answers[QUESTIONS[0].id] || ''); setStep(1) }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Начать интервью
            </Button>
          </div>
        )}

        {/* ── QUESTION ── */}
        {currentQ && step >= 1 && step <= totalSteps && (
          <div className="space-y-4 mt-2">
            {/* Progress */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Вопрос {step} из {totalSteps}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Question */}
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
              <p className="text-sm font-semibold text-foreground leading-relaxed">{currentQ.question}</p>
              <p className="text-xs text-muted-foreground mt-1.5">{currentQ.hint}</p>
            </div>

            {/* Voice + Text */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Твой ответ</span>
                <button
                  onClick={toggleRecording}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                    isRecording
                      ? 'border-red-400/50 bg-red-400/10 text-red-400'
                      : 'border-border text-muted-foreground hover:text-primary hover:border-primary/40'
                  }`}
                >
                  {isRecording
                    ? <><MicOff className="h-3.5 w-3.5 animate-pulse" /> Остановить</>
                    : <><Mic className="h-3.5 w-3.5" /> Надиктовать</>
                  }
                </button>
              </div>
              <Textarea
                placeholder="Напиши ответ или надиктуй голосом..."
                value={currentText}
                onChange={e => setCurrentText(e.target.value)}
                rows={5}
                className="resize-none text-sm"
              />
              {isRecording && (
                <p className="text-xs text-red-400 animate-pulse">🎙 Говори — текст появится автоматически...</p>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={goPrev} className="flex-1">
                  <ChevronLeft className="mr-1.5 h-4 w-4" /> Назад
                </Button>
              )}
              <Button
                onClick={goNext}
                className="flex-1 gradient-accent text-white hover:opacity-90"
              >
                {step === totalSteps ? (
                  <><CheckCircle2 className="mr-1.5 h-4 w-4" /> Завершить</>
                ) : (
                  <>Далее <ChevronRight className="ml-1.5 h-4 w-4" /></>
                )}
              </Button>
            </div>

            <button
              onClick={goNext}
              className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
            >
              Пропустить вопрос →
            </button>
          </div>
        )}

        {/* ── DONE ── */}
        {step === totalSteps + 1 && (
          <div className="space-y-5 mt-2">
            <div className="text-center space-y-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 mx-auto">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <p className="font-semibold text-foreground">Интервью завершено!</p>
              <p className="text-sm text-muted-foreground">
                Ответов: <Badge variant="outline" className="text-xs">{answeredCount} из {totalSteps}</Badge>
              </p>
            </div>

            {/* Summary preview */}
            <div className="rounded-xl border border-border bg-secondary/20 p-4 max-h-48 overflow-y-auto space-y-2">
              {QUESTIONS.map(q => answers[q.id] && (
                <div key={q.id}>
                  <p className="text-xs font-medium text-foreground">{q.question}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{answers[q.id]}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Button
                className="w-full gradient-accent text-white hover:opacity-90"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохраняю...</>
                  : <><CheckCircle2 className="mr-2 h-4 w-4" /> Сохранить в материалы проекта</>
                }
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleDownload}
                disabled={isDownloading}
              >
                <Download className="mr-2 h-4 w-4" />
                Скачать txt-файл
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
