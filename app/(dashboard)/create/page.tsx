'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sparkles, Loader2, Copy, Check, User, FolderOpen, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { ChatComposer } from '@/components/ui/ChatComposer'
import { SaveButton } from '@/components/content/SaveButton'
import { CarouselSlides } from '@/components/carousel/CarouselSlides'
import { PostImage } from '@/components/carousel/PostImage'
import { StoryDesignButton } from '@/components/carousel/StoryDesignButton'
import { useChatPin } from '@/lib/useChatPin'
import { cleanMarkdown } from '@/lib/cleanText'

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface ProjectLite { id: string; name: string }

const SUGGESTIONS = [
  'Напиши вирусный рилз-сценарий на тему: …',
  'Накидай 5 идей постов на эту неделю',
  'Придумай сторителлинг-пост из моей истории',
  'Помоги протестировать гипотезу: зайдёт ли тема …',
]

export default function CreatePage() {
  const supabase = createClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Project data toggle: use a project's full context (voice, niche, cases,
  // funnel, competitors, ToV) or none (methodology-only).
  const [projects, setProjects] = useState<ProjectLite[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('id, name').order('updated_at', { ascending: false }).then(({ data }) => {
      const list = (data ?? []) as ProjectLite[]
      setProjects(list)
      // Default to the most recent project — most users want their own voice/data.
      // Functional update: an edit-handoff (below) may have already picked one.
      if (list.length > 0) setProjectId(prev => prev ?? list[0].id)
    })
  }, [supabase])

  // Edit handoff from «Готовое»: the saved text arrives via localStorage, the
  // chat opens it and ASKS what to change (owner flow: «как ты хочешь его
  // редактировать?»). Send fires once projectId from the handoff has settled.
  const [pendingEdit, setPendingEdit] = useState<{ text: string; projectId: string | null } | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ama_edit_prefill')
      if (!raw) return
      localStorage.removeItem('ama_edit_prefill')
      const d = JSON.parse(raw) as { text?: string; projectId?: string | null }
      if (!d.text) return
      if (d.projectId) setProjectId(d.projectId)
      setPendingEdit({ text: d.text, projectId: d.projectId ?? null })
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    if (!pendingEdit) return
    if (pendingEdit.projectId && projectId !== pendingEdit.projectId) return
    setPendingEdit(null)
    void send(`Вот мой готовый текст:\n\n${pendingEdit.text}\n\nХочу его отредактировать. Спроси, что именно поменять, и применяй мои правки по одной — каждый раз присылай обновлённый текст целиком.`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdit, projectId])

  const activeProject = projects.find(p => p.id === projectId) || null

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
    setLoading(true); setStreaming('')
    const controller = new AbortController(); abortRef.current = controller
    let acc = ''
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // projectId set → full project context (voice, niche, cases, funnel,
        // competitors, ToV). null → methodology-only standalone.
        body: JSON.stringify({ messages: next, projectId: projectId || undefined, conversationType: 'create' }),
        signal: controller.signal,
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Ошибка') }
      if (!res.body) throw new Error('Нет ответа')
      const reader = res.body.getReader(); const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true }); setStreaming(acc)
      }
      setMessages(prev => [...prev, { role: 'assistant', content: acc }]); setStreaming('')
    } catch (err) {
      if ((err as Error).name === 'AbortError') { if (acc.trim()) setMessages(prev => [...prev, { role: 'assistant', content: acc }]) }
      else toast.error(err instanceof Error ? err.message : 'Ошибка')
      setStreaming('')
    } finally { setLoading(false); abortRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading, projectId])

  const stop = () => abortRef.current?.abort()
  const copyMsg = (text: string, idx: number) => {
    navigator.clipboard?.writeText(text).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500) }).catch(() => toast.error('Не удалось'))
  }


  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <div className="border-b border-[#ECECEC] bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-accent"><Sparkles className="h-4 w-4 text-white" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground leading-tight">Быстрая генерация</p>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">
              {activeProject ? `Пишет под проект «${activeProject.name}» — твой голос и данные` : 'Без проекта · на нашей методологии'}
            </p>
          </div>
        </div>

        {/* Project data selector — use a project's voice/niche/cases/competitors, or none */}
        <div className="px-4 pb-2.5 relative">
          <button onClick={() => setPickerOpen(o => !o)}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
              activeProject ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-secondary/40 text-muted-foreground'
            }`}>
            <span className="flex items-center gap-1.5 truncate">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              {activeProject ? `Данные проекта: ${activeProject.name}` : 'Без данных проекта'}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>
          {pickerOpen && (
            <div className="absolute left-4 right-4 mt-1 rounded-xl border border-border bg-white shadow-lg z-30 overflow-hidden max-h-64 overflow-y-auto">
              <button onClick={() => { setProjectId(null); setPickerOpen(false) }}
                className={`w-full text-left px-3 py-2.5 text-xs hover:bg-secondary/60 ${!projectId ? 'text-primary font-semibold' : 'text-foreground'}`}>
                Без данных проекта <span className="text-muted-foreground">· только методология</span>
              </button>
              {projects.map(p => (
                <button key={p.id} onClick={() => { setProjectId(p.id); setPickerOpen(false) }}
                  className={`w-full text-left px-3 py-2.5 text-xs border-t border-[#F0F0F0] hover:bg-secondary/60 ${projectId === p.id ? 'text-primary font-semibold' : 'text-foreground'}`}>
                  {p.name} <span className="text-muted-foreground">· голос, ниша, кейсы, конкуренты</span>
                </button>
              ))}
              {projects.length === 0 && <p className="px-3 py-2.5 text-xs text-muted-foreground">Проектов пока нет</p>}
            </div>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent"><Sparkles className="h-7 w-7 text-white" /></div>
            <div>
              <p className="font-semibold text-foreground">Сгенерируем контент прямо здесь</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                {activeProject
                  ? `Пишу под проект «${activeProject.name}»: твой голос, ниша, кейсы, воронка и что зашло у конкурентов. Просто попроси.`
                  : 'Подбор ниши, тест гипотез, посты и сценарии на нашей методологии. Выбери проект выше — и пиши под твои данные и голос.'}
              </p>
            </div>
            <div className="w-full max-w-md space-y-2">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)} className="w-full text-left text-sm px-3.5 py-2.5 rounded-xl border border-[#ECECEC] hover:border-primary/40 hover:bg-primary/5 transition-all text-foreground">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLastUser = i === lastUserIdx
          const text = m.role === 'assistant' ? cleanMarkdown(m.content) : m.content
          return (
          <div key={i} ref={isLastUser ? lastUserRef : undefined} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''} ${isLastUser ? 'scroll-mt-2' : ''}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-secondary' : 'gradient-accent'}`}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Sparkles className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary/10' : 'bg-secondary/50'} text-foreground`}>
              {m.role === 'assistant' && (
                <div className="flex items-center gap-3 mb-2 pb-1.5 border-b border-black/[0.06] flex-wrap">
                  <button onClick={() => copyMsg(text, i)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
                    {copiedIdx === i ? <><Check className="h-3 w-3" /> Скопировано</> : <><Copy className="h-3 w-3" /> Копировать</>}
                  </button>
                  <SaveButton body={text} projectId={projectId} className="text-[11px] text-muted-foreground hover:text-primary" />
                  {/слайд\s*\d/i.test(text) ? (
                    <CarouselSlides sourceText={text} type="carousel" projectId={projectId || undefined} />
                  ) : /(сторис|stories|кадр)\s*\d/i.test(text) ? (
                    projectId ? <StoryDesignButton text={text} projectId={projectId} /> : null
                  ) : text.length > 150 ? (
                    <PostImage text={text} projectId={projectId || undefined} />
                  ) : null}
                </div>
              )}
              {text}
            </div>
          </div>
        )})}
        {streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent"><Sparkles className="h-3.5 w-3.5 text-white" /></div>
            <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-secondary/50 text-foreground">{cleanMarkdown(streaming)}<span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-primary/60 animate-pulse rounded-sm" /></div>
          </div>
        )}
        {loading && !streaming && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full gradient-accent"><Loader2 className="h-3.5 w-3.5 text-white animate-spin" /></div>
            <div className="rounded-2xl px-3.5 py-2.5 bg-secondary/50 text-sm text-muted-foreground">Думаю…</div>
          </div>
        )}
        {/* End marker + dynamic spacer: lets the question pin to the top, fills
            empty space below a short answer, collapses to 0 for a long one. */}
        <div ref={endRef} />
        <div aria-hidden style={{ height: tailSpace }} />
      </div>

      <ChatComposer value={input} onChange={setInput} onSend={() => send(input)}
        loading={loading} onStop={stop} placeholder="Опиши нишу/идею или попроси написать…" />
    </div>
  )
}
