'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import { createClient } from '@/lib/supabase/client'
import {
  ChevronRight, ChevronLeft, CheckCircle2,
  Loader2, Download, Sparkles, MessageSquare,
} from 'lucide-react'

// ── Questions (from "Распаковка для АИ") ──────────────────────────────────────
const QUESTIONS = [
  // Вопросы = форма Августы «Урок 7. Распаковка» 1-в-1 (жалоба 30 июля:
  // «в сервисе нет половины вопросов и вопросов по личности» — клиенты её
  // потока знают полную форму и сравнивают). Прежние сжатые формулировки
  // РАСШИРЕНЫ до всех пунктов слайдов; id старых вопросов сохранены, чтобы
  // черновики и режим «доответить» узнавали прежние ответы.
  // ─ 1. БОЛЬШАЯ ИДЕЯ ─
  { id: 'big_idea_core',    section: '💡 Большая идея',   question: 'О чём глобально твой блог? Какую мысль ты хочешь донести до своего зрителя?', hint: 'Одно-два предложения — суть' },
  { id: 'big_idea_belief',  section: '💡 Большая идея',   question: 'Во что ты веришь?',                                                          hint: 'Убеждение, которое движет твоим контентом' },
  { id: 'big_idea_profit',  section: '💡 Большая идея',   question: 'Почему тебе это выгодно?',                                                   hint: 'Что тебе даёт транслировать эту идею' },
  { id: 'big_idea_share',   section: '💡 Большая идея',   question: 'Почему ты хочешь этим делиться?',                                            hint: 'Твоя личная причина говорить об этом' },
  { id: 'big_idea_why',     section: '💡 Большая идея',   question: 'Кому это полезно?',                                                          hint: 'Кто твоя аудитория и что она получит' },
  { id: 'big_idea_reach',   section: '💡 Большая идея',   question: 'Почему тебе важно, чтобы об этом узнало как можно больше людей?',            hint: 'Масштаб идеи — зачем ей расти' },
  { id: 'big_idea_silence', section: '💡 Большая идея',   question: 'Что плохого может произойти, если ты не будешь об этом говорить?',           hint: 'Цена молчания — для тебя и для людей' },
  { id: 'big_idea_dispute', section: '💡 Большая идея',   question: 'С кем ты борешься?',                                                         hint: 'Позиция, подход или рынок, с которым ты споришь' },
  { id: 'big_idea_disagree', section: '💡 Большая идея',  question: 'Почему они с тобой не согласны?',                                            hint: 'Их логика и их аргументы' },
  { id: 'big_idea_confront', section: '💡 Большая идея',  question: 'Почему тебе важно вступать с ними в конфронтацию?',                          hint: 'Зачем спорить, а не промолчать' },
  // ─ 2. КОНТЕКСТ ─
  { id: 'context_now',      section: '📍 Контекст',       question: 'К чему ты идёшь?',                                                           hint: 'Твои мечты и цели — большие и конкретные' },
  { id: 'context_life',     section: '📍 Контекст',       question: 'Что ты проживаешь прямо сейчас — в жизни и в работе?',                        hint: 'Твоё настоящее: переезд, запуск, подготовка, перемены' },
  { id: 'context_hard',     section: '📍 Контекст',       question: 'Самая большая трудность, через которую ты сейчас проходишь?',                 hint: 'Честно о сложном — это основа живого контента' },
  // ─ 3. ЛИЧНОСТЬ ─
  { id: 'history_path',     section: '👤 Личность',       question: 'Твоя история — путь, который привёл тебя к цели',                             hint: 'Детство, школьные годы, универ, работа и т.д.' },
  { id: 'history_events',   section: '👤 Личность',       question: 'Какие события сформировали тебя как личность?',                               hint: 'Поворотные моменты, решения, которые изменили всё' },
  { id: 'habits',           section: '👤 Личность',       question: 'Твои привычки и ритуалы',                                                     hint: 'Например: бег по утрам, питание, время на воздухе' },
  { id: 'personality_strengths', section: '👤 Личность',  question: 'Твои сильные качества',                                                       hint: 'Например: ораторский навык, эстетика, копирайтинг' },
  { id: 'personality_weak', section: '👤 Личность',       question: 'Твои уязвимости',                                                             hint: 'Например: «смотрю сериалы залпом», «бесят голосовые», «я интроверт», «я плачу когда…»' },
  { id: 'personality_motivation', section: '👤 Личность', question: 'Твоя мотивация',                                                              hint: 'Истории, челленджи, родные, наставник — что двигает вперёд' },
  { id: 'inspiration',      section: '👤 Личность',       question: 'Твоё вдохновение',                                                            hint: 'Фильмы, музыка, блогеры, книги, природа, путешествия, обучения, люди, эстетика, рефлексия' },
  { id: 'personality_values', section: '👤 Личность',     question: 'Твои ценности — и почему каждая для тебя важна?',                             hint: 'Например: деньги, свобода, окружение, саморазвитие, эстетика, ясность' },
  { id: 'values_express',   section: '👤 Личность',       question: 'Через что выражаются твои ценности?',                                         hint: 'Например, деньги: то, как зарабатываю, на что трачу, как увеличиваю' },
  { id: 'values_triggers',  section: '👤 Личность',       question: 'Что тебя триггерит в контексте твоих ценностей?',                             hint: 'Например: «деньги — это трудно», «богатые — злые», «счастье за деньги не купишь»' },
  // ─ 4. ЭКСПЕРТНОСТЬ ─
  { id: 'expertise_core',   section: '🎯 Экспертность',   question: 'В чём ты эксперт?',                                                           hint: 'Например: продвижение в соцсетях, запуски, продажи' },
  { id: 'expertise_learning', section: '🎯 Экспертность', question: 'Чему ты обучаешься?',                                                         hint: 'Например: масштабирование, команда, управление' },
  { id: 'expertise_interest', section: '🎯 Экспертность', question: 'Что тебе интересно?',                                                         hint: 'Темы, в которые тянет копать, даже без выгоды' },
  { id: 'expertise_patterns', section: '🎯 Экспертность', question: 'Мышление: какие паттерны и ошибки ты замечаешь у других в своей теме?',       hint: 'Типичные ошибки клиентов или рынка — отличный контент' },
  { id: 'expertise_myths',  section: '🎯 Экспертность',   question: 'Какие мифы и убеждения в твоей сфере ты опровергаешь?',                       hint: 'С чем споришь, что развенчиваешь' },
  { id: 'expertise_problems', section: '🎯 Экспертность', question: 'Какие проблемы и сложности есть у людей в твоей теме? Как ты видишь развитие?', hint: 'С чем приходят люди и куда всё движется' },
  // ─ 5. БИЗНЕС ─
  { id: 'business_core',    section: '💼 Бизнес',         question: 'Чем ты занимаешься: бизнес, проекты, другая занятость, хобби?',               hint: 'Декомпозиция: перечисли все направления' },
  { id: 'business_result',  section: '💼 Бизнес',         question: 'Что в твоей деятельности приносит больше всего результата?',                  hint: 'Что работает лучше всего — продукт, формат, подход' },
  { id: 'business_future',  section: '💼 Бизнес',         question: 'Что сейчас требует перестройки? Какие хобби или направления могут вырасти в работу?', hint: 'Точки роста, новые идеи, эксперименты' },
]

