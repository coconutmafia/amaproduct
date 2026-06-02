'use client'

import { useState, useRef, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Loader2, Copy, Check, User } from 'lucide-react'
import { toast } from 'sonner'
import { ChatComposer } from '@/components/ui/ChatComposer'
import { cleanMarkdown } from '@/lib/cleanText'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Напиши пост на тему сегодняшнего дня',
  'Накидай 5 идей для рилз на эту неделю',
  'Придумай сторителлинг-пост из моей личной линии',
  'Помоги переписать этот текст моим голосом: …',
]

export default function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Voice input

  // Where the back arrow goes (content-plan when opened from there)
  const [backHref, setBackHref] = useState(`/projects/${id}`)

  const lastUserRef = useRef<HTMLDivElement>(null)
  // ChatGPT-style: pin the user's just-sent message to the top, answer streams
  // below. Computed explicitly (not scrollIntoView, which overshoots on mobile
  // webviews and pushed the question off-screen).
  useEffect(() => {
    if (messages[messages.length - 1]?.role !== 'user') return
    requestAnimationFrame(() => {
      const c = scrollRef.current, el = lastUserRef.current
      if (!c || !el) return
      const top = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 12
      c.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
  }, [messages])

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || loading) return
    setInput('')
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setLoading(true)
    setStreaming('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, conversationType: 'assistant', messages: next }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? 'Ошибка')
      }
      if (!res.body) throw new Error('Нет ответа')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
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
        if (streaming.trim()) setMessages(prev => [...prev, { role: 'assistant', content: streaming }])
      } else {
        toast.error(err instanceof Error ? err.message : 'Ошибка ассистента')
      }
      setStreaming('')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, messages, loading])

  // On mount: if opened with ?prompt=… (e.g. from the content plan), set the
  // back link and auto-send the seeded prompt so the chat starts on that theme.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('back') === 'content-plan') setBackHref(`/projects/${id}/content-plan`)
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
    <div className="flex flex-col h-[calc(100vh-0px)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#ECECEC] bg-white/95 backdrop-blur sticky top-0 z-10">
        <Link href={backHref} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary">
          <ArrowLeft className="h-4 w-4" />
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
          const isLastUser = m.role === 'user' && i === messages.length - 1
          const text = m.role === 'assistant' ? cleanMarkdown(m.content) : m.content
          return (
          <div key={i} ref={isLastUser ? lastUserRef : undefined} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''} ${isLastUser ? 'scroll-mt-2' : ''}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-secondary' : 'gradient-accent'}`}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Sparkles className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className={`group max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-secondary/50 text-foreground'
            }`}>
              {text}
              {m.role === 'assistant' && (
                <button onClick={() => copyMsg(text, i)}
                  className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
                  {copiedIdx === i ? <><Check className="h-3 w-3" /> Скопировано</> : <><Copy className="h-3 w-3" /> Копировать</>}
                </button>
              )}
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
        {/* Spacer so the just-sent question can always pin to the top, even when the answer is short */}
        {messages.length > 0 && <div aria-hidden className="min-h-[45vh] shrink-0" />}
      </div>

      <ChatComposer value={input} onChange={setInput} onSend={() => send(input)}
        loading={loading} onStop={stop} placeholder="Спроси или попроси написать…" />
    </div>
  )
}
