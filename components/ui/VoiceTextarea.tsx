'use client'

import { useRef, useEffect } from 'react'
import { Mic, X, Check, Loader2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useVoiceRecorder, formatVoiceTime } from '@/lib/useVoiceRecorder'

interface VoiceTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
}

// Dense ChatGPT-style waveform that fills the field while recording.
// Deterministic heights/delays (no Math.random) so it animates like a live wave.
const WAVE = Array.from({ length: 28 }, (_, i) => {
  const heights = [6, 10, 16, 11, 7, 14, 20, 9, 5, 12, 18, 8, 13, 17, 7]
  return { h: heights[i % heights.length], delay: `${(i % 6) * 0.09}s`, dur: `${0.7 + (i % 4) * 0.12}s` }
})

/**
 * Textarea with reliable "record → Whisper" dictation (works in iOS Safari and
 * in-app webviews, unlike the browser Web Speech API which lags and drops the
 * tail of an utterance).
 *
 * While recording, the field itself shows a live waveform + timer — NO words
 * stream in. The whole transcription is inserted at once when you tap ✓, after
 * a short "Распознаю речь…" step. Same UX as the content-creation chat composer.
 */
export function VoiceTextarea({ value, onChange, placeholder, rows = 3, className }: VoiceTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Keep the latest value in a ref so the recorder's async onText appends to the
  // current text instead of a stale snapshot from when recording started.
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const { state, seconds, start, stop, cancel } = useVoiceRecorder((t) => {
    const cur = valueRef.current
    onChange(cur ? `${cur} ${t}` : t)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 280)}px` }
    })
  })

  // Keep the field box roughly the textarea's size so the layout doesn't jump
  // when we swap the textarea for the recording / transcribing panel.
  const minHeight = rows * 24 + 18

  if (state === 'recording') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-white px-2" style={{ minHeight }}>
          <button type="button" onClick={cancel} title="Отменить"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E0E0E0] text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-full bg-red-500 text-white voice-rec-pulse min-w-0">
            <span className="h-2 w-2 rounded-full bg-white/90 animate-pulse shrink-0" />
            <span className="flex-1 flex items-center justify-between gap-[2px] h-5 overflow-hidden">
              {WAVE.map((b, i) => (
                <span key={i} className="voicebar" style={{ height: b.h, animationDelay: b.delay, animationDuration: b.dur }} />
              ))}
            </span>
            <span className="text-xs font-semibold tabular-nums shrink-0">{formatVoiceTime(seconds)}</span>
          </div>
          <button type="button" onClick={stop} title="Готово"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white">
            <Check className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-center text-muted-foreground">Говори — потом нажми ✓, текст появится в поле</p>
      </div>
    )
  }

  if (state === 'transcribing') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 text-primary" style={{ minHeight }}>
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span className="text-sm font-medium">Распознаю речь…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(className)}
      />
      <button type="button" onClick={start} title="Надиктовать голосом"
        className="w-full h-9 flex items-center justify-center gap-2 text-xs font-medium rounded-lg bg-secondary border border-border text-muted-foreground hover:text-foreground transition-colors">
        <Mic className="h-3.5 w-3.5" /> Надиктовать голосом
      </button>
    </div>
  )
}
