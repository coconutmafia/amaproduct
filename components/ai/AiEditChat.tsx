'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, Send, Loader2, CheckCircle, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { VoiceRecordButton } from '@/components/ui/VoiceRecordButton'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  role: 'user' | 'assistant'
  content: string
  changedDays?: Array<{ day: number; meaning: string }>
  updatedText?: string | null
}

interface AiEditChatProps {
  projectId: string
  contextType: 'warmup_plan' | 'content_item'
  contextId: string
  contextLabel?: string
  onPlanUpdate?: (updatedPlan: Record<string, unknown>) => void
  onContentUpdate?: (updatedText: string) => void
  disabled?: boolean
  // Draft mode: editing an unsaved warmup plan in the wizard. When set,
  // the route uses this plan_data instead of looking up a DB row by
  // contextId, and returns the edited plan without persisting.
  draftPlanData?: Record<string, unknown>
  // The week the user is currently viewing in the content plan, with the
  // weekday→day-number mapping so "change Wednesday's stories" hits the right day.
  weekContext?: {
    week: number
    days: Array<{ day: number; date?: string; dayOfWeek?: string; phase?: string; briefs?: Record<string, string> }>
  }
}

// ── Strip tags from display text ──────────────────────────────────────────────
// Also hides a still-OPEN <changes>/<content> block while it streams in (before
// the closing tag arrives) — otherwise raw JSON flashes on screen mid-stream.
function stripTags(text: string): string {
  return text
    .replace(/<changes>[\s\S]*?<\/changes>/g, '')
    .replace(/<content>[\s\S]*?<\/content>/g, '')
    .replace(/<changes>[\s\S]*$/g, '')      // dangling open block (streaming)
    .replace(/<content>[\s\S]*$/g, '')
    .replace(/<\/?[a-z]*$/gi, '')            // a partial tag like "<chan" at the very end
    .trim()
}

