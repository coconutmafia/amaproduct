'use client'

import { useRef, useEffect, useState } from 'react'
import { Send, Square, Mic, X, Check, Loader2, ImagePlus } from 'lucide-react'
import { useVoiceRecorder, formatVoiceTime } from '@/lib/useVoiceRecorder'
import { toast } from 'sonner'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  loading: boolean          // AI is generating a response
  onStop: () => void        // stop the AI generation
  placeholder?: string
  // Картинки к сообщению (data:image/jpeg;base64,…). Заданы — показываем
  // кнопку-скрепку и превью; не заданы — композер прежний.
  images?: string[]
  onImagesChange?: (v: string[]) => void
}

// Просьба клиента 26.08: «нет кнопки добавить фото/видео в чат».
// ФОТО отдаём модели (она их видит), ВИДЕО — нет: у моделей нет входа для
// видео, для него в продукте есть отдельные пути (залетевшие рилзы и монтаж),
// поэтому на видеофайл честно говорим, куда идти, вместо молчаливого отказа.
const MAX_IMAGES = 3
const MAX_EDGE = 1568   // рекомендованный максимум длинной стороны для модели

// Ужимаем в браузере: 5-мегабайтное фото с телефона иначе не влезет в тело
// запроса (лимит функции ~4.5 МБ), да и платить за лишние токены незачем.
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.82)
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
export function ChatComposer({ value, onChange, onSend, loading, onStop, placeholder, images, onImagesChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const canAttach = !!onImagesChange
  const imgs = images ?? []

  const pickFiles = async (files: FileList | null) => {
    if (!files || !onImagesChange) return
    const picked = Array.from(files)
    const video = picked.find(f => f.type.startsWith('video/'))
    if (video) {
      toast.info('Видео ассистент не смотрит. Залетевший рилз добавь в «Тренды» по ссылке — система его расшифрует и разберёт; своё видео с текстом собирается в «Монтаже».')
    }
    const photos = picked.filter(f => f.type.startsWith('image/')).slice(0, MAX_IMAGES - imgs.length)
    if (photos.length === 0) return
    setPreparing(true)
    try {
      const next = [...imgs]
      for (const f of photos) {
        try { next.push(await downscale(f)) }
        catch { toast.error(`Не удалось прочитать «${f.name}»`) }
      }
      onImagesChange(next.slice(0, MAX_IMAGES))
    } finally {
      setPreparing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
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
      {canAttach && imgs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {imgs.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-14 w-14 rounded-lg object-cover border border-border" />
              <button
                type="button"
                onClick={() => onImagesChange?.(imgs.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center"
                aria-label="Убрать фото"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        {canAttach && (
          <>
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden
              onChange={e => pickFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} title="Добавить фото"
              disabled={preparing || imgs.length >= MAX_IMAGES}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E0E0E0] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
              {preparing ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <ImagePlus className="h-[17px] w-[17px]" />}
            </button>
          </>
        )}
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
          <button onClick={onSend} disabled={!value.trim() && imgs.length === 0}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
