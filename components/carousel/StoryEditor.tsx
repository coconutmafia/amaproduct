'use client'

// «Редактор сторис как в Инстаграме» — drop a photo, add text blocks, then DRAG
// to move, PINCH to scale + rotate (two fingers), and tune size/colour/plate.
// Exports a 1080×1920 image through the slide engine (kind 'free') so fonts +
// plates match the rest of the app. Brand colours (accent/plate) come from the
// project; the preview uses Montserrat too, so what you see ≈ what you get.

import { useRef, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, Plus, Trash2, Download, Type, Copy, RotateCw } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'

let _idc = 0
const newId = () => `b${++_idc}`
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

interface Block {
  id: string; text: string
  xPct: number; yPct: number; widthPct: number
  size: number; color: string; plate: boolean; align: 'left' | 'center'; rotation: number
}
interface Brand { accentColor: string; bg: string; text: string; bgStyle?: string }

function PreviewText({ text, plate, color, brand }: { text: string; plate: boolean; color: string; brand: Brand }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  const nodes = parts.map((p, i) => {
    const em = p.startsWith('**') && p.endsWith('**')
    return <span key={i} style={{ color: em ? brand.accentColor : (plate ? brand.text : color), fontWeight: em ? 900 : 800 }}>{em ? p.slice(2, -2) : p}</span>
  })
  if (!plate) return <span>{nodes}</span>
  return (
    <span style={{
      background: brand.bg, padding: '0.14em 0.26em', borderRadius: '0.14em',
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
  const [brand, setBrand] = useState<Brand>({ accentColor: '#EC1E8C', bg: '#F5F0E8', text: '#1A1A1A' })

  const canvasRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef(blocks)
  useEffect(() => { blocksRef.current = blocks }, [blocks])

  // Brand colours (accent + plate) so the editor matches the project's style.
  useEffect(() => {
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      setBrand((b) => ({
        accentColor: d.accentColor || b.accentColor,
        bg: d.bg || b.bg,
        text: d.text || b.text,
        bgStyle: d.bgStyle || undefined,
      }))
    }).catch(() => {})
  }, [projectId])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.getBoundingClientRect().width || 360))
    ro.observe(el)
    setCanvasW(el.getBoundingClientRect().width || 360)
    return () => ro.disconnect()
  }, [])

  const patch = (id: string, p: Partial<Block>) => setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...p } : b))

  // ── Touch/mouse gesture: 1 finger = drag, 2 fingers = scale + rotate ──────────
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef<null | {
    id: string; mode: 'drag' | 'pinch'; w: number; h: number; x0: number; y0: number
    px?: number; py?: number; size0?: number; rot0?: number; dist0?: number; ang0?: number; mx0?: number; my0?: number
  }>(null)

  function initGesture(id: string) {
    const r = canvasRef.current?.getBoundingClientRect()
    const b = blocksRef.current.find((x) => x.id === id)
    if (!r || !b) return
    const ps = [...pointers.current.values()]
    if (ps.length >= 2) {
      const [p1, p2] = ps
      gesture.current = {
        id, mode: 'pinch', w: r.width, h: r.height, x0: b.xPct, y0: b.yPct,
        size0: b.size, rot0: b.rotation,
        dist0: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        ang0: Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI,
        mx0: (p1.x + p2.x) / 2, my0: (p1.y + p2.y) / 2,
      }
    } else if (ps.length === 1) {
      gesture.current = { id, mode: 'drag', w: r.width, h: r.height, x0: b.xPct, y0: b.yPct, px: ps[0].x, py: ps[0].y }
    }
  }
  function applyGesture() {
    const g = gesture.current
    if (!g) return
    const ps = [...pointers.current.values()]
    if (g.mode === 'drag' && ps.length === 1) {
      const dx = (ps[0].x - g.px!) / g.w, dy = (ps[0].y - g.py!) / g.h
      patch(g.id, { xPct: clamp(g.x0 + dx, 0, 0.99), yPct: clamp(g.y0 + dy, 0, 0.99) })
    } else if (g.mode === 'pinch' && ps.length >= 2) {
      const [p1, p2] = ps
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
      patch(g.id, {
        size: clamp(Math.round((g.size0 || 56) * (dist / (g.dist0 || dist))), 22, 240),
        rotation: Math.round((g.rot0 || 0) + (ang - (g.ang0 || ang))),
        xPct: clamp(g.x0 + (mx - (g.mx0 || mx)) / g.w, 0, 0.99),
        yPct: clamp(g.y0 + (my - (g.my0 || my)) / g.h, 0, 0.99),
      })
    }
  }
  function onBlockDown(e: React.PointerEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    setSelected(id)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    canvasRef.current?.setPointerCapture(e.pointerId)
    initGesture(id)
  }
  function onCanvasMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    applyGesture()
  }
  function onCanvasUp(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    canvasRef.current?.releasePointerCapture?.(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    else if (gesture.current) initGesture(gesture.current.id) // re-baseline for the finger still down
  }

  async function uploadPhoto(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setUploadingPhoto(true)
    try {
      const small = await downscaleImage(f, 2000)
      const fd = new FormData()
      fd.append('projectId', projectId); fd.append('kind', 'story'); fd.append('files', small)
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
      if (!res.ok || !d.urls?.[0]) throw new Error(d.error || (res.status === 413 ? 'Фото слишком большое' : 'Не удалось загрузить фото'))
      setPhotoUrl(d.urls[0])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить фото') }
    finally { setUploadingPhoto(false) }
  }

  function addBlock() {
    const id = newId()
    setBlocks((p) => [...p, { id, text: 'Текст', xPct: 0.1, yPct: 0.42, widthPct: 0.8, size: 56, color: '#FFFFFF', plate: true, align: 'left', rotation: 0 }])
    setSelected(id)
  }
  function duplicate(id: string) {
    const b = blocks.find((x) => x.id === id); if (!b) return
    const nid = newId()
    setBlocks((p) => [...p, { ...b, id: nid, xPct: clamp(b.xPct + 0.04, 0, 0.95), yPct: clamp(b.yPct + 0.04, 0, 0.95) }])
    setSelected(nid)
  }
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
            blocks: blocks.map((b) => ({ text: b.text, xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct, size: b.size, color: b.color, plate: b.plate, align: b.align, rotation: b.rotation })),
          },
          format: 'story', projectId, brand: { accentColor: brand.accentColor, bg: brand.bg, text: brand.text, bgStyle: brand.bgStyle },
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
  const swatches = ['#FFFFFF', brand.text, brand.accentColor]
  const fontStack = "'MontserratEd', system-ui, sans-serif"

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <style>{`
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-ExtraBold.ttf') format('truetype');font-weight:800;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Black.ttf') format('truetype');font-weight:900;font-display:swap}
      `}</style>

      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Type className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Редактор сторис (двигай текст)</p>
          <p className="text-xs text-muted-foreground">Перетаскивай текст пальцем, двумя пальцами — масштаб и поворот. Слово в **звёздочках** = акцент.</p>
        </div>
      </div>

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
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
        className="relative mx-auto mt-3 w-full max-w-[360px] select-none overflow-hidden rounded-xl bg-neutral-800"
        style={{ aspectRatio: '9 / 16', touchAction: 'none' }}
      >
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photoUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" draggable={false} />
          : <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-white/70">Загрузи фото — потом добавишь текст и расставишь его как захочешь</div>}
        {blocks.map((b) => (
          <div
            key={b.id}
            onPointerDown={(e) => onBlockDown(e, b.id)}
            style={{
              position: 'absolute', left: `${b.xPct * 100}%`, top: `${b.yPct * 100}%`, width: `${b.widthPct * 100}%`,
              fontSize: Math.max(8, b.size * scale), fontFamily: fontStack, lineHeight: 1.18,
              textAlign: b.align, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined, transformOrigin: 'center',
              cursor: 'move', touchAction: 'none',
              outline: selected === b.id ? `2px solid ${brand.accentColor}` : 'none', outlineOffset: 3,
            }}
          >
            <PreviewText text={b.text} plate={b.plate} color={b.color} brand={brand} />
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
            <div className="inline-flex items-center gap-1">
              <button type="button" onClick={() => patch(sel.id, { size: clamp(sel.size - 8, 22, 240) })} className="h-7 w-7 rounded-md border border-border font-bold">−</button>
              <span className="w-7 text-center text-muted-foreground">{sel.size}</span>
              <button type="button" onClick={() => patch(sel.id, { size: clamp(sel.size + 8, 22, 240) })} className="h-7 w-7 rounded-md border border-border font-bold">+</button>
            </div>
            <button type="button" onClick={() => patch(sel.id, { rotation: (sel.rotation - 10) })} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground"><RotateCw className="h-3 w-3 -scale-x-100" /> −10°</button>
            <button type="button" onClick={() => patch(sel.id, { rotation: (sel.rotation + 10) })} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground"><RotateCw className="h-3 w-3" /> +10°</button>
            {sel.rotation !== 0 && <button type="button" onClick={() => patch(sel.id, { rotation: 0 })} className="text-[11px] text-muted-foreground underline">сброс ↻</button>}
            {swatches.map((c, i) => (
              <button key={i} type="button" onClick={() => patch(sel.id, { color: c })} aria-label="цвет"
                className={`h-7 w-7 rounded-full border ${sel.color === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`} style={{ background: c }} />
            ))}
            <button type="button" onClick={() => patch(sel.id, { plate: !sel.plate })}
              className={`rounded-lg px-2.5 py-1.5 font-medium ${sel.plate ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>
              {sel.plate ? 'на плашке' : 'без плашки'}
            </button>
            <button type="button" onClick={() => patch(sel.id, { align: sel.align === 'left' ? 'center' : 'left' })}
              className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground">
              {sel.align === 'left' ? 'слева' : 'по центру'}
            </button>
            <button type="button" onClick={() => duplicate(sel.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground"><Copy className="h-3.5 w-3.5" /> копия</button>
            <button type="button" onClick={() => removeBlock(sel.id)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2.5 py-1.5 font-medium text-rose-600"><Trash2 className="h-3.5 w-3.5" /> удалить</button>
          </div>
        </div>
      )}
      {!sel && blocks.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Нажми на текст, чтобы выбрать и настроить. Двумя пальцами — размер и поворот.</p>}

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
