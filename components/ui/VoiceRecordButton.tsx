'use client'

import { useRef, useState, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
  onText: (text: string) => void   // called with transcribed text (caller appends)
  className?: string
  size?: number                     // icon size px
  label?: boolean                   // show a text label next to the icon
}

// Organic ChatGPT-like waveform: bars of different heights / speeds so it reads
// as a live "listening" wave, not a uniform equalizer.
const BARS = [
  { h: 0.5,  delay: '0s',    dur: '0.80s' },
  { h: 0.95, delay: '0.15s', dur: '1.00s' },
  { h: 0.65, delay: '0.30s', dur: '0.70s' },
  { h: 1.0,  delay: '0.10s', dur: '0.90s' },
  { h: 0.55, delay: '0.25s', dur: '0.85s' },
]

function Waveform({ size, color }: { size: number; color?: string }) {
  return (
    <span className="flex items-center gap-[2.5px]" style={{ height: size, color }}>
      {BARS.map((b, i) => (
        <span key={i} className="voicebar"
          style={{ height: Math.round(size * b.h), animationDelay: b.delay, animationDuration: b.dur }} />
      ))}
    </span>
  )
}

/**
 * Records audio (MediaRecorder) and transcribes via Whisper (/api/ai/transcribe-voice).
 * Works in in-app webviews and iOS Safari where the Web Speech API is unreliable.
 * Tap to start → tap to stop → text inserted. While recording it shows a
 * ChatGPT-style live waveform + running timer.
 */
export function VoiceRecordButton({ onText, className, size = 18, label = false }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  // Stop the mic timer when recording ends (and on unmount).
  useEffect(() => {
    if (state !== 'recording') clearTimer()
    return clearTimer
  }, [state])

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
      setSeconds(0)
      clearTimer()
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
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

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'transcribing'}
      title={state === 'recording' ? 'Остановить запись' : 'Надиктовать голосом'}
      // Icon buttons are passed a fixed w-10; while recording the pill needs to
      // grow (waveform + timer). Inline width wins over the class. Full-width
      // (label) buttons keep their w-full.
      style={state === 'recording' && !label ? { width: 'auto' } : undefined}
      className={cn(
        'flex items-center justify-center gap-2 rounded-full border transition-all shrink-0',
        state === 'recording'
          ? 'border-red-400 bg-red-500 text-white px-3 voice-rec-pulse'
          : state === 'transcribing'
          ? 'border-primary/40 bg-primary/5 text-primary'
          : 'border-[#E0E0E0] text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {state === 'transcribing' ? (
        <>
          <Loader2 style={{ width: size, height: size }} className="animate-spin" />
          {label && <span>Распознаю речь…</span>}
        </>
      ) : state === 'recording' ? (
        <>
          {/* pulsing dot + live waveform + timer — ChatGPT-style */}
          <span className="h-2 w-2 rounded-full bg-white/90 animate-pulse shrink-0" />
          <Waveform size={size} />
          <span className="text-xs font-semibold tabular-nums">{mmss}</span>
          {label
            ? <span className="ml-0.5">Идёт запись — нажми, чтобы остановить</span>
            : <Square className="h-3 w-3 fill-current shrink-0" />}
        </>
      ) : (
        <>
          <Mic style={{ width: size, height: size }} />
          {label && <span>Надиктовать голосом</span>}
        </>
      )}
    </button>
  )
}