// ── Main component ────────────────────────────────────────────────────────────
export function AiEditChat({
  projectId,
  contextType,
  contextId,
  contextLabel,
  onPlanUpdate,
  onContentUpdate,
  disabled = false,
  draftPlanData,
  weekContext,
}: AiEditChatProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [pendingUpdate, setPendingUpdate] = useState<{
    updatedData: Record<string, unknown>
    changedDays?: Array<{ day: number; meaning: string }>
    updatedText?: string | null
  } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText])

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [open])


  const handleSend = useCallback(async () => {
    const instruction = input.trim()
    if (!instruction || loading) return

    setInput('')
    setPendingUpdate(null)

    const userMsg: Message = { role: 'user', content: instruction }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)
    setStreamingText('')

    // Build message history for API (only role+content)
    const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/ai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          contextType,
          contextId,
          messages: apiMessages,
          instruction,
          // When editing an unsaved plan in the wizard
          ...(draftPlanData ? { draftPlanData } : {}),
          // Which week is on screen → lets the AI resolve "Wednesday" to a real day
          ...(weekContext ? { weekContext } : {}),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }))
        throw new Error((err as { error?: string }).error || 'Ошибка сервера')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('Нет потока')

      const decoder = new TextDecoder()
      let buffer = ''
      let accText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          let finished = false
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue
            let data: {
              type: string
              delta?: string
              message?: string
              updatedData?: Record<string, unknown>
              changedDays?: Array<{ day: number; meaning: string }>
              updatedText?: string | null
            }
            try { data = JSON.parse(part.slice(6)) } catch { continue }

            if (data.type === 'text' && data.delta) {
              accText += data.delta
              setStreamingText(accText)
            } else if (data.type === 'done') {
              const assistantMsg: Message = {
                role: 'assistant',
                content: accText,
                changedDays: data.changedDays,
                updatedText: data.updatedText,
              }
              setMessages((prev) => [...prev, assistantMsg])
              setStreamingText('')

              // Store pending update for user to apply
              if (
                (data.changedDays && data.changedDays.length > 0) ||
                data.updatedText
              ) {
                setPendingUpdate({
                  updatedData: data.updatedData || {},
                  changedDays: data.changedDays,
                  updatedText: data.updatedText,
                })
              }

              finished = true
              break
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Ошибка')
            }
          }
          if (finished) break
        }
        if (done) break
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка')
      setMessages((prev) => prev.filter((m) => m !== userMsg))
    } finally {
      setLoading(false)
      setStreamingText('')
    }
  }, [input, loading, messages, projectId, contextType, contextId, draftPlanData, weekContext])

  const handleApply = useCallback(() => {
    if (!pendingUpdate) return

    if (contextType === 'warmup_plan' && onPlanUpdate) {
      onPlanUpdate(pendingUpdate.updatedData)
      const days = pendingUpdate.changedDays ?? []
      const count = days.length
      toast.success(`Изменено ${count} ${count === 1 ? 'день' : count < 5 ? 'дня' : 'дней'} плана ✓`)
      // In-chat confirmation so it's obvious the change landed (not just a toast).
      const which = count > 0 ? ` Обновлено: ${days.map((d) => `День ${d.day}`).join(', ')}.` : ''
      setMessages((prev) => [...prev, { role: 'assistant', content: `✅ Готово — изменения применены и сохранены в плане.${which} Закрой редактор, чтобы увидеть.` }])
    } else if (contextType === 'content_item' && onContentUpdate && pendingUpdate.updatedText) {
      onContentUpdate(pendingUpdate.updatedText)
      toast.success('Контент обновлён ✓')
      setMessages((prev) => [...prev, { role: 'assistant', content: '✅ Готово — текст обновлён.' }])
    }

    setPendingUpdate(null)
  }, [pendingUpdate, contextType, onPlanUpdate, onContentUpdate])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (disabled) return null

  return (
    <>
      {/* Floating button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-30 flex items-center gap-2 px-4 py-2.5 rounded-full gradient-accent text-white text-sm font-semibold shadow-lg shadow-[#E86BA0]/30 hover:opacity-90 transition-opacity lg:bottom-6"
        style={{ display: open ? 'none' : 'flex' }}
      >
        <Sparkles className="h-4 w-4" />
        AI-правка
      </motion.button>

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40 lg:hidden"
              onClick={() => setOpen(false)}
            />

            {/* Panel — bottom sheet on mobile, right sidebar on desktop */}
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border rounded-t-2xl shadow-2xl flex flex-col lg:left-auto lg:top-0 lg:bottom-0 lg:right-0 lg:w-[420px] lg:rounded-none lg:rounded-l-2xl lg:border-t-0 lg:border-l"
              style={{ maxHeight: '80vh', height: '80vh' }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg gradient-accent">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">AI-редактор</p>
                    {contextLabel && (
                      <p className="text-[10px] text-muted-foreground">{contextLabel}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
                {messages.length === 0 && !streamingText && (
                  <div className="text-center py-8 space-y-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-accent mx-auto opacity-60">
                      <Sparkles className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Спроси — и AI внесёт правку</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {contextType === 'warmup_plan'
                          ? 'Например: «Измени день 33, сделай тему про кейс клиента»'
                          : 'Например: «Сделай более провокационным» или «Сократи вдвое»'}
                      </p>
                    </div>
                    {/* Quick prompts */}
                    <div className="flex flex-wrap gap-2 justify-center pt-2">
                      {contextType === 'warmup_plan' ? (
                        <>
                          {['Измени день 1', 'Добавь эмоций в фазу желания', 'Сделай финал мощнее'].map((p) => (
                            <button
                              key={p}
                              onClick={() => setInput(p)}
                              className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all"
                            >
                              {p}
                            </button>
                          ))}
                        </>
                      ) : (
                        <>
                          {['Сделай провокационнее', 'Сократи вдвое', 'Добавь юмора', 'Усиль крючок'].map((p) => (
                            <button
                              key={p}
                              onClick={() => setInput(p)}
                              className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all"
                            >
                              {p}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'gradient-accent text-white rounded-br-sm'
                          : 'bg-secondary text-foreground rounded-bl-sm'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{stripTags(msg.content)}</p>
                      {/* Changed days badge */}
                      {msg.changedDays && msg.changedDays.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {msg.changedDays.map((d) => (
                            <span key={d.day} className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white font-medium">
                              День {d.day}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Streaming */}
                {streamingText && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm bg-secondary text-foreground leading-relaxed">
                      <p className="whitespace-pre-wrap">
                        {stripTags(streamingText)}
                        <span className="inline-block w-0.5 h-3.5 bg-primary animate-pulse ml-0.5 align-middle" />
                      </p>
                    </div>
                  </div>
                )}

                {/* Loading indicator */}
                {loading && !streamingText && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-secondary">
                      <div className="flex gap-1 items-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Apply button */}
              <AnimatePresence>
                {pendingUpdate && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="px-4 py-2 shrink-0"
                  >
                    <button
                      onClick={handleApply}
                      className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Применить изменения
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <div className="px-4 pb-4 pt-2 shrink-0 border-t border-border">
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        contextType === 'warmup_plan'
                          ? 'Что изменить в плане?'
                          : 'Что изменить в тексте?'
                      }
                      rows={1}
                      className="w-full resize-none rounded-xl border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
                      style={{ maxHeight: '120px' }}
                      onInput={(e) => {
                        const t = e.target as HTMLTextAreaElement
                        t.style.height = 'auto'
                        t.style.height = `${Math.min(t.scrollHeight, 120)}px`
                      }}
                    />
                  </div>

                  {/* Voice button — records audio + Whisper (works in webviews) */}
                  <VoiceRecordButton
                    onText={(t) => setInput(prev => (prev ? `${prev} ${t}` : t))}
                    className="h-10 w-10"
                    size={16}
                  />

                  {/* Send button */}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={handleSend}
                    disabled={!input.trim() || loading}
                    className="h-10 w-10 rounded-xl gradient-accent flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 text-white animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 text-white" />
                    )}
                  </motion.button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                  Enter — отправить · Shift+Enter — перенос · 🎤 — голос
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
