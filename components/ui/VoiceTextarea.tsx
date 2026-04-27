'use client'

import { useState, useRef, useCallback } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Mic, MicOff } from 'lucide-react'
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
  const recognitionRef = useRef<unknown>(null)

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Ваш браузер не поддерживает голосовой ввод. Попробуйте Chrome или Safari.')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SR() as any
    recognition.lang = 'ru-RU'
    recognition.continuous = false
    recognition.interimResults = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript: string = event.results[0][0].transcript
      onChange(value ? value + ' ' + transcript : transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
  }, [value, onChange])

  const stopListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(recognitionRef.current as any)?.stop()
    setListening(false)
  }, [])

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn('pr-9', className)}
      />
      <button
        type="button"
        onClick={listening ? stopListening : startListening}
        title={listening ? 'Остановить запись' : 'Голосовой ввод'}
        className={cn(
          'absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-md transition-colors',
          listening
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 animate-pulse'
            : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
        )}
      >
        {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
