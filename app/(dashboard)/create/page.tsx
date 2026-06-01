'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Sparkles, Loader2, Copy, Check, User, Square } from 'lucide-react'
import { toast } from 'sonner'
import { VoiceRecordButton } from '@/components/ui/VoiceRecordButton'

interface ChatMessage { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'Подбери мне нишу для блога — задай вопросы и предложи варианты',
  'Напиши вирусный рилз-сценарий на тему: …',
  'Накидай 5 идей постов для эксперта в нише …',
  'Помоги протестировать гипотезу: зайдёт ли тема …',
]

export default function CreatePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))
  }, [messages, streaming])

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || loading) return
    setInput('')
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setLoading(true); setStreaming('')
    const controller = new AbortController(); abortRef.current = controller
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, conversationType: 'standalone' }), // no projectId = standalone
        signal: controller.signal,
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Ошибка') }
      if (!res.body) throw new Error('Нет ответа')
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let acc = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true }); setStreaming(acc)
      }
      setMessages(prev => [...prev, { role: 'assistant', content: acc }]); setStreaming('')
    } catch (err) {
      if ((err as Error).name === 'AbortError') { if (streaming.trim()) setMessages(prev => [...prev, { role: 'assistant', content: streaming }]) }
      else toast.error(err instanceof Error ? err.message : 'Ошибка')
      setStreaming('')
    } finally { setLoading(false); abortRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading])

  const stop = () => abortRef.current?.abort()
  const copyMsg = (text: string, idx: number) => {
    navigator.clipboard?.writeText(text).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500) }).catch(() => toast.error('Не удалось'))
  }


  return (
    <div className="flex flex-col h-[calc(100vh-0px)] max-w-3xl mx-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#ECECEC] bg-white/95 backdrop-blur sticky top-0 z-10">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-accent"><Sparkles className="h-4 w-4 text-white" /></div>
        <div>
          <p className="text-sm font-bold text-foreground leading-tight">Быстрая генерация</p>
          <p className="text-[11px] text-muted-foreground leading-tight">Контент без проекта · на нашей методологии</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent"><Sparkles className="h-7 w-7 text-white" /></div>
            <div>
              <p className="font-semibold text-foreground">Сгенерируем контент прямо здесь</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">Без настройки проекта. Подбор ниши, тест гипотез, посты и сценарии — на нашей методологии прогревов.</p>
            </div>
            <div className="w-full max-w-md space-y-2">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)} className="w-full text-left text-sm px-3.5 py-2.5 rounded-xl border border-[#ECECEC] hover:border-primary/40 hover:bg-primary/5 transition-all text-foreground">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-secondary' : 'gradient-accent'}`}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Sparkles className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary/10' : 'bg-secondary/50'} text-foreground`}>
              {m.content}
              {m.role === 'assistant' && (
                <button onClick={() => copyMsg(m.content, i)} className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
                  {copiedIdx === i ? <><Check className="h-3 w-3" /> Скопировано</> : <><Copy className="h-3 w-3" /> Копировать</>}
                </button>
              )}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent"><Sparkles className="h-3.5 w-3.5 text-white" /></div>
            <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-secondary/50 text-foreground">{streaming}<span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-primary/60 animate-pulse rounded-sm" /></div>
          </div>
        )}
        {loading && !streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent"><Loader2 className="h-3.5 w-3.5 text-white animate-spin" /></div>
            <div className="rounded-2xl px-3.5 py-2.5 bg-secondary/50 text-sm text-muted-foreground">Думаю…</div>
          </div>
        )}
      </div>

      <div className="border-t border-[#ECECEC] bg-white px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder="Опиши нишу/идею или попроси написать…" rows={1}
            className="flex-1 resize-none max-h-32 rounded-2xl border border-[#E0E0E0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50 bg-background" />
          <VoiceRecordButton onText={(t) => setInput(prev => (prev ? `${prev} ${t}` : t))} className="h-10 w-10" size={17} />
          {loading ? (
            <button onClick={stop} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary"><Square className="h-4 w-4 fill-current" /></button>
          ) : (
            <button onClick={() => send(input)} disabled={!input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </div>
  )
}
