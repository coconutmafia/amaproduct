'use client'

import { useRef, useEffect } from 'react'
import { Send, Square, Mic, X, Check, Loader2 } from 'lucide-react'
import { useVoiceRecorder, formatVoiceTime } from '@/lib/useVoiceRecorder'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  loading: boolean          // AI is generating a response
  onStop: () => void        // stop the AI generation
  placeholder?: string
}

// Dense ChatGPT-style waveform that spans the full composer width while recording.
// Deterministic heights/delays (no Math.random) so it animates like a live wave.
const WAVE = Array.from({ length: 30 }, (_, i) => {
  const heights = [6, 10, 16, 11, 7, 14, 20, 9, 5, 12, 18, 8, 13, 17, 7]
  return { h: heights[i % heights.length], delay: `${(i % 6) * 0.09}s`, dur: `${0.7 + (i % 4) * 0.12}s` }
})

/**
 * Chat input row used by /create and the project assistant. Three states:
 *  - idle:        textarea + mic + send (or stop-AI while loading)
 *  - recording:   full-width bar — cancel · live waveform + timer · confirm
 *  - transcribing: full-width "Распознаю речь…" bar
 * Voice transcription is appended to the current input so the user can review
 * and edit before sending (not auto-sent).
 */
export function ChatComposer({ value, onChange, onSend, loading, onStop, placeholder }: Props) {
  // Keep latest value in a ref so the recorder's async onText appends correctly.
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const { state, seconds, start, stop, cancel } = useVoiceRecorder((t) => {
    const cur = valueRef.current
    onChange(cur ? `${cur} ${t}` : t)
  })

  if (state === 'recording') {
    return (
      <div className="border-t border-[#ECECEC] bg-white px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-2">
          <button onClick={cancel} title="Отменить"
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
          <button onClick={stop} title="Готово"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white">
            <Check className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-center text-muted-foreground mt-1.5">Говори — потом нажми ✓, текст появится в поле</p>
      </div>
    )
  }

  if (state === 'transcribing') {
    return (
      <div className="border-t border-[#ECECEC] bg-white px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-2 h-10 px-4 rounded-full border border-primary/30 bg-primary/5 text-primary">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span className="text-sm font-medium">Распознаю речь…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-[#ECECEC] bg-white px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <div className="flex items-end gap-2">
        <textarea value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
          placeholder={placeholder} rows={1}
          className="flex-1 resize-none max-h-32 rounded-2xl border border-[#E0E0E0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50 bg-background" />
        <button onClick={start} title="Надиктовать голосом"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E0E0E0] text-muted-foreground hover:text-foreground transition-colors">
          <Mic className="h-[17px] w-[17px]" />
        </button>
        {loading ? (
          <button onClick={onStop} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
            <Square className="h-4 w-4 fill-current" />
          </button>
        ) : (
          <button onClick={onSend} disabled={!value.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
