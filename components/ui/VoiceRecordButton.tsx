'use client'

import { useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
  onText: (text: string) => void   // called with transcribed text (caller appends)
  className?: string
  size?: number                     // icon size px
  label?: boolean                   // show a text label next to the icon
}

/**
 * Records audio (MediaRecorder) and transcribes via Whisper (/api/ai/transcribe-voice).
 * Works in in-app webviews and iOS Safari where the Web Speech API is unreliable.
 * Tap to start → tap to stop → text inserted.
 */
export function VoiceRecordButton({ onText, className, size = 18, label = false }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const stopTracks = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Запись недоступна в этом браузере. Открой в Safari или используй клавиатуру.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      // Pick a mime the browser supports
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported?.(m)) || ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stopTracks()
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 800) { setState('idle'); return } // too short / silence
        setState('transcribing')
        try {
          const fd = new FormData()
          fd.append('audio', blob, `voice.${(rec.mimeType || 'webm').includes('mp4') ? 'mp4' : 'webm'}`)
          const res = await fetch('/api/ai/transcribe-voice', { method: 'POST', body: fd })
          const data = await res.json().catch(() => ({})) as { text?: string; error?: string }
          if (!res.ok || data.error) throw new Error(data.error ?? 'Ошибка расшифровки')
          if (data.text) onText(data.text)
          else toast.message('Ничего не распознал — попробуй ещё раз')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Ошибка расшифровки')
        } finally {
          setState('idle')
        }
      }
      rec.start()
      recorderRef.current = rec
      setState('recording')
    } catch {
      stopTracks()
      toast.error('Нет доступа к микрофону. Разреши в настройках браузера.')
      setState('idle')
    }
  }

  const stop = () => { try { recorderRef.current?.stop() } catch { /* ignore */ } }

  const onClick = () => {
    if (state === 'recording') stop()
    else if (state === 'idle') start()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'transcribing'}
      title={state === 'recording' ? 'Остановить' : 'Надиктовать'}
      className={cn(
        'flex items-center justify-center gap-2 rounded-full border transition-all shrink-0',
        state === 'recording' ? 'border-red-400 bg-red-500 text-white'
        : state === 'transcribing' ? 'border-primary/40 bg-primary/5 text-primary'
        : 'border-[#E0E0E0] text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {state === 'transcribing'
        ? <Loader2 style={{ width: size, height: size }} className="animate-spin" />
        : state === 'recording'
        ? (
          // Animated equalizer — clear "listening" feedback like ChatGPT
          <span className="flex items-end gap-[2px]" style={{ height: size }}>
            {[0, 1, 2, 3].map(i => (
              <span key={i} className="voicebar" style={{ height: size, animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
        )
        : <Mic style={{ width: size, height: size }} />}
      {label && <span>{state === 'transcribing' ? 'Распознаю речь…' : state === 'recording' ? 'Идёт запись — нажми чтобы остановить' : 'Надиктовать голосом'}</span>}
    </button>
  )
}
