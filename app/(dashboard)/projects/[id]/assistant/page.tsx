'use client'

import { useState, useRef, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, Sparkles, Loader2, Copy, Check, User, Square } from 'lucide-react'
import { toast } from 'sonner'

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
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streaming, scrollToBottom])

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

  const stop = () => { abortRef.current?.abort() }

  const copyMsg = (text: string, idx: number) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    }).catch(() => toast.error('Не удалось скопировать'))
  }

  // ── Voice ──
  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { toast.error('Голосовой ввод недоступен в этом браузере'); return }
    const rec = new SR()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true
    let base = input
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let finalT = '', interimT = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalT += e.results[i][0].transcript
        else interimT += e.results[i][0].transcript
      }
      if (finalT) { base = (base ? base + ' ' : '') + finalT; setInput(base) }
      else setInput((base ? base + ' ' : '') + interimT)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.start(); recognitionRef.current = rec; setListening(true)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#ECECEC] bg-white/95 backdrop-blur sticky top-0 z-10">
        <Link href={`/projects/${id}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary">
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

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-secondary' : 'gradient-accent'}`}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Sparkles className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className={`group max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-secondary/50 text-foreground'
            }`}>
              {m.content}
              {m.role === 'assistant' && (
                <button onClick={() => copyMsg(m.content, i)}
                  className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
                  {copiedIdx === i ? <><Check className="h-3 w-3" /> Скопировано</> : <><Copy className="h-3 w-3" /> Копировать</>}
                </button>
              )}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-secondary/50 text-foreground">
              {streaming}
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
      </div>

      {/* Input */}
      <div className="border-t border-[#ECECEC] bg-white px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder="Спроси или попроси написать…"
            rows={1}
            className="flex-1 resize-none max-h-32 rounded-2xl border border-[#E0E0E0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50 bg-background"
          />
          <button onClick={toggleVoice}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
              listening ? 'border-red-400 bg-red-50 text-red-500' : 'border-[#E0E0E0] text-muted-foreground hover:text-foreground'
            }`}>
            {listening ? <Square className="h-4 w-4 fill-current" /> : <span className="text-base">🎤</span>}
          </button>
          {loading ? (
            <button onClick={stop} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={!input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        {listening && <p className="text-[11px] text-muted-foreground text-center mt-1.5">🎤 Говори — на iPhone текст появляется фразами после паузы</p>}
      </div>
    </div>
  )
}
