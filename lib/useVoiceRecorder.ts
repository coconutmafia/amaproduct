'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

/**
 * Records audio (MediaRecorder) and transcribes via Whisper (/api/ai/transcribe-voice).
 * Works in in-app webviews and iOS Safari where the Web Speech API is unreliable.
 * Exposes a live `seconds` counter for a ChatGPT-style recording bar.
 *
 *  start()  → begin recording
 *  stop()   → stop + transcribe + onText(result)
 *  cancel() → stop + discard (no transcription)
 */
export function useVoiceRecorder(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discardRef = useRef(false)

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const stopTracks = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }

  // Stop the timer whenever we leave the recording state (and on unmount).
  useEffect(() => {
    if (state !== 'recording') clearTimer()
    return clearTimer
  }, [state])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Запись недоступна в этом браузере. Открой в Safari или используй клавиатуру.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported?.(m)) || ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      discardRef.current = false
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stopTracks()
        if (discardRef.current) { setState('idle'); return }
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
  }, [onText])

  const stop = useCallback(() => {
    discardRef.current = false
    try { recorderRef.current?.stop() } catch { /* ignore */ }
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    try { recorderRef.current?.stop() } catch { /* ignore */ }
    setState('idle')
  }, [])

  return { state, seconds, start, stop, cancel }
}

export function formatVoiceTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
