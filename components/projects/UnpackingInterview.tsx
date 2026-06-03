'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, CheckCircle2,
  Loader2, Download, Sparkles, MessageSquare,
} from 'lucide-react'

// ── Questions (from "Распаковка для АИ") ──────────────────────────────────────
const QUESTIONS = [
  // ─ 1. БОЛЬШАЯ ИДЕЯ ─
  { id: 'big_idea_core',    section: '💡 Большая идея',   question: 'О чём твой блог в одной главной мысли?',                                                hint: 'Одно предложение — суть того, о чём ты говоришь' },
  { id: 'big_idea_belief',  section: '💡 Большая идея',   question: 'Во что ты веришь настолько сильно, что хочешь об этом говорить?',                       hint: 'Убеждение или идея, которая движет твоим контентом' },
  { id: 'big_idea_why',     section: '💡 Большая идея',   question: 'Почему тебе важно делиться этим с другими? Кому это реально может помочь?',              hint: 'Кто твоя аудитория и зачем им это нужно' },
  { id: 'big_idea_dispute', section: '💡 Большая идея',   question: 'Есть ли позиция или взгляд, с которым ты не согласен? С кем ты споришь через свой контент?', hint: 'Мнение, подход или рынок, с которым ты полемизируешь' },

  // ─ 2. КОНТЕКСТ ─
  { id: 'context_now',      section: '📍 Контекст',       question: 'К чему ты сейчас идёшь в своём блоге или проекте?',                                      hint: 'Твоя главная цель прямо сейчас' },
  { id: 'context_life',     section: '📍 Контекст',       question: 'Что ты сейчас проживаешь в жизни и работе? Что меняется?',                               hint: 'Реальный контекст — запуск, переход, рост, кризис' },
  { id: 'context_hard',     section: '📍 Контекст',       question: 'Что сейчас самое сложное в твоём процессе? Что тебя напрягает или замедляет?',           hint: 'Честно о трудностях — это основа живого контента' },

  // ─ 3. ЛИЧНОСТЬ — История ─
  { id: 'history_path',     section: '👤 Личность',       question: 'Какой путь привёл тебя туда, где ты сейчас?',                                            hint: 'Детство, учёба, работа — что сильнее всего повлияло' },
  { id: 'history_events',   section: '👤 Личность',       question: 'Какие события сформировали тебя как личность?',                                          hint: 'Поворотные моменты, решения, которые изменили всё' },
  { id: 'personality_strengths', section: '👤 Личность',  question: 'В чём ты реально силён(а) как человек? За что тебя чаще всего ценят другие?',           hint: 'Качества, таланты, что даётся легче чем другим' },
  { id: 'personality_weak', section: '👤 Личность',       question: 'В чём ты можешь быть нестабильным(ой) или уязвимым(ой)? Что тебя эмоционально выбивает?', hint: 'Честность об уязвимостях создаёт близость с аудиторией' },
  { id: 'personality_motivation', section: '👤 Личность', question: 'Что тебя двигает вперёд? Ради чего ты всё это делаешь?',                                hint: 'Настоящая мотивация — деньги, миссия, влияние, свобода' },
  { id: 'personality_values', section: '👤 Личность',     question: 'Что для тебя принципиально важно в жизни и работе? Как это проявляется в действиях?',   hint: 'Ценности, которые определяют твои решения каждый день' },
  { id: 'habits',           section: '👤 Личность',       question: 'Какие у тебя есть ежедневные привычки или ритуалы? Что помогает держать фокус?',         hint: 'Рутины, практики, без которых не начинаешь день' },
  { id: 'inspiration',      section: '👤 Личность',       question: 'Что или кто тебя вдохновляет? Какие люди или идеи на тебя влияют?',                      hint: 'Источники энергии, примеры, которые восхищают' },

  // ─ 4. ЭКСПЕРТНОСТЬ ─
  { id: 'expertise_core',   section: '🎯 Экспертность',   question: 'В чём ты считаешь себя экспертом? Какие темы тебе реально интересны глубоко?',           hint: 'Твои главные темы, в которых ты разбираешься лучше других' },
  { id: 'expertise_myths',  section: '🎯 Экспертность',   question: 'Какие мифы или убеждения в твоей сфере ты считаешь неправильными?',                     hint: 'С чем ты споришь, что опровергаешь через контент' },
  { id: 'expertise_patterns', section: '🎯 Экспертность', question: 'Какие паттерны и ошибки ты замечаешь у других в своей теме?',                           hint: 'Типичные ошибки клиентов или рынка — отличный контент' },
  { id: 'expertise_learning', section: '🎯 Экспертность', question: 'Чему ты сейчас активно учишься? Как ты развиваешься в своей теме?',                     hint: 'Рост эксперта — курсы, книги, наставники, эксперименты' },

  // ─ 5. БИЗНЕС ─
  { id: 'business_core',    section: '💼 Бизнес',         question: 'Чем ты сейчас занимаешься? Какие проекты или направления у тебя есть?',                  hint: 'Основная деятельность, продукты, услуги, форматы' },
  { id: 'business_result',  section: '💼 Бизнес',         question: 'Что в твоей деятельности приносит больше всего результата?',                            hint: 'Что работает лучше всего — продукт, формат, подход' },
  { id: 'business_future',  section: '💼 Бизнес',         question: 'Что сейчас требует перестройки? Какие хобби или направления могут вырасти в работу?',    hint: 'Точки роста, новые идеи, эксперименты' },
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
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  // ── Draft: never lose interview answers if the user closes or navigates away
  //    mid-way (mirrors the warmup wizard). Auto-saved to localStorage and
  //    restored when the interview is reopened.
  const DRAFT_KEY = `unpacking_draft_${projectId}`
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoredRef = useRef(false)

  // Restore saved answers when the interview opens.
  useEffect(() => {
    if (!open || restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw) as { step?: number; answers?: Record<string, string>; currentText?: string }
      const hasContent = (d.answers && Object.keys(d.answers).length > 0) || (d.currentText && d.currentText.trim())
      if (!hasContent) return
      if (d.answers) setAnswers(d.answers)
      if (typeof d.currentText === 'string') setCurrentText(d.currentText)
      if (typeof d.step === 'number' && d.step > 0) setStep(d.step)
      toast.success('Восстановили твои ответы — продолжай с того же места')
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Auto-save (debounced) so answers survive navigation / closing the tab.
  useEffect(() => {
    if (!open) return
    const hasContent = Object.keys(answers).length > 0 || currentText.trim().length > 0
    if (!hasContent || step === 0) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, answers, currentText, savedAt: new Date().toISOString() }))
      } catch { /* ignore */ }
    }, 1000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [open, step, answers, currentText, DRAFT_KEY])

  const currentQ = step >= 1 && step <= QUESTIONS.length ? QUESTIONS[step - 1] : null
  const totalSteps = QUESTIONS.length
  const progress = step === 0 ? 0 : Math.round((step / totalSteps) * 100)

  // ── Navigation ─────────────────────────────────────────────────────────────
  const saveCurrentAnswer = useCallback(() => {
    if (currentQ && currentText.trim()) {
      setAnswers(prev => ({ ...prev, [currentQ.id]: currentText.trim() }))
    }
  }, [currentQ, currentText])

  const goNext = useCallback(() => {
    saveCurrentAnswer()
    if (step < totalSteps) {
      const nextId = QUESTIONS[step]?.id
      setCurrentText(answers[nextId] || '')
      setStep(s => s + 1)
    } else {
      // All done — go to review
      setStep(totalSteps + 1)
    }
  }, [saveCurrentAnswer, step, totalSteps, answers])

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
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      toast.success('Распаковка сохранена в материалы проекта! 🎉')
      router.refresh()
      onSuccess()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setIsSaving(false)
    }
  }, [buildDocument, projectId, router, onSuccess, onClose, DRAFT_KEY])

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

            {/* Section label — shown when this is the first question of a new section */}
            {(step === 1 || QUESTIONS[step - 2]?.section !== currentQ.section) && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{currentQ.section}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            {/* Question */}
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
              <p className="text-sm font-semibold text-foreground leading-relaxed">{currentQ.question}</p>
              <p className="text-xs text-muted-foreground mt-1.5">{currentQ.hint}</p>
            </div>

            {/* Voice + Text */}
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Твой ответ</span>
              <VoiceTextarea
                placeholder="Напиши ответ или надиктуй голосом..."
                value={currentText}
                onChange={setCurrentText}
                rows={5}
                className="resize-none text-sm"
              />
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
