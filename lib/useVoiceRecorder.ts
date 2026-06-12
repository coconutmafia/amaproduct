'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

// Vercel rejects request bodies over ~4.5 MB BEFORE our route runs, so long
// dictations (a few minutes on iOS = AAC at a high bitrate) died with an opaque
// error. Small clips still go direct (one request, fastest); anything bigger
// is uploaded to Supabase Storage and transcribed via /api/ai/transcribe —
// the same path interview uploads use.
const DIRECT_LIMIT = 3.5 * 1024 * 1024
const MAX_BYTES    = 20 * 1024 * 1024 // matches the server cap (~15+ min of audio)

// Weak mobile networks drop long uploads: fetch hangs forever or dies with
// Safari's «Load failed» (owner video). Every network call gets a hard timeout,
// the direct path retries once, and errors become human.
const NET_ERR = 'Сеть оборвалась при отправке записи — проверь интернет и надиктуй ещё раз'

async function fetchT(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Загрузка записи заняла слишком долго — проверь интернет и попробуй ещё раз')
    throw new Error(NET_ERR)
  } finally { clearTimeout(t) }
}

async function transcribeBlob(blob: Blob, mimeType: string): Promise<string> {
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'

  if (blob.size <= DIRECT_LIMIT) {
    const direct = async () => {
      const fd = new FormData()
      fd.append('audio', blob, `voice.${ext}`)
      const res = await fetchT('/api/ai/transcribe-voice', { method: 'POST', body: fd }, 90_000)
      const data = await res.json().catch(() => ({})) as { text?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Ошибка расшифровки')
      return data.text ?? ''
    }
    try {
      return await direct()
    } catch (e) {
      // One automatic retry on a network drop before giving up
      if (e instanceof Error && (e.message === NET_ERR || e.message.includes('слишком долго'))) {
        await new Promise((r) => setTimeout(r, 900))
        return direct()
      }
      throw e
    }
  }

  // Long recording → Storage route (bypasses the body-size limit)
  const urlRes = await fetchT('/api/ai/transcribe/upload-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ext }),
  }, 30_000)
  const urlData = await urlRes.json().catch(() => ({})) as { path?: string; token?: string; error?: string }
  if (!urlRes.ok || !urlData.path || !urlData.token) throw new Error(urlData.error ?? 'Не удалось подготовить загрузку')

  const supabase = createClient()
  const { error: upErr } = await supabase.storage.from('audio-temp')
    .uploadToSignedUrl(urlData.path, urlData.token, blob)
  if (upErr) throw new Error(NET_ERR)

  try {
    const res = await fetchT('/api/ai/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath: urlData.path, ext, isLastChunk: true }), // isLastChunk → route deletes the temp file
    }, 120_000)
    const data = await res.json().catch(() => ({})) as { text?: string; error?: string }
    if (!res.ok || data.error) throw new Error(data.error ?? 'Ошибка расшифровки')
    return (data.text ?? '').trim()
  } catch (err) {
    await supabase.storage.from('audio-temp').remove([urlData.path]).catch(() => {})
    throw err
  }
}

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
  const discardRef = useRef(false)

  const stopTracks = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }

  // Run the seconds counter WHILE recording. Driving the interval from the effect
  // (not from start()) is what makes it actually tick — setting it inside start()
  // before setState got it cleared immediately by this effect's cleanup.
  useEffect(() => {
    if (state !== 'recording') return
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [state])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Запись недоступна в этом браузере. Открой в Safari или используй клавиатуру.')
      return
    }
    try {
      // Mono + modest bitrate: a 1-minute clip drops from ~2MB to ~350KB, so
      // uploads survive weak LTE (constraints are "ideal" — safe everywhere).
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported?.(m)) || ''
      let rec: MediaRecorder
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48_000 }) : new MediaRecorder(stream, { audioBitsPerSecond: 48_000 })
      } catch {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      }
      chunksRef.current = []
      discardRef.current = false
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stopTracks()
        if (discardRef.current) { setState('idle'); return }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 800) { setState('idle'); return } // too short / silence
        if (blob.size > MAX_BYTES) {
          toast.error('Запись слишком длинная (больше ~15 минут) — раздели на части')
          setState('idle'); return
        }
        setState('transcribing')
        try {
          const text = await transcribeBlob(blob, rec.mimeType || 'audio/webm')
          if (text) onText(text)
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
      setState('recording') // the effect above starts the seconds timer
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
