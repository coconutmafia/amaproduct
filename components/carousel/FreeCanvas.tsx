'use client'

// FreeCanvas — the shared «designer» editing surface (Canva-style) used by both
// the single-slide story editor and the multi-slide carousel designer.
//
// It renders ONE slide: a background (photo / 2 photos / paper / dark / light)
// plus draggable elements — TEXT, ARROWS, NUMBERED BADGES, EMOJI ICONS, uploaded
// STICKERS and AI-generated images. Every element drags (1 finger), pinches to
// scale + rotate (2 fingers). The slide DATA is controlled (value / onChange) so
// a parent can hold one slide (story) or an array of them (carousel); only
// UI-local state (selection, panels, upload flags) lives inside.

import { useRef, useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Upload, Loader2, Plus, Trash2, Copy, RotateCw,
  ArrowUpRight, Spline, Hash, Smile, Image as ImageIcon, Sparkles,
} from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { ArrowSvg, Badge, SHAPE_ASPECT, type FreeShape } from '@/lib/carousel/shapes'

let _idc = 0
const newId = () => `b${++_idc}`
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export type BType = 'text' | 'image' | 'shape'
export type BgMode = 'photo' | 'split' | 'paper' | 'dark' | 'light'

export interface Block {
  id: string
  type: BType
  text: string                 // text content / number for a 'badge'
  src?: string                 // image source (type 'image')
  shape?: FreeShape            // shape kind (type 'shape')
  aspect?: number              // w/h for image & shape
  xPct: number; yPct: number; widthPct: number
  size: number; color: string; plate: boolean; align: 'left' | 'center'; rotation: number
}
export interface Brand { accentColor: string; bg: string; text: string; bgStyle?: string }

// One slide's data — the controlled value of FreeCanvas.
export interface SlideValue {
  bgMode: BgMode
  photoUrl: string | null
  photoTop: string | null
  photoBottom: string | null
  blocks: Block[]
}
export const blankSlide = (): SlideValue => ({ bgMode: 'photo', photoUrl: null, photoTop: null, photoBottom: null, blocks: [] })

const ICONS = ['⚠️', '✅', '❌', '💡', '🔥', '⭐', '👉', '💰', '📌', '❤️', '🎯', '✨', '🙌', '🤔', '📈', '🎁']

// ── Export helpers (shared by story + carousel exporters) ───────────────────────
export function slideHasBg(v: SlideValue): boolean {
  return v.bgMode === 'photo' ? !!v.photoUrl : v.bgMode === 'split' ? !!(v.photoTop && v.photoBottom) : true
}
export function exportBrandFor(v: SlideValue, brand: Brand) {
  // Non-photo backgrounds render via the engine's Backdrop using these hints.
  return v.bgMode === 'paper' ? { accentColor: brand.accentColor, text: brand.text, bgStyle: 'paper' }
    : v.bgMode === 'dark' ? { accentColor: brand.accentColor, bg: '#121214', text: '#FFFFFF', bgStyle: 'solid' }
    : v.bgMode === 'light' ? { accentColor: brand.accentColor, bg: brand.bg, text: brand.text, bgStyle: 'solid' }
    : { accentColor: brand.accentColor, bg: brand.bg, text: brand.text, bgStyle: brand.bgStyle }
}
export function buildFreeSlide(v: SlideValue, index = 0, total = 1) {
  return {
    kind: 'free' as const, index, total,
    ...(v.bgMode === 'photo' ? { photoUrl: v.photoUrl } : {}),
    ...(v.bgMode === 'split' ? { split: { top: v.photoTop, bottom: v.photoBottom } } : {}),
    blocks: v.blocks.map((b) => ({
      type: b.type, text: b.text, src: b.src, shape: b.shape, aspect: b.aspect,
      xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct, size: b.size,
      color: b.color, plate: b.plate, align: b.align, rotation: b.rotation,
    })),
  }
}

// Read an image's aspect ratio (w/h) without uploading it.
async function imageAspect(file: File): Promise<number> {
  try {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image(); el.onload = () => res(el); el.onerror = () => rej(new Error('x')); el.src = url
      })
      return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1
    } finally { URL.revokeObjectURL(url) }
  } catch { return 1 }
}

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

