'use client'

import { Mic, Square, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceRecorder, formatVoiceTime } from '@/lib/useVoiceRecorder'

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

function Waveform({ size }: { size: number }) {
  return (
    <span className="flex items-center gap-[2.5px]" style={{ height: size }}>
      {BARS.map((b, i) => (
        <span key={i} className="voicebar"
          style={{ height: Math.round(size * b.h), animationDelay: b.delay, animationDuration: b.dur }} />
      ))}
    </span>
  )
}

/**
 * Tap-to-record voice button. While recording it shows a live waveform + timer.
 * For the chat composer (full-width recording bar) see ChatComposer; this is the
 * compact button used inside VoiceTextarea and other forms.
 */
export function VoiceRecordButton({ onText, className, size = 18, label = false }: Props) {
  const { state, seconds, start, stop } = useVoiceRecorder(onText)

  const onClick = () => {
    if (state === 'recording') stop()
    else if (state === 'idle') start()
  }

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
          <span className="h-2 w-2 rounded-full bg-white/90 animate-pulse shrink-0" />
          <Waveform size={size} />
          <span className="text-xs font-semibold tabular-nums">{formatVoiceTime(seconds)}</span>
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
