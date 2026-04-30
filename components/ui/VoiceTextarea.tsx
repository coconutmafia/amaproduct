'use client'

import { useState, useRef, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Mic, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VoiceTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
}

export function VoiceTextarea({ value, onChange, placeholder, rows = 3, className }: VoiceTextareaProps) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const committedRef = useRef(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Flag to suppress restart after manual stop
  const manualStopRef = useRef(false)

  // keep committedRef in sync whenever voice is not active
  useEffect(() => {
    if (!listening) committedRef.current = value
  }, [value, listening])

  // Auto-scroll textarea to bottom when new text arrives during dictation
  useEffect(() => {
    if (listening && textareaRef.current) {
      const el = textareaRef.current
      // Use rAF so the DOM has finished painting the new text before we scroll
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
        // Also try to grow the textarea visually if content overflows
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 280)}px`
      })
    }
  }, [interim, value, listening])

  // what to display in the textarea — shows live interim text as user speaks
  const displayValue = listening && interim
    ? (committedRef.current ? committedRef.current + ' ' + interim : interim)
    : value

  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Голосовой ввод недоступен. Используйте Chrome или Safari.')
      return
    }

    manualStopRef.current = false
    committedRef.current = value

    const recognition = new SR()
    recognition.lang = 'ru-RU'
    recognition.continuous = true      // не останавливаться после паузы
    recognition.interimResults = true  // слова появляются мгновенно

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript
        else interimChunk += event.results[i][0].transcript
      }
      if (finalChunk) {
        const next = committedRef.current
          ? committedRef.current + ' ' + finalChunk
          : finalChunk
        committedRef.current = next
        onChange(next)
        setInterim('')
      } else {
        setInterim(interimChunk)
      }
    }

    recognition.onend = () => {
      // Auto-restart if user didn't manually stop — browser often stops after silence
      // Use setTimeout to give the browser a moment before restarting (iOS needs this)
      if (!manualStopRef.current && recognitionRef.current === recognition) {
        setTimeout(() => {
          if (!manualStopRef.current && recognitionRef.current === recognition) {
            try { recognition.start() } catch { /* already started or permission issue */ }
          }
        }, 150)
        return
      }
      setListening(false)
      setInterim('')
    }

    recognition.onerror = (e: Event & { error?: string }) => {
      const err = (e as { error?: string }).error
      // not-allowed = microphone blocked, abort = manually aborted
      if (err === 'not-allowed' || err === 'aborted') {
        manualStopRef.current = true
        setListening(false)
        setInterim('')
        if (err === 'not-allowed') alert('Нет доступа к микрофону. Разреши в настройках браузера.')
        return
      }
      // For other errors (no-speech, network, etc.) — restart if still active
      if (!manualStopRef.current) {
        setTimeout(() => {
          if (!manualStopRef.current && recognitionRef.current === recognition) {
            try { recognition.start() } catch { /* ignore */ }
          }
        }, 300)
      } else {
        setListening(false)
        setInterim('')
      }
    }

    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
  }

  function stopListening() {
    manualStopRef.current = true
    recognitionRef.current?.stop()
    setListening(false)
    setInterim('')
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={textareaRef}
        value={displayValue}
        onChange={e => {
          // manual edits override voice
          committedRef.current = e.target.value
          onChange(e.target.value)
        }}
        placeholder={placeholder}
        rows={rows}
        className={cn(listening && 'border-red-400/60 bg-red-500/5', className)}
      />

      {/* Voice button — full-width strip, easy to tap on mobile */}
      <button
        type="button"
        // onPointerDown fires before onClick — ~150ms faster on mobile
        onPointerDown={e => { e.preventDefault(); listening ? stopListening() : startListening() }}
        className={cn(
          'w-full flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all select-none',
          listening
            ? 'bg-red-500/15 text-red-400 border border-red-400/40 hover:bg-red-500/25'
            : 'bg-secondary text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/80'
        )}
      >
        {listening ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400" />
            </span>
            <Square className="h-3 w-3 fill-current" />
            Записываю... нажми чтобы остановить
          </>
        ) : (
          <>
            <Mic className="h-3.5 w-3.5" />
            Надиктовать голосом
          </>
        )}
      </button>
    </div>
  )
}