// Старые формулировки → те же id: у прошедших распаковку раньше материал
// содержит эти заголовки, режим «доответить» узнаёт их и не спрашивает заново.
const LEGACY_HEADERS: Record<string, string> = {
  'о чём твой блог в одной главной мысли?': 'big_idea_core',
  'во что ты веришь настолько сильно, что хочешь об этом говорить?': 'big_idea_belief',
  'почему тебе важно делиться этим с другими? кому это реально может помочь?': 'big_idea_why',
  'есть ли позиция или взгляд, с которым ты не согласен? с кем ты споришь через свой контент?': 'big_idea_dispute',
  'к чему ты сейчас идёшь в своём блоге или проекте?': 'context_now',
  'что ты сейчас проживаешь в жизни и работе? что меняется?': 'context_life',
  'что сейчас самое сложное в твоём процессе? что тебя напрягает или замедляет?': 'context_hard',
  'какой путь привёл тебя туда, где ты сейчас?': 'history_path',
  'в чём ты реально силён(а) как человек? за что тебя чаще всего ценят другие?': 'personality_strengths',
  'в чём ты можешь быть нестабильным(ой) или уязвимым(ой)? что тебя эмоционально выбивает?': 'personality_weak',
  'что тебя двигает вперёд? ради чего ты всё это делаешь?': 'personality_motivation',
  'что для тебя принципиально важно в жизни и работе? как это проявляется в действиях?': 'personality_values',
  'какие у тебя есть ежедневные привычки или ритуалы? что помогает держать фокус?': 'habits',
  'что или кто тебя вдохновляет? какие люди или идеи на тебя влияют?': 'inspiration',
  'в чём ты считаешь себя экспертом? какие темы тебе реально интересны глубоко?': 'expertise_core',
  'какие мифы или убеждения в твоей сфере ты считаешь неправильными?': 'expertise_myths',
  'какие паттерны и ошибки ты замечаешь у других в своей теме?': 'expertise_patterns',
  'чему ты сейчас активно учишься? как ты развиваешься в своей теме?': 'expertise_learning',
  'чем ты сейчас занимаешься? какие проекты или направления у тебя есть?': 'business_core',
}


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
  // Режим «доответить»: если распаковка уже сохранялась (в т.ч. СТАРОЙ версией
  // с меньшим числом вопросов — жалоба Августы 30 июля), подтягиваем прежние
  // ответы из материала и человек отвечает только на новые вопросы. Прежний
  // материал после сохранения заменяется (удаляем, чтобы не плодить дубли).
  const [priorMaterialId, setPriorMaterialId] = useState<string | null>(null)
  const [priorCount, setPriorCount] = useState(0)
  const priorLoadedRef = useRef(false)

  useEffect(() => {
    if (!open || priorLoadedRef.current) return
    priorLoadedRef.current = true
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: mats } = await supabase
          .from('project_materials')
          .select('id, raw_content, created_at')
          .eq('project_id', projectId)
          .eq('material_type', 'unpacking_map')
          .order('created_at', { ascending: false })
          .limit(1)
        const mat = mats?.[0]
        if (!mat?.raw_content) return
        // Материал = markdown из buildDocument («## Вопрос», затем ответ).
        // Восстанавливаем ответы по заголовкам — узнаём и новые формулировки,
        // и старые (LEGACY_HEADERS).
        const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
        const byHeader: Record<string, string> = {}
        for (const q of QUESTIONS) byHeader[norm(q.question)] = q.id
        for (const [legacy, id] of Object.entries(LEGACY_HEADERS)) byHeader[norm(legacy)] = id
        const restored: Record<string, string> = {}
        for (const block of String(mat.raw_content).split(/^## /m).slice(1)) {
          const nl = block.indexOf('\n')
          if (nl === -1) continue
          const id = byHeader[norm(block.slice(0, nl))]
          const answer = block.slice(nl + 1).trim()
          if (id && answer) restored[id] = answer
        }
        if (!Object.keys(restored).length) return
        setPriorMaterialId(mat.id)
        // Черновик (локальная работа) свежее материала — его ответы не трогаем.
        setAnswers((prev) => ({ ...restored, ...prev }))
        setPriorCount(Object.keys(restored).length)
      } catch { /* нет прежней распаковки — обычный режим */ }
    })()
  }, [open, projectId])

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
      // Новый документ включает ВСЕ ответы (старые + доотвеченные) — прежний
      // материал больше не нужен, удаляем, чтобы в базе знаний не было дублей.
      if (priorMaterialId) {
        await fetch(`/api/materials?id=${priorMaterialId}`, { method: 'DELETE' }).catch(() => {})
      }
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      toast.success('Распаковка сохранена в материалы проекта! 🎉')
      router.refresh()
      onSuccess()
      onClose()
    } catch (e) {
      toast.error(friendlyError(e, 'Ошибка'))
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
              {priorCount > 0 && (
                <p className="text-sm font-medium text-primary">
                  ✅ Нашли твою прошлую распаковку: {priorCount} ответов уже на месте.
                  Мы добавили новые вопросы — доответь только их, старые ответы сохранятся.
                </p>
              )}
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
              onClick={() => {
                // В режиме «доответить» стартуем с первого вопроса без ответа
                const firstEmpty = QUESTIONS.findIndex((q) => !answers[q.id]?.trim())
                const startStep = priorCount > 0 && firstEmpty >= 0 ? firstEmpty + 1 : 1
                setCurrentText(answers[QUESTIONS[startStep - 1].id] || '')
                setStep(startStep)
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {priorCount > 0 ? 'Доответить новые вопросы' : 'Начать интервью'}
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
