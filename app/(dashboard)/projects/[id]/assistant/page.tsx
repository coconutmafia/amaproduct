'use client'

import { useState, useRef, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Loader2, Copy, Check, User, CalendarPlus } from 'lucide-react'
import { toast } from 'sonner'
import { ChatComposer } from '@/components/ui/ChatComposer'
import { SaveButton } from '@/components/content/SaveButton'
import { CarouselSlides } from '@/components/carousel/CarouselSlides'
import { PostImage } from '@/components/carousel/PostImage'
import { StoryDesignButton } from '@/components/carousel/StoryDesignButton'
import { VoiceRuleButton, maybeSuggestRule } from '@/components/chat/VoiceRuleButton'
import { showUpgrade } from '@/components/billing/UpgradeDialog'
import { friendlyError } from '@/lib/friendlyError'
import { useChatPin } from '@/lib/useChatPin'
import { cleanMarkdown } from '@/lib/cleanText'
import { isReelsScript } from '@/lib/contentKind'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  opener?: boolean   // the AI's intro stating the day's topic — no action buttons
}

// Generation request handed over from the content plan.
interface GenContext { day: number; type: string; phase: string }

const SUGGESTIONS = [
  'Напиши пост на тему сегодняшнего дня',
  'Накидай 5 идей для рилз на эту неделю',
  'Придумай сторителлинг-пост из моей личной линии',
  'Помоги переписать этот текст моим голосом: …',
]

const TYPE_RU: Record<string, string> = {
  post: 'пост', stories: 'сторис', reels: 'рилз', carousel: 'карусель', email: 'письмо', live: 'эфир',
}
const FORMAT_HINT: Record<string, string> = {
  stories: 'Сделаю серию коротких сторис — на экране минимум текста, суть голосом и интерактивом.',
  reels: 'Напишу сценарий рилза — рубленый, по секундам, мощный хук в первые 3 секунды.',
  post: 'Напишу пост целиком в твоём голосе.',
  carousel: 'Сделаю карусель — обложка + слайды, одна мысль на слайд.',
}
function openerHead(type: string, day: number, brief: string): string {
  const ru = TYPE_RU[type] || type
  const hint = FORMAT_HINT[type] || 'Напишу в твоём голосе.'
  return `Окей, делаем ${ru}${day ? ` на день ${day}` : ''}.\n\n${brief ? `Тема: «${brief}»\n\n` : ''}${hint}`
}
function buildOpener(type: string, day: number, brief: string): string {
  return `${openerHead(type, day, brief)}\n\nРасскажи детали — историю, кейс, цифры, имя клиента — или просто напиши «давай», и я напишу.`
}

