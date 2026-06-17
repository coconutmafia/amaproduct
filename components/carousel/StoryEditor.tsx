'use client'

// «Редактор сторис как в Инстаграме» (v1) — drop a photo, add text blocks, DRAG
// them anywhere, tune size/colour/plate, export a 1080×1920 image through our
// slide engine (kind 'free') so the fonts/plates match the rest of the app.

import { useRef, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, Plus, Trash2, Download, Type } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'

const ACCENT = '#EC1E8C'
const COLORS = ['#FFFFFF', '#111111', ACCENT]
let _idc = 0
const newId = () => `b${++_idc}`
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

interface Block {
  id: string; text: string
  xPct: number; yPct: number; widthPct: number
  size: number; color: string; plate: boolean; align: 'left' | 'center'
}

// Render **accent** markers (+ optional per-line plate) for the on-screen preview.
function PreviewText({ text, plate, color }: { text: string; plate: boolean; color: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  const nodes = parts.map((p, i) => {
    const em = p.startsWith('**') && p.endsWith('**')
    return <span key={i} style={{ color: em ? ACCENT : (plate ? '#1A1A1A' : color), fontWeight: em ? 900 : 800 }}>{em ? p.slice(2, -2) : p}</span>
  })
  if (!plate) return <span>{nodes}</span>
  return (
    <span style={{
      background: '#FFFFFF', padding: '0.14em 0.26em', borderRadius: '0.14em',
      boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
    } as React.CSSProperties}>{nodes}</span>
  )
}

export function StoryEditor({ projectId }: { projectId: string }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [canvasW, setCanvasW] = useState(360)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; px: number; py: number; x0: number; y0: number; w: number; h: number } | null>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.getBoundingClientRect().width || 360))
    ro.observe(el)
    setCanvasW(el.getBoundingClientRect().width || 360)
    return () => ro.disconnect()
  }, [])

  const onMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.px) / d.w
    const dy = (e.clientY - d.py) / d.h
    setBlocks((prev) => prev.map((b) => b.id === d.id ? { ...b, xPct: clamp(d.x0 + dx, 0, 0.97), yPct: clamp(d.y0 + dy, 0, 0.97) } : b))
  }, [])
  const onUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }, [onMove])

  function startDrag(e: React.PointerEvent, id: string) {
    e.preventDefault()
    setSelected(id)
    const rect = canvasRef.current?.getBoundingClientRect()
    const b = blocks.find((x) => x.id === id)
    if (!rect || !b) return
    dragRef.current = { id, px: e.clientX, py: e.clientY, x0: b.xPct, y0: b.yPct, w: rect.width, h: rect.height }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  async function uploadPhoto(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setUploadingPhoto(true)
    try {
      const small = await downscaleImage(f, 2000)
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('kind', 'story')
      fd.append('files', small)
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
      if (!res.ok || !d.urls?.[0]) throw new Error(d.error || (res.status === 413 ? 'Фото слишком большое' : 'Не удалось загрузить фото'))
      setPhotoUrl(d.urls[0])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить фото') }
    finally { setUploadingPhoto(false) }
  }

  function addBlock() {
    const id = newId()
    setBlocks((p) => [...p, { id, text: 'Текст', xPct: 0.1, yPct: 0.42, widthPct: 0.8, size: 56, color: '#FFFFFF', plate: true, align: 'left' }])
    setSelected(id)
  }
  const patch = (id: string, p: Partial<Block>) => setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...p } : b))
  const removeBlock = (id: string) => { setBlocks((prev) => prev.filter((b) => b.id !== id)); setSelected(null) }

  async function exportImg() {
    if (!photoUrl) { toast.error('Сначала загрузи фото'); return }
    if (blocks.length === 0) { toast.error('Добавь хотя бы один текст'); return }
    setExporting(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide: {
            kind: 'free', index: 0, total: 1, photoUrl,
            blocks: blocks.map((b) => ({ text: b.text, xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct, size: b.size, color: b.color, plate: b.plate, align: b.align })),
          },
          format: 'story', projectId,
        }),
      })
      if (!res.ok) throw new Error('Не удалось собрать картинку — попробуй ещё раз')
      const blob = await res.blob()
      setResultUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ошибка') }
    finally { setExporting(false) }
  }

  const scale = canvasW / 1080
  const sel = blocks.find((b) => b.id === selected) || null

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Type className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Редактор сторис (двигай текст)</p>
          <p className="text-xs text-muted-foreground">Загрузи фото, добавь текст и таскай его пальцем. Слово в **звёздочках** = акцент.</p>
        </div>
      </div>

      {/* Photo + add-text controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
          {uploadingPhoto ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><Upload className="h-3.5 w-3.5" /> {photoUrl ? 'Сменить фото' : 'Загрузить фото'}</>}
          <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto} onChange={(e) => uploadPhoto(e.target.files)} />
        </label>
        <button type="button" onClick={addBlock} disabled={!photoUrl}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Добавить текст
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
        className="relative mx-auto mt-3 w-full max-w-[360px] overflow-hidden rounded-xl bg-neutral-800"
        style={{ aspectRatio: '9 / 16', touchAction: 'none' }}
      >
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        )}
        {!photoUrl && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-white/70">
            Загрузи фото — потом добавишь текст и расставишь его как захочешь
          </div>
        )}
        {blocks.map((b) => (
          <div
            key={b.id}
            onPointerDown={(e) => startDrag(e, b.id)}
            style={{
              position: 'absolute', left: `${b.xPct * 100}%`, top: `${b.yPct * 100}%`, width: `${b.widthPct * 100}%`,
              fontSize: Math.max(8, b.size * scale), fontFamily: 'Montserrat, system-ui, sans-serif', lineHeight: 1.18,
              textAlign: b.align, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              cursor: 'move', userSelect: 'none', touchAction: 'none',
              outline: selected === b.id ? `2px solid ${ACCENT}` : 'none', outlineOffset: 3,
            }}
          >
            <PreviewText text={b.text} plate={b.plate} color={b.color} />
          </div>
        ))}
      </div>

      {/* Selected-block controls */}
      {sel && (
        <div className="mt-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <textarea value={sel.text} onChange={(e) => patch(sel.id, { text: e.target.value })} rows={2}
            placeholder="Текст блока (слово в **звёздочках** = акцент)"
            className="w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* size */}
            <div className="inline-flex items-center gap-1">
              <button type="button" onClick={() => patch(sel.id, { size: clamp(sel.size - 8, 24, 140) })} className="h-7 w-7 rounded-md border border-border font-bold">−</button>
              <span className="w-8 text-center text-muted-foreground">{sel.size}</span>
              <button type="button" onClick={() => patch(sel.id, { size: clamp(sel.size + 8, 24, 140) })} className="h-7 w-7 rounded-md border border-border font-bold">+</button>
            </div>
            {/* colour */}
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => patch(sel.id, { color: c })} aria-label="цвет"
                className={`h-7 w-7 rounded-full border ${sel.color === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`} style={{ background: c }} />
            ))}
            {/* plate */}
            <button type="button" onClick={() => patch(sel.id, { plate: !sel.plate })}
              className={`rounded-lg px-2.5 py-1.5 font-medium ${sel.plate ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>
              {sel.plate ? 'на плашке' : 'без плашки'}
            </button>
            {/* align */}
            <button type="button" onClick={() => patch(sel.id, { align: sel.align === 'left' ? 'center' : 'left' })}
              className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground">
              {sel.align === 'left' ? 'слева' : 'по центру'}
            </button>
            <button type="button" onClick={() => removeBlock(sel.id)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2.5 py-1.5 font-medium text-rose-600">
              <Trash2 className="h-3.5 w-3.5" /> удалить
            </button>
          </div>
        </div>
      )}
      {!sel && blocks.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Нажми на текст, чтобы выбрать и настроить его.</p>}

      {/* Export */}
      <button type="button" onClick={exportImg} disabled={exporting || !photoUrl || blocks.length === 0}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {exporting ? 'Собираю картинку…' : 'Сохранить картинку'}
      </button>

      {resultUrl && (
        <div className="mt-3 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resultUrl} alt="Готовая сторис" className="mx-auto max-h-96 rounded-xl border border-border" />
          <a href={resultUrl} download="story.png" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
            <Download className="h-3.5 w-3.5" /> Скачать
          </a>
        </div>
      )}
    </section>
  )
}