export function FreeCanvas({ projectId, brand, value, onChange, format = 'story' }: {
  projectId: string
  brand: Brand
  value: SlideValue
  onChange: (v: SlideValue) => void
  format?: 'story' | 'carousel'
}) {
  const { bgMode, photoUrl, photoTop, photoBottom, blocks } = value

  // Latest value in a ref so rapid gesture patches never read a stale snapshot.
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value })
  const update = (p: Partial<SlideValue>) => onChange({ ...valueRef.current, ...p })
  const setBlocks = (fn: (prev: Block[]) => Block[]) => update({ blocks: fn(valueRef.current.blocks) })
  const setBgMode = (m: BgMode) => update({ bgMode: m })
  const patch = (id: string, p: Partial<Block>) => setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...p } : b))

  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingSticker, setUploadingSticker] = useState(false)
  const [uploadingHalf, setUploadingHalf] = useState<'top' | 'bottom' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showIcons, setShowIcons] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiMode, setAiMode] = useState<'sticker' | 'background'>('sticker')
  const [aiBusy, setAiBusy] = useState(false)
  const [canvasW, setCanvasW] = useState(360)

  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.getBoundingClientRect().width || 360))
    ro.observe(el)
    setCanvasW(el.getBoundingClientRect().width || 360)
    return () => ro.disconnect()
  }, [])

  // ── Touch/mouse gesture: 1 finger = drag, 2 fingers = scale + rotate ──────────
  // Text scales its font `size`; shapes / images scale their `widthPct`.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef<null | {
    id: string; type: BType; mode: 'drag' | 'pinch'; w: number; h: number; x0: number; y0: number
    px?: number; py?: number; size0?: number; wpct0?: number; rot0?: number; dist0?: number; ang0?: number; mx0?: number; my0?: number
  }>(null)

  function initGesture(id: string) {
    const r = canvasRef.current?.getBoundingClientRect()
    const b = valueRef.current.blocks.find((x) => x.id === id)
    if (!r || !b) return
    const ps = [...pointers.current.values()]
    if (ps.length >= 2) {
      const [p1, p2] = ps
      gesture.current = {
        id, type: b.type, mode: 'pinch', w: r.width, h: r.height, x0: b.xPct, y0: b.yPct,
        size0: b.size, wpct0: b.widthPct, rot0: b.rotation,
        dist0: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        ang0: Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI,
        mx0: (p1.x + p2.x) / 2, my0: (p1.y + p2.y) / 2,
      }
    } else if (ps.length === 1) {
      gesture.current = { id, type: b.type, mode: 'drag', w: r.width, h: r.height, x0: b.xPct, y0: b.yPct, px: ps[0].x, py: ps[0].y }
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
      const factor = dist / (g.dist0 || dist)
      const next: Partial<Block> = {
        rotation: Math.round((g.rot0 || 0) + (ang - (g.ang0 || ang))),
        xPct: clamp(g.x0 + (mx - (g.mx0 || mx)) / g.w, 0, 0.99),
        yPct: clamp(g.y0 + (my - (g.my0 || my)) / g.h, 0, 0.99),
      }
      if (g.type === 'text') next.size = clamp(Math.round((g.size0 || 56) * factor), 22, 240)
      else next.widthPct = clamp(+((g.wpct0 || 0.4) * factor).toFixed(3), 0.05, 1)
      patch(g.id, next)
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

  async function uploadOne(f: File): Promise<string> {
    const small = await downscaleImage(f, 2000)
    const fd = new FormData()
    fd.append('projectId', projectId); fd.append('kind', 'story'); fd.append('files', small)
    const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
    const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
    if (!res.ok || !d.urls?.[0]) throw new Error(d.error || (res.status === 413 ? 'Фото слишком большое' : 'Не удалось загрузить фото'))
    return d.urls[0]
  }

  async function uploadPhoto(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setUploadingPhoto(true)
    try { update({ photoUrl: await uploadOne(f) }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить фото') }
    finally { setUploadingPhoto(false) }
  }

  // «2 фото на слайд»: upload the top or bottom half separately.
  async function uploadHalf(files: FileList | null, which: 'top' | 'bottom') {
    const f = files?.[0]
    if (!f) return
    setUploadingHalf(which)
    try {
      const url = await uploadOne(f)
      update(which === 'top' ? { photoTop: url } : { photoBottom: url })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить фото') }
    finally { setUploadingHalf(null) }
  }

  async function uploadSticker(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setUploadingSticker(true)
    try {
      const isPng = /png/i.test(f.type)
      const small = await downscaleImage(f, 1400, 0.92, isPng ? 'image/png' : 'image/jpeg')
      const aspect = await imageAspect(small)
      const fd = new FormData()
      fd.append('projectId', projectId); fd.append('kind', 'story'); fd.append('files', small)
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
      if (!res.ok || !d.urls?.[0]) throw new Error(d.error || (res.status === 413 ? 'Картинка слишком большая' : 'Не удалось загрузить картинку'))
      const id = newId()
      setBlocks((p) => [...p, {
        id, type: 'image', text: '', src: d.urls![0], aspect,
        xPct: 0.3, yPct: 0.38, widthPct: 0.42, size: 56, color: '#FFFFFF', plate: false, align: 'center', rotation: 0,
      }])
      setSelected(id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить картинку') }
    finally { setUploadingSticker(false) }
  }

  // AI image (step a): a flat-illustration sticker (transparent → image block)
  // or a full background (→ becomes the photo background).
  async function generateAi() {
    if (!aiPrompt.trim()) { toast.error('Опиши, что нарисовать'); return }
    setAiBusy(true)
    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: aiPrompt, mode: aiMode }),
      })
      const d = await res.json().catch(() => ({} as { url?: string; aspect?: number; error?: string }))
      if (!res.ok || !d.url) throw new Error(d.error || 'Не удалось сгенерировать картинку')
      if (aiMode === 'background') {
        update({ bgMode: 'photo', photoUrl: d.url })
        toast.success('Фон готов — добавляй текст и элементы')
      } else {
        const id = newId()
        setBlocks((p) => [...p, {
          id, type: 'image', text: '', src: d.url!, aspect: d.aspect || 1,
          xPct: 0.3, yPct: 0.34, widthPct: 0.46, size: 56, color: '#FFFFFF', plate: false, align: 'center', rotation: 0,
        }])
        setSelected(id)
        toast.success('Картинка добавлена — двигай и масштабируй')
      }
      setShowAi(false); setAiPrompt('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ошибка') }
    finally { setAiBusy(false) }
  }

  function addText() {
    const id = newId()
    setBlocks((p) => [...p, { id, type: 'text', text: 'Текст', xPct: 0.1, yPct: 0.42, widthPct: 0.8, size: 56, color: '#FFFFFF', plate: true, align: 'left', rotation: 0 }])
    setSelected(id)
  }
  function addIcon(emoji: string) {
    const id = newId()
    setBlocks((p) => [...p, { id, type: 'text', text: emoji, xPct: 0.4, yPct: 0.4, widthPct: 0.3, size: 120, color: '#FFFFFF', plate: false, align: 'center', rotation: 0 }])
    setSelected(id)
  }
  function addArrow(shape: 'arrow' | 'arrow-curve') {
    const id = newId()
    setBlocks((p) => [...p, { id, type: 'shape', shape, aspect: SHAPE_ASPECT[shape], text: '', xPct: 0.28, yPct: 0.46, widthPct: 0.45, size: 56, color: brand.accentColor, plate: false, align: 'center', rotation: 0 }])
    setSelected(id)
  }
  function addBadge() {
    const id = newId()
    const n = valueRef.current.blocks.filter((b) => b.shape === 'badge').length + 1
    setBlocks((p) => [...p, { id, type: 'shape', shape: 'badge', aspect: 1, text: String(n), xPct: 0.12, yPct: 0.3, widthPct: 0.16, size: 56, color: brand.accentColor, plate: false, align: 'center', rotation: 0 }])
    setSelected(id)
  }
  function duplicate(id: string) {
    const b = valueRef.current.blocks.find((x) => x.id === id); if (!b) return
    const nid = newId()
    setBlocks((p) => [...p, { ...b, id: nid, xPct: clamp(b.xPct + 0.04, 0, 0.95), yPct: clamp(b.yPct + 0.04, 0, 0.95) }])
    setSelected(nid)
  }
  const removeBlock = (id: string) => { setBlocks((prev) => prev.filter((b) => b.id !== id)); setSelected(null) }

  // Size ±: font size for text, element width for shapes / images.
  function resizeSel(s: Block, dir: 1 | -1) {
    if (s.type === 'text') patch(s.id, { size: clamp(s.size + dir * 8, 22, 240) })
    else patch(s.id, { widthPct: clamp(+(s.widthPct + dir * 0.05).toFixed(3), 0.05, 1) })
  }

  const scale = canvasW / 1080
  const hasBg = slideHasBg(value)
  const sel = blocks.find((b) => b.id === selected) || null
  const swatches = ['#FFFFFF', brand.text, brand.accentColor]
  const fontStack = "'MontserratEd', system-ui, sans-serif"
  const isBadge = sel?.shape === 'badge'
  const isArrow = sel?.type === 'shape' && !isBadge
  const isImage = sel?.type === 'image'
  const addBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40 disabled:opacity-40'

  return (
    <>
      <style>{`
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-ExtraBold.ttf') format('truetype');font-weight:800;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Black.ttf') format('truetype');font-weight:900;font-display:swap}
      `}</style>

      {/* Background: a photo / 2 photos / a designed backdrop */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Фон:</span>
        {([['photo', 'Фото'], ['split', '2 фото'], ['paper', 'Бумага'], ['dark', 'Тёмный'], ['light', 'Светлый']] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setBgMode(m)}
            className={`rounded-lg px-2.5 py-1.5 font-medium ${bgMode === m ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {bgMode === 'photo' && (
        <div className="mt-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
            {uploadingPhoto ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><Upload className="h-3.5 w-3.5" /> {photoUrl ? 'Сменить фото' : 'Загрузить фото'}</>}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto} onChange={(e) => uploadPhoto(e.target.files)} />
          </label>
        </div>
      )}
      {bgMode === 'split' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
            {uploadingHalf === 'top' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><Upload className="h-3.5 w-3.5" /> {photoTop ? 'Сменить верх' : 'Фото сверху'}</>}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingHalf !== null} onChange={(e) => uploadHalf(e.target.files, 'top')} />
          </label>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
            {uploadingHalf === 'bottom' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><Upload className="h-3.5 w-3.5" /> {photoBottom ? 'Сменить низ' : 'Фото снизу'}</>}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingHalf !== null} onChange={(e) => uploadHalf(e.target.files, 'bottom')} />
          </label>
          <span className="text-[11px] text-muted-foreground">два фото (верх/низ) — текст добавляй сверху</span>
        </div>
      )}

      {/* Element library */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Добавить:</span>
        <button type="button" onClick={addText} disabled={!hasBg} className={addBtn}><Plus className="h-3.5 w-3.5" /> Текст</button>
        <button type="button" onClick={() => addArrow('arrow')} disabled={!hasBg} className={addBtn}><ArrowUpRight className="h-3.5 w-3.5" /> Стрелка</button>
        <button type="button" onClick={() => addArrow('arrow-curve')} disabled={!hasBg} className={addBtn}><Spline className="h-3.5 w-3.5" /> Дуга</button>
        <button type="button" onClick={addBadge} disabled={!hasBg} className={addBtn}><Hash className="h-3.5 w-3.5" /> Номер</button>
        <button type="button" onClick={() => { setShowIcons((v) => !v); setShowAi(false) }} disabled={!hasBg} className={`${addBtn} ${showIcons ? 'border-primary/50 text-foreground' : ''}`}><Smile className="h-3.5 w-3.5" /> Иконка</button>
        <label className={`${addBtn} cursor-pointer ${!hasBg ? 'pointer-events-none opacity-40' : ''}`}>
          {uploadingSticker ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><ImageIcon className="h-3.5 w-3.5" /> Картинка</>}
          <input type="file" accept="image/*" className="hidden" disabled={!hasBg || uploadingSticker} onChange={(e) => uploadSticker(e.target.files)} />
        </label>
        <button type="button" onClick={() => { setShowAi((v) => !v); setShowIcons(false) }} className={`${addBtn} ${showAi ? 'border-primary/50 text-foreground' : ''}`}><Sparkles className="h-3.5 w-3.5" /> AI-картинка</button>
      </div>
      {showAi && (
        <div className="mt-2 space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Нарисовать:</span>
            {([['sticker', 'Стикер (без фона)'], ['background', 'Фон']] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setAiMode(m)}
                className={`rounded-lg px-2.5 py-1 font-medium ${aiMode === m ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>{label}</button>
            ))}
          </div>
          <VoiceTextarea value={aiPrompt} onChange={setAiPrompt} rows={2}
            placeholder={aiMode === 'sticker' ? 'напр.: розовая копилка-свинка, флэт-иллюстрация' : 'напр.: мягкий бежевый фон с лёгкими бликами'} />
          <div className="flex items-center gap-2">
            <button type="button" onClick={generateAi} disabled={aiBusy || !aiPrompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiBusy ? 'Рисую… (до ~30 сек)' : 'Сгенерировать'}
            </button>
            <span className="text-[11px] text-muted-foreground">без текста на картинке — текст добавишь сверху сам</span>
          </div>
        </div>
      )}
      {showIcons && hasBg && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-primary/20 bg-primary/5 p-2">
          {ICONS.map((emo) => (
            <button key={emo} type="button" onClick={() => addIcon(emo)} className="h-9 w-9 rounded-lg text-xl hover:bg-primary/10" aria-label="иконка">{emo}</button>
          ))}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
        className="relative mx-auto mt-3 w-full max-w-[360px] select-none overflow-hidden rounded-xl bg-neutral-800"
        style={{ aspectRatio: format === 'carousel' ? '4 / 5' : '9 / 16', touchAction: 'none' }}
      >
        {bgMode === 'photo' && photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" draggable={false} />
        )}
        {bgMode === 'photo' && !photoUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-white/70">Загрузи фото — потом добавляй текст, стрелки, иконки и расставляй как захочешь</div>
        )}
        {bgMode === 'split' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col">
            <div className="h-1/2 w-full overflow-hidden bg-neutral-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photoTop ? <img src={photoTop} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="flex h-full items-center justify-center text-[11px] text-white/60">Фото сверху</div>}
            </div>
            <div className="h-1/2 w-full overflow-hidden bg-neutral-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photoBottom ? <img src={photoBottom} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="flex h-full items-center justify-center text-[11px] text-white/60">Фото снизу</div>}
            </div>
          </div>
        )}
        {bgMode !== 'photo' && bgMode !== 'split' && (
          <div className="pointer-events-none absolute inset-0"
            style={bgMode === 'paper' ? { backgroundImage: "url('/textures/paper.png')", backgroundSize: 'cover', backgroundPosition: 'center' } : { background: bgMode === 'dark' ? '#121214' : brand.bg }} />
        )}
        {blocks.map((b) => {
          const isTxt = b.type === 'text'
          const pxW = b.widthPct * canvasW
          return (
            <div
              key={b.id}
              onPointerDown={(e) => onBlockDown(e, b.id)}
              style={{
                position: 'absolute', left: `${b.xPct * 100}%`, top: `${b.yPct * 100}%`,
                ...(isTxt ? {
                  width: `${b.widthPct * 100}%`,
                  fontSize: Math.max(8, b.size * scale), fontFamily: fontStack, lineHeight: 1.18,
                  textAlign: b.align, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                } : { display: 'flex' }),
                transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined, transformOrigin: 'center',
                cursor: 'move', touchAction: 'none',
                outline: selected === b.id ? `2px solid ${brand.accentColor}` : 'none', outlineOffset: 3,
              }}
            >
              {b.type === 'image' && b.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.src} alt="" draggable={false} style={{ width: pxW, height: pxW / (b.aspect || 1), objectFit: 'contain', pointerEvents: 'none' }} />
              ) : b.type === 'shape' && b.shape === 'badge' ? (
                <Badge size={pxW} color={b.color} label={b.text || '1'} fontFamily="'MontserratEd'" />
              ) : b.type === 'shape' && b.shape ? (
                <ArrowSvg w={pxW} h={pxW / (b.aspect || SHAPE_ASPECT[b.shape])} color={b.color} curve={b.shape === 'arrow-curve'} />
              ) : (
                <PreviewText text={b.text} plate={b.plate} color={b.color} brand={brand} />
              )}
            </div>
          )
        })}
      </div>

      {/* Selected-block controls */}
      {sel && (
        <div className="mt-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
          {sel.type === 'text' && (
            <textarea value={sel.text} onChange={(e) => patch(sel.id, { text: e.target.value })} rows={2}
              placeholder="Текст блока (слово в **звёздочках** = акцент)"
              className="w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm" />
          )}
          {isBadge && (
            <input value={sel.text} onChange={(e) => patch(sel.id, { text: e.target.value.slice(0, 3) })} maxLength={3}
              placeholder="№" className="w-20 rounded-lg border border-border bg-background p-2 text-center text-sm font-bold" />
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1">
              <button type="button" onClick={() => resizeSel(sel, -1)} className="h-7 w-7 rounded-md border border-border font-bold">−</button>
              <span className="w-10 text-center text-muted-foreground">{sel.type === 'text' ? sel.size : `${Math.round(sel.widthPct * 100)}%`}</span>
              <button type="button" onClick={() => resizeSel(sel, 1)} className="h-7 w-7 rounded-md border border-border font-bold">+</button>
            </div>
            <button type="button" onClick={() => patch(sel.id, { rotation: sel.rotation - 10 })} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground"><RotateCw className="h-3 w-3 -scale-x-100" /> −10°</button>
            <button type="button" onClick={() => patch(sel.id, { rotation: sel.rotation + 10 })} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground"><RotateCw className="h-3 w-3" /> +10°</button>
            {sel.rotation !== 0 && <button type="button" onClick={() => patch(sel.id, { rotation: 0 })} className="text-[11px] text-muted-foreground underline">сброс ↻</button>}

            {/* Colour: text colour / shape stroke or fill (not for images) */}
            {!isImage && swatches.map((c, i) => (
              <button key={i} type="button" onClick={() => patch(sel.id, { color: c })} aria-label="цвет"
                className={`h-7 w-7 rounded-full border ${sel.color === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`} style={{ background: c }} />
            ))}

            {sel.type === 'text' && (
              <>
                <button type="button" onClick={() => patch(sel.id, { plate: !sel.plate })}
                  className={`rounded-lg px-2.5 py-1.5 font-medium ${sel.plate ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>
                  {sel.plate ? 'на плашке' : 'без плашки'}
                </button>
                <button type="button" onClick={() => patch(sel.id, { align: sel.align === 'left' ? 'center' : 'left' })}
                  className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground">
                  {sel.align === 'left' ? 'слева' : 'по центру'}
                </button>
              </>
            )}
            <button type="button" onClick={() => duplicate(sel.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground"><Copy className="h-3.5 w-3.5" /> копия</button>
            <button type="button" onClick={() => removeBlock(sel.id)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2.5 py-1.5 font-medium text-rose-600"><Trash2 className="h-3.5 w-3.5" /> удалить</button>
          </div>
          {isArrow && <p className="text-[11px] text-muted-foreground">Поверни элемент (двумя пальцами или ±10°), чтобы направить стрелку.</p>}
        </div>
      )}
      {!sel && blocks.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Нажми на элемент, чтобы выбрать и настроить. Двумя пальцами — размер и поворот.</p>}
    </>
  )
}
