'use client'

// Shared «Загрузка фото» block for the unified content studio (Пост / Карусель /
// Сторис). Universal title, ordering (← →), removal (✕), frame-number badges,
// and the explainer caption BELOW the block (tester's spec, UNIFY_EDITOR.md).

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'
import { friendlyError } from '@/lib/friendlyError'

export function PhotoUploader({ projectId, photos, onChange, kind = 'post', max = 8, showOrderHint = true, persistKey }: {
  projectId: string
  photos: string[]
  onChange: (next: string[]) => void
  /** storage bucket folder — 'post' | 'story' | 'carousel' */
  kind?: string
  max?: number
  /** single-photo formats (пост) don't need the series explainer */
  showOrderHint?: boolean
  /** when set, the chosen photos survive a page reload for THIS publication */
  persistKey?: string
}) {
  const [uploading, setUploading] = useState(false)

  // Restore/persist the chosen photos per publication (tester: «перезагрузила —
  // фото сбросилось»). Storage URLs only, so this is cheap.
  const lsKey = persistKey ? `ama_photos_${persistKey}` : null
  const restored = useRef(false)
  useEffect(() => {
    if (!lsKey || restored.current) return
    restored.current = true
    if (photos.length > 0) return
    try {
      const raw = localStorage.getItem(lsKey)
      const saved = raw ? (JSON.parse(raw) as string[]) : []
      if (Array.isArray(saved) && saved.length) onChange(saved.slice(0, max))
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey])
  useEffect(() => {
    if (!lsKey || !restored.current) return
    try {
      if (photos.length) localStorage.setItem(lsKey, JSON.stringify(photos))
      else localStorage.removeItem(lsKey)
    } catch { /* ignore */ }
  }, [photos, lsKey])

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const added: string[] = []
      for (const f of Array.from(files).slice(0, max - photos.length)) {
        const small = await downscaleImage(f, 2000)
        const fd = new FormData()
        fd.append('projectId', projectId)
        fd.append('kind', kind)
        fd.append('files', small)
        const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
        const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
        if (!res.ok) throw new Error(d.error || (res.status === 413 ? 'Фото слишком большое' : `Не удалось загрузить (${res.status})`))
        added.push(...(d.urls || []))
      }
      onChange([...photos, ...added].slice(0, max))
    } catch (e) { toast.error(friendlyError(e, 'Не удалось загрузить')) }
    finally { setUploading(false) }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= photos.length) return
    const next = [...photos]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    onChange(next)
  }
  function remove(i: number) {
    onChange(photos.filter((_, idx) => idx !== i))
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">Загрузка фото</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {photos.map((u, i) => (
          <div key={u} className="flex flex-col items-center gap-1">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Фото ${i + 1}`} className="h-24 w-[3.4rem] rounded-lg border border-border object-cover" />
              {max > 1 && <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] font-bold leading-4 text-white">{i + 1}</span>}
              <button type="button" onClick={() => remove(i)} aria-label="Убрать фото"
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-white text-[#888] shadow-sm hover:border-red-200 hover:text-red-500">
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            {max > 1 && (
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Левее"
                  className="flex h-5 w-5 items-center justify-center rounded border border-border text-[#888] hover:text-primary disabled:opacity-30">
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === photos.length - 1} aria-label="Правее"
                  className="flex h-5 w-5 items-center justify-center rounded border border-border text-[#888] hover:text-primary disabled:opacity-30">
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
        {photos.length < max && (
          <label className="flex h-24 w-[3.4rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="text-[9px]">фото</span>
            <input type="file" accept="image/*" multiple={max > 1} className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
        )}
      </div>

      {uploading && <p className="mt-2 text-[11px] text-muted-foreground">Загружаю и сжимаю фото — обычно 5-15 секунд на фото.</p>}

      {/* Explainer sits BELOW the block (tester's request) */}
      {showOrderHint && max > 1 && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Если у вас серия, загружайте по одному фото на кадр; если фото меньше чем кадров — кадр повторится.
          Порядок фото = порядок кадров: 1-е фото → 1-й кадр. Меняй местами стрелками ← →, лишнее убирай ✕.
        </p>
      )}
    </section>
  )
}
