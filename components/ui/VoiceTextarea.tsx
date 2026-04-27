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
  // tracks committed value (without interim) so we can append finals incrementally
  const committedRef = useRef(value)

  // keep committedRef in sync whenever voice is not active
  useEffect(() => {
    if (!listening) committedRef.current = value
  }, [value, listening])

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

    recognition.onend = () => { setListening(false); setInterim('') }
    recognition.onerror = () => { setListening(false); setInterim('') }

    // sync committed before starting
    committedRef.current = value
    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
  }

  function stopListening() {
    recognitionRef.current?.stop()
    // onend will flip setListening(false)
  }

  return (
    <div className="space-y-1.5">
      <Textarea
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