// A message that PROPOSES several post/scenario variants to choose from —
// labelled «Вариант N», «Идея N» or «Сценарий N» — is NOT a single finished
// unit. On such messages we hide the target actions («В план», «Оформить
// сторис», image/carousel), because one post = one scenario and dumping all
// variants into it is wrong (tester report). The user picks one («вариант 2»),
// and the resulting single-scenario answer gets the buttons. Note: «Сторис/кадр/
// слайд N» are FRAMES of one scenario, not variants — they must not count.
function looksLikeMultipleVariants(text: string): boolean {
  const heads = text.match(/(?:^|\n)\s*(?:вариант|идея|сценарий)\s*[№#]?\s*\d+/gi) || []
  const distinct = new Set(heads.map(h => h.toLowerCase().replace(/\s+/g, ' ').trim()))
  return distinct.size >= 2
}

// Saves the generated message straight into the content plan (the day's unit).
function SaveToPlanButton({ projectId, ctx, text }: { projectId: string; ctx: GenContext; text: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const save = async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      const res = await fetch('/api/content-items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, contentType: ctx.type, dayNumber: ctx.day, phase: ctx.phase, bodyText: text }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})) as { error?: string }; throw new Error(j.error || 'Ошибка') }
      setState('saved'); toast.success('Сохранено в контент-план ✓')
    } catch (e) { setState('idle'); toast.error(friendlyError(e, 'Не удалось')) }
  }
  return (
    <button onClick={save} disabled={state !== 'idle'}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
      {state === 'saving' ? <><Loader2 className="h-3 w-3 animate-spin" /> Сохраняю…</>
        : state === 'saved' ? <><Check className="h-3 w-3" /> В плане</>
        : <><CalendarPlus className="h-3 w-3" /> В план</>}
    </button>
  )
}

export default function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Where the back arrow goes (content-plan when opened from there) + its label
  const [backHref, setBackHref] = useState(`/projects/${id}`)
  const [backLabel, setBackLabel] = useState<string | null>(null)
  // Set when opened from the content plan to generate a specific day/format —
  // enables the «В план» save button on generated answers.
  const [genContext, setGenContext] = useState<GenContext | null>(null)

  // ChatGPT-style: pin the just-sent question to the top + dynamic tail spacer.
  const { scrollRef, lastUserRef, endRef, tailSpace } = useChatPin(messages, streaming)
  // The LAST user message (not the last message overall — that's the answer).
  const lastUserIdx = messages.map(m => m.role).lastIndexOf('user')

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || loading) return
    setInput('')
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    // Durable style instruction? Offer one-tap save as a project rule.
    maybeSuggestRule(content, id)
    setLoading(true)
    setStreaming('')

    const controller = new AbortController()
    abortRef.current = controller
    let acc = ''

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, conversationType: 'assistant', messages: next, ...(genContext ? { genFormat: genContext.type } : {}) }),
        signal: controller.signal,
      })
      if (res.status === 402) { showUpgrade('limit'); return }
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? 'Ошибка')
      }
      if (!res.body) throw new Error('Нет ответа')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setStreaming(acc)
      }
      setMessages(prev => [...prev, { role: 'assistant', content: acc }])
      setStreaming('')
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // user stopped — keep whatever streamed
        if (acc.trim()) setMessages(prev => [...prev, { role: 'assistant', content: acc }])
      } else {
        toast.error(friendlyError(err, 'Ошибка ассистента'))
      }
      setStreaming('')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, messages, loading, genContext])

  // On mount: if opened with ?prompt=… (e.g. from the content plan), set the
  // back link and auto-send the seeded prompt so the chat starts on that theme.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    const sp = new URLSearchParams(window.location.search)
    // Return to the content plan ON THE SAME WEEK the user came from.
    if (sp.get('back') === 'content-plan') {
      const wk = sp.get('week')
      setBackHref(`/projects/${id}/content-plan${wk ? `?week=${wk}` : ''}`)
      setBackLabel('Контент-план')
    }

    // Generation handoff from the content plan: open with the AI stating the
    // topic and WAIT for the user's details (don't auto-generate).
    if (sp.get('gen') === '1') {
      const day = parseInt(sp.get('day') || '0', 10)
      const type = sp.get('type') || 'post'
      const phase = sp.get('phase') || 'awareness'
      const brief = sp.get('brief') || ''
      setGenContext({ day, type, phase })
      const head = openerHead(type, day, brief)
      // Show the topic immediately, then proactively propose angles/formats/trends.
      setMessages([{ role: 'assistant', opener: true, content: `${head}\n\nСекунду — подберу пару вариантов, с чего зайти…` }])
      window.history.replaceState({}, '', window.location.pathname)
      ;(async () => {
        try {
          const res = await fetch('/api/ai/suggest-angles', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: id, type, brief, phase, day }),
          })
          const d = (await res.json().catch(() => ({}))) as { text?: string }
          setMessages([{ role: 'assistant', opener: true, content: res.ok && d.text ? `${head}\n\n${d.text}` : buildOpener(type, day, brief) }])
        } catch {
          setMessages([{ role: 'assistant', opener: true, content: buildOpener(type, day, brief) }])
        }
      })()
      return
    }

    const seed = sp.get('prompt')
    if (seed) {
      // strip the query so a refresh doesn't re-send
      window.history.replaceState({}, '', window.location.pathname)
      setTimeout(() => send(seed), 100)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = () => { abortRef.current?.abort() }

  const copyMsg = (text: string, idx: number) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    }).catch(() => toast.error('Не удалось скопировать'))
  }

  // ── Voice ──

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#ECECEC] bg-white/95 backdrop-blur sticky top-0 z-10">
        <Link href={backHref}
          className={`flex items-center justify-center rounded-lg hover:bg-secondary shrink-0 ${backLabel ? 'gap-1 px-2 h-8' : 'h-8 w-8'}`}>
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {backLabel && <span className="text-xs font-medium whitespace-nowrap">{backLabel}</span>}
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-accent">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground leading-tight">AI-ассистент</p>
            <p className="text-[11px] text-muted-foreground leading-tight">Знает твой проект · пишет твоим голосом</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Чем помочь с контентом?</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">Я знаю твой голос, аудиторию, продукт и материалы. Спрашивай что угодно или попроси написать.</p>
            </div>
            <div className="w-full max-w-md space-y-2">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  className="w-full text-left text-sm px-3.5 py-2.5 rounded-xl border border-[#ECECEC] hover:border-primary/40 hover:bg-primary/5 transition-all text-foreground">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isLastUser = i === lastUserIdx
          const text = m.role === 'assistant' ? cleanMarkdown(m.content) : m.content
          // Several variants on offer → gate the single-target actions until one is picked.
          const multiVariant = m.role === 'assistant' && !m.opener && looksLikeMultipleVariants(text)
          return (
          <div key={i} ref={isLastUser ? lastUserRef : undefined} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''} ${isLastUser ? 'scroll-mt-2' : ''}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-secondary' : 'gradient-accent'}`}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Sparkles className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className={`group max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-secondary/50 text-foreground'
            }`}>
              {m.role === 'assistant' && !m.opener && (
                <div className="flex items-center gap-3 mb-2 pb-1.5 border-b border-black/[0.06] flex-wrap">
                  <button onClick={() => copyMsg(text, i)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
                    {copiedIdx === i ? <><Check className="h-3 w-3" /> Скопировано</> : <><Copy className="h-3 w-3" /> Копировать</>}
                  </button>
                  <SaveButton body={text} projectId={id} className="text-[11px] text-muted-foreground hover:text-primary" />
                  <VoiceRuleButton projectId={id} />
                  {genContext && !multiVariant && <SaveToPlanButton projectId={id} ctx={genContext} text={text} />}
                  {!multiVariant && ((genContext?.type === 'carousel' || /слайд\s*\d/i.test(text)) ? (
                    <CarouselSlides sourceText={text} type="carousel" projectId={id} />
                  ) : (genContext?.type === 'reels' || isReelsScript(text)) ? (
                    // A reels script is a filming script, not a post image or a
                    // stories series — offer no «design» button (owner feedback).
                    null
                  ) : (genContext?.type === 'stories' || /(сторис|stories|кадр)\s*\d/i.test(text)) ? (
                    <StoryDesignButton text={text} projectId={id} />
                  ) : (genContext?.type === 'post' || text.length > 150) ? (
                    <PostImage text={text} projectId={id} />
                  ) : null)}
                </div>
              )}
              {multiVariant && (
                <p className="text-[11px] text-muted-foreground mb-2 -mt-0.5 leading-snug">
                  Это варианты на выбор. Напиши, какой берём («вариант 1»), и я распишу один сценарий — тогда появятся «В план» и «Оформить сторис».
                </p>
              )}
              {text}
            </div>
          </div>
        )})}

        {streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-secondary/50 text-foreground">
              {cleanMarkdown(streaming)}
              <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-primary/60 animate-pulse rounded-sm" />
            </div>
          </div>
        )}

        {loading && !streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent">
              <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
            </div>
            <div className="rounded-2xl px-3.5 py-2.5 bg-secondary/50 text-sm text-muted-foreground">Думаю…</div>
          </div>
        )}
        {/* End marker + dynamic spacer: lets the question pin to the top, fills
            empty space below a short answer, collapses to 0 for a long one. */}
        <div ref={endRef} />
        <div aria-hidden style={{ height: tailSpace }} />
      </div>

      <ChatComposer value={input} onChange={setInput} onSend={() => send(input)}
        loading={loading} onStop={stop}
        placeholder={genContext ? 'Напиши детали или просто «давай»…' : 'Спроси или попроси написать…'} />
    </div>
  )
}
