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
//
// WYSIWYG (06.09, Марина: «сохраняю — слайд меняется»): строки текста считает
// ОДИН алгоритм (lib/carousel/textLayout) по реальным ширинам глифов того же
// TTF, что рендерит сервер; готовые строки уезжают в экспорт, сервер их не
// переносит заново. Геометрия плашек/межстрочных — общая (textMetrics).

import { useRef, useState, useEffect, useMemo, type ReactElement } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import {
  Upload, Loader2, Plus, Trash2, Copy, RotateCw, Crop as CropIcon,
  ArrowUpRight, Spline, Hash, Smile, Image as ImageIcon, Sparkles, AlignCenterHorizontal,
} from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { ArrowSvg, Badge, SHAPE_ASPECT, type FreeShape } from '@/lib/carousel/shapes'
import { resolveBrandAccent, resolveBrandText } from '@/lib/carousel/contrast'
import { FONT_HAS_ITALIC, FONT_KEYS, FONTS, type FontKey } from '@/lib/fonts'
import { UNIT_HINTS } from '@/components/billing/UnitCostHint'
import { layoutText, textMetrics, wrapWidthFor, type LayoutLine } from '@/lib/carousel/textLayout'
import { cropGeometry, frameRadius, type Crop } from '@/lib/carousel/imageGeometry'
import { editorFamilyOf, ensureFonts, makeMeasure } from '@/lib/carousel/measureClient'
import { plateTextColor, plateBackground } from '@/lib/carousel/plateStyle'

let _idc = 0
const newId = () => `b${++_idc}`
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export type BType = 'text' | 'image' | 'shape'
export type BgMode = 'photo' | 'split' | 'paper' | 'dark' | 'light'
export type Align = 'left' | 'center' | 'right'

export interface Block {
  id: string
  type: BType
  text: string                 // text content / number for a 'badge'
  src?: string                 // image source (type 'image')
  shape?: FreeShape            // shape kind (type 'shape')
  aspect?: number              // w/h of the FRAME for image & shape (= source ratio until cropped)
  xPct: number; yPct: number; widthPct: number
  size: number; color: string; plate: boolean; align: Align; rotation: number
  // 09.09 (Светлана): на плашке цвет текста брался из темы, и палитра «не
  // работала». colorSet — человек выбрал цвет явно (тогда он применяется и на
  // плашке), plateColor — цвет самой плашки (без него — фон стиля, как было).
  colorSet?: boolean
  plateColor?: string
  // Начертание (Марина 24.08: «весь текст жирный, нельзя убрать, нет курсива»).
  // По умолчанию — жирный без курсива, как раньше.
  weight?: 'normal' | 'bold'
  italic?: boolean
  // 06.09 (Марина): заглавные, шрифт блока; у картинок — скругление (доля
  // меньшей стороны, 0.5 = круг), прозрачность, кадрирование (зум + сдвиг в
  // рамке aspect; srcAspect — пропорции исходника).
  uppercase?: boolean
  font?: FontKey
  radius?: number
  opacity?: number
  crop?: Crop
  srcAspect?: number
}
export interface Brand { accentColor: string; bg: string; text: string; bgStyle?: string; font?: string; accentStyle?: 'gradient' | 'flat'; swipeHint?: boolean; swipeLabel?: string }

// One slide's data — the controlled value of FreeCanvas.
export interface SlideValue {
  bgMode: BgMode
  photoUrl: string | null
  photoTop: string | null
  photoBottom: string | null
  blocks: Block[]
  // Свой цвет фона для «Бумага/Тёмный/Светлый» (Марина 06.09) — null = как в бренде.
  bgColor?: string | null
}
export const blankSlide = (): SlideValue => ({ bgMode: 'photo', photoUrl: null, photoTop: null, photoBottom: null, blocks: [], bgColor: null })

const ICONS = ['⚠️', '✅', '❌', '💡', '🔥', '⭐', '👉', '💰', '📌', '❤️', '🎯', '✨', '🙌', '🤔', '📈', '🎁']
// Палитра сверх цветов бренда (Марина: «только чёрный, белый и акцентный»).
export const PALETTE = ['#FFFFFF', '#1A1A1A', '#F5F0E8', '#EC1E8C', '#FF6B35', '#FFC107', '#2ECC71', '#00BCD4', '#3B82F6', '#8B5CF6', '#E11D48', '#9E9E9E']
const DARK_BG = '#121214'
const CANVAS_W = 1080

// ── Effective colours per background mode — ONE place for preview + export ────
export function effectiveTheme(v: SlideValue, brand: Brand): { bg: string; text: string; accent: string } {
  const bg = v.bgMode === 'dark' ? (v.bgColor || DARK_BG)
    : v.bgMode === 'light' || v.bgMode === 'paper' ? (v.bgColor || brand.bg)
    : brand.bg
  const preferredText = v.bgMode === 'dark' && !v.bgColor ? '#FFFFFF' : brand.text
  // Те же поправки читаемости, что themeFromBrand на сервере (превью = экспорт).
  return { bg, text: resolveBrandText(bg, preferredText), accent: resolveBrandAccent(bg, brand.accentColor) }
}

// ── Export helpers (shared by story + carousel exporters) ───────────────────────
export function slideHasBg(v: SlideValue): boolean {
  return v.bgMode === 'photo' ? !!v.photoUrl : v.bgMode === 'split' ? !!(v.photoTop && v.photoBottom) : true
}
export function exportBrandFor(v: SlideValue, brand: Brand) {
  // Non-photo backgrounds render via the engine's Backdrop using these hints.
  // font + accentStyle travel with every bg mode so the chosen font / accent
  // fill apply to the free designer too. bg/text — ровно те, что видит превью.
  const base = { accentColor: brand.accentColor, font: brand.font, accentStyle: brand.accentStyle, swipeHint: brand.swipeHint, swipeLabel: brand.swipeLabel }
  const eff = effectiveTheme(v, brand)
  return v.bgMode === 'paper' ? { ...base, bg: eff.bg, text: brand.text, bgStyle: 'paper' }
    : v.bgMode === 'dark' ? { ...base, bg: eff.bg, text: v.bgColor ? brand.text : '#FFFFFF', bgStyle: 'solid' }
    : v.bgMode === 'light' ? { ...base, bg: eff.bg, text: brand.text, bgStyle: 'solid' }
    : { ...base, bg: brand.bg, text: brand.text, bgStyle: brand.bgStyle }
}

const weightsOf = (b: Block) => (b.weight === 'normal' ? { weight: 400, accentWeight: 700 } : { weight: 800, accentWeight: 900 })

/** Строки текстового блока по реальным ширинам (в px холста 1080). */
export function layoutBlock(b: Block, brand: Brand): LayoutLine[] {
  const { weight, accentWeight } = weightsOf(b)
  const measure = makeMeasure({ family: editorFamilyOf(b.font ?? brand.font), size: b.size, weight, accentWeight, italic: !!b.italic })
  return layoutText(b.text, { maxWidth: wrapWidthFor(b.widthPct * CANVAS_W, b.size, b.plate), measure, uppercase: b.uppercase })
}

/** Перед экспортом дождаться начертаний всех текстовых блоков — иначе canvas меряет запасным шрифтом. */
export async function prepareFontsFor(v: SlideValue, brand: Brand): Promise<void> {
  const fams = new Map<string, { weights: Set<number>; italic: boolean }>()
  for (const b of v.blocks) {
    if (b.type !== 'text') continue
    const fam = editorFamilyOf(b.font ?? brand.font)
    const { weight, accentWeight } = weightsOf(b)
    const e = fams.get(fam) ?? { weights: new Set<number>(), italic: false }
    e.weights.add(weight); e.weights.add(accentWeight); e.weights.add(800)
    if (b.italic || /\*[^*]+\*/.test(b.text)) e.italic = true
    fams.set(fam, e)
  }
  await Promise.all([...fams].map(([fam, e]) => ensureFonts(fam, [...e.weights], e.italic)))
}

export function buildFreeSlide(v: SlideValue, index = 0, total = 1, brand?: Brand) {
  return {
    kind: 'free' as const, index, total,
    ...(v.bgMode === 'photo' ? { photoUrl: v.photoUrl } : {}),
    ...(v.bgMode === 'split' ? { split: { top: v.photoTop, bottom: v.photoBottom } } : {}),
    blocks: v.blocks.map((b) => ({
      type: b.type, text: b.text, src: b.src, shape: b.shape, aspect: b.aspect,
      xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct, size: b.size,
      color: b.color, colorSet: b.colorSet, plateColor: b.plateColor, plate: b.plate, align: b.align, rotation: b.rotation,
      weight: b.weight, italic: b.italic,
      uppercase: b.uppercase, font: b.font, radius: b.radius, opacity: b.opacity, crop: b.crop, srcAspect: b.srcAspect,
      // Готовые строки — сервер рендерит их как есть (WYSIWYG).
      ...(b.type === 'text' && brand && typeof document !== 'undefined' ? { lines: layoutBlock(b, brand) } : {}),
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

// Превью строк: та же геометрия, что FreeLines в движке, в масштабе холста.
function PreviewLines({ lines, size, scale, plate, plateBg, platedColor, plainColor, accent, align, weight, accentWeight, italic, fontFamily }: {
  lines: LayoutLine[]; size: number; scale: number; plate: boolean; plateBg: string; platedColor: string; plainColor: string
  accent: string; align: Align; weight: number; accentWeight: number; italic: boolean; fontFamily: string
}): ReactElement {
  const m = textMetrics(size)
  const s = (px: number) => px * scale
  const alignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems, width: '100%', fontFamily }}>
      {lines.map((ln, li) => ln.blank ? (
        <div key={li} style={{ width: '100%', height: s(plate ? m.blankPlate : m.blankPlain) }} />
      ) : (
        <div key={li} style={{
          display: 'flex', flexWrap: 'nowrap', whiteSpace: 'pre', fontSize: s(size),
          lineHeight: plate ? m.plateLineHeight : m.plainLineHeight,
          ...(plate ? { background: plateBg, padding: `${s(m.padY)}px ${s(m.padX)}px`, borderRadius: s(m.radius) } : {}),
          marginBottom: li === lines.length - 1 ? 0 : plate ? 0 : s(m.plainGap),
        }}>
          {ln.runs.map((r, i) => (
            <span key={i} style={{
              whiteSpace: 'pre',
              color: r.em ? accent : plate ? platedColor : plainColor,
              fontWeight: r.em ? accentWeight : r.bold ? Math.max(weight, 800) : weight,
              fontStyle: italic || r.italic ? 'italic' : 'normal',
            }}>{r.text}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

const FONT_SHORT: Record<string, string> = { montserrat: 'Montserrat', 'pt-serif': 'PT Serif', 'pt-sans-narrow': 'PT Sans Narrow', yeseva: 'Yeseva One', marck: 'Marck Script' }

export function FreeCanvas({ projectId, brand, value, onChange, format = 'story', photos }: {
  projectId: string
  brand: Brand
  value: SlideValue
  onChange: (v: SlideValue) => void
  format?: 'story' | 'carousel'
  // Already-uploaded photos (e.g. the story series' photos) to pick as the
  // background without re-uploading. Optional — other usages pass nothing.
  photos?: string[]
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
  // Варианты последней генерации (Марина 24.08: «генерирует одну картинку и
  // она может не подходить») — грид на выбор, тап = применить.
  const [aiVariants, setAiVariants] = useState<{ url: string; aspect: number; mode: 'sticker' | 'background' }[]>([])
  const [canvasW, setCanvasW] = useState(360)
  // Направляющие при перетаскивании: центр холста по вертикали/горизонтали.
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  // Перерисовать превью, когда догрузился шрифт (до этого canvas мерил запасным).
  const [fontsTick, setFontsTick] = useState(0)
  const [cropOpen, setCropOpen] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const blockEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.getBoundingClientRect().width || 360))
    ro.observe(el)
    setCanvasW(el.getBoundingClientRect().width || 360)
    return () => ro.disconnect()
  }, [])

  // Шрифты блоков: грузим нужные начертания и перерисовываем по готовности.
  const fontSig = blocks.filter((b) => b.type === 'text').map((b) => `${b.font ?? brand.font ?? ''}|${b.weight ?? 'bold'}|${b.italic ? 1 : 0}`).join(',')
  useEffect(() => {
    let alive = true
    prepareFontsFor(valueRef.current, brand).then(() => { if (alive) setFontsTick((t) => t + 1) })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSig, brand.font])
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return
    const onDone = () => setFontsTick((t) => t + 1)
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
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
      let x = clamp(g.x0 + dx, 0, 0.99), y = clamp(g.y0 + dy, 0, 0.99)
      // Прилипание к центру холста (Марина: «линии для ориентира, когда текст по центру»).
      const el = blockEls.current.get(g.id)
      const bw = el?.offsetWidth ?? 0, bh = el?.offsetHeight ?? 0
      const thr = 6
      let v = false, h = false
      if (bw > 0 && Math.abs(x * g.w + bw / 2 - g.w / 2) < thr) { x = (g.w / 2 - bw / 2) / g.w; v = true }
      if (bh > 0 && Math.abs(y * g.h + bh / 2 - g.h / 2) < thr) { y = (g.h / 2 - bh / 2) / g.h; h = true }
      setGuides((prev) => (prev.v === v && prev.h === h ? prev : { v, h }))
      patch(g.id, { xPct: x, yPct: y })
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
    if (pointers.current.size === 0) { gesture.current = null; setGuides({ v: false, h: false }) }
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
    catch (e) { toast.error(friendlyError(e, 'Не удалось загрузить фото')) }
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
    } catch (e) { toast.error(friendlyError(e, 'Не удалось загрузить фото')) }
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
        id, type: 'image', text: '', src: d.urls![0], aspect, srcAspect: aspect,
        xPct: 0.3, yPct: 0.38, widthPct: 0.42, size: 56, color: '#FFFFFF', plate: false, align: 'center', rotation: 0,
      }])
      setSelected(id)
    } catch (e) { toast.error(friendlyError(e, 'Не удалось загрузить картинку')) }
    finally { setUploadingSticker(false) }
  }

  // AI image (step a): a flat-illustration sticker (transparent → image block)
  // or a full background (→ becomes the photo background).
  async function generateAi() {
    if (!aiPrompt.trim()) { toast.error('Опиши, что нарисовать'); return }
    setAiBusy(true)
    setAiVariants([])
    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: aiPrompt, mode: aiMode, count: 3 }),
      })
      const d = await res.json().catch(() => ({} as { url?: string; urls?: string[]; aspect?: number; error?: string }))
      if (!res.ok || !d.url) throw new Error(d.error || 'Не удалось сгенерировать картинку')
      const urls = (d.urls && d.urls.length > 0 ? d.urls : [d.url])
      if (urls.length === 1) {
        applyAiVariant({ url: urls[0], aspect: d.aspect || 1, mode: aiMode })
        return
      }
      setAiVariants(urls.map((u: string) => ({ url: u, aspect: d.aspect || 1, mode: aiMode })))
      toast.success('Выбери вариант — тапни по картинке')
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setAiBusy(false) }
  }

  function applyAiVariant(v: { url: string; aspect: number; mode: 'sticker' | 'background' }) {
    if (v.mode === 'background') {
      update({ bgMode: 'photo', photoUrl: v.url })
      toast.success('Фон готов — добавляй текст и элементы')
    } else {
      const id = newId()
      setBlocks((p) => [...p, {
        id, type: 'image', text: '', src: v.url, aspect: v.aspect || 1, srcAspect: v.aspect || 1,
        xPct: 0.3, yPct: 0.34, widthPct: 0.46, size: 56, color: '#FFFFFF', plate: false, align: 'center', rotation: 0,
      }])
      setSelected(id)
      toast.success('Картинка добавлена — двигай и масштабируй')
    }
    setAiVariants([]); setShowAi(false); setAiPrompt('')
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
  // Ширина ТЕКСТОВОГО блока = ширина плашки (Светлана 09.09: «изменить размер
  // плашки — либо неочевидно, либо невозможно»). Двумя пальцами это меняется
  // жестом, но с мышью жеста нет — на десктопе ширина не менялась ничем.
  function widthSel(s: Block, dir: 1 | -1) {
    patch(s.id, { widthPct: clamp(+(s.widthPct + dir * 0.05).toFixed(3), 0.15, 1) })
  }
  // Центрировать выбранный элемент по горизонтали (кнопкой, без перетаскивания).
  function centerSel(s: Block) {
    const el = blockEls.current.get(s.id)
    const bw = el?.offsetWidth ?? s.widthPct * canvasW
    patch(s.id, { xPct: clamp((canvasW - bw) / 2 / canvasW, 0, 0.99) })
  }
  // Жирным/курсивом ТОЛЬКО выделенные слова: маркеры __слово__ / *слово*
  // (Марина: «выделить одно или несколько слов, как акцентным цветом»).
  function wrapSelection(s: Block, marker: '__' | '*') {
    const ta = taRef.current
    if (!ta) return
    const a = ta.selectionStart ?? 0, e = ta.selectionEnd ?? 0
    if (a === e) { toast.message('Выдели в тексте слово или несколько слов, потом нажми кнопку'); return }
    const t = s.text
    const inner = t.slice(a, e)
    const before = t.slice(0, a), after = t.slice(e)
    const already = inner.startsWith(marker) && inner.endsWith(marker) && inner.length > marker.length * 2
    const next = already ? before + inner.slice(marker.length, -marker.length) + after : before + marker + inner.trim() + marker + after
    patch(s.id, { text: next })
    requestAnimationFrame(() => { try { ta.focus(); ta.setSelectionRange(a, a + (already ? inner.length - marker.length * 2 : inner.trim().length + marker.length * 2)) } catch { /* */ } })
  }

  const scale = canvasW / CANVAS_W
  const hasBg = slideHasBg(value)
  const sel = blocks.find((b) => b.id === selected) || null
  const eff = effectiveTheme(value, brand)
  const swatches = [...new Set(['#FFFFFF', brand.text, brand.accentColor, brand.bg, ...PALETTE])]
  // Плашка: фон стиля и акцент первыми — у Светланы в концепции плашки
  // зелёные/жёлтые, а акцент стиля как раз зелёный.
  const plateSwatches = [...new Set([brand.bg, brand.accentColor, brand.text, '#FFFFFF', ...PALETTE])]
  const isBadge = sel?.shape === 'badge'
  const isArrow = sel?.type === 'shape' && !isBadge
  const isImage = sel?.type === 'image'
  const isText = sel?.type === 'text'
  const addBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40 disabled:opacity-40'
  const chip = (on: boolean) => `h-7 min-w-7 rounded-md border px-1.5 text-xs font-semibold ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`

  // Строки текстовых блоков — пересчёт при смене текста/размера/ширины/стиля/шрифта.
  const layoutKey = blocks.map((b) => b.type === 'text' ? `${b.id}|${b.text}|${b.size}|${b.widthPct}|${b.plate ? 1 : 0}|${b.weight ?? ''}|${b.italic ? 1 : 0}|${b.uppercase ? 1 : 0}|${b.font ?? ''}` : b.id).join('\n')
  const lines = useMemo(() => {
    const m = new Map<string, LayoutLine[]>()
    for (const b of blocks) if (b.type === 'text') m.set(b.id, layoutBlock(b, brand))
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, brand.font, fontsTick])

  const bgSupportsColor = bgMode === 'paper' || bgMode === 'dark' || bgMode === 'light'

  return (
    <>
      <style>{`
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Italic.ttf') format('truetype');font-weight:400;font-style:italic;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-BoldItalic.ttf') format('truetype');font-weight:700 900;font-style:italic;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-ExtraBold.ttf') format('truetype');font-weight:800;font-display:swap}
        @font-face{font-family:'MontserratEd';src:url('/fonts/Montserrat-Black.ttf') format('truetype');font-weight:900;font-display:swap}
        @font-face{font-family:'PT Serif';src:url('/fonts/PTSerif-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
        @font-face{font-family:'PT Serif';src:url('/fonts/PTSerif-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
        @font-face{font-family:'PT Serif';src:url('/fonts/PTSerif-Italic.ttf') format('truetype');font-weight:400;font-style:italic;font-display:swap}
        @font-face{font-family:'PT Serif';src:url('/fonts/PTSerif-BoldItalic.ttf') format('truetype');font-weight:700;font-style:italic;font-display:swap}
        @font-face{font-family:'PT Sans Narrow';src:url('/fonts/PTSansNarrow-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
        @font-face{font-family:'PT Sans Narrow';src:url('/fonts/PTSansNarrow-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
        @font-face{font-family:'Yeseva One';src:url('/fonts/YesevaOne-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
        @font-face{font-family:'Marck Script';src:url('/fonts/MarckScript-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
      `}</style>

      {/* Background: a photo / 2 photos / a designed backdrop */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Фон:</span>
        {([['photo', 'Фото'], ['split', '2 фото'], ['paper', 'Бумага'], ['dark', 'Тёмный'], ['light', 'Светлый']] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setBgMode(m)}
            className={`rounded-lg px-2.5 py-1.5 font-medium ${bgMode === m ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
        {bgSupportsColor && (
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground">
            цвет фона
            <input type="color" value={eff.bg} onChange={(e) => update({ bgColor: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="цвет фона" />
            {value.bgColor && <button type="button" onClick={() => update({ bgColor: null })} className="underline">как в бренде</button>}
          </label>
        )}
      </div>
      {bgMode === 'photo' && (
        <div className="mt-2 space-y-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
            {uploadingPhoto ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><Upload className="h-3.5 w-3.5" /> {photoUrl ? 'Сменить фото' : 'Загрузить фото'}</>}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto} onChange={(e) => uploadPhoto(e.target.files)} />
          </label>
          {photos && photos.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">или из загруженных:</span>
              {photos.map((u) => (
                <button key={u} type="button" onClick={() => update({ photoUrl: u })}
                  className={`h-12 w-8 shrink-0 overflow-hidden rounded border ${photoUrl === u ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
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
            <span className="text-[11px] text-muted-foreground">без текста на картинке — текст добавишь сверху сам · {UNIT_HINTS.image}</span>
          </div>
          {aiVariants.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">Выбери вариант (тапни) — или сгенерируй ещё раз:</p>
              <div className="grid grid-cols-3 gap-2">
                {aiVariants.map((v, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <button key={i} type="button" onClick={() => applyAiVariant(v)}
                    className="overflow-hidden rounded-lg border border-border bg-background/60 hover:border-primary focus:border-primary">
                    <img src={v.url} alt={`вариант ${i + 1}`} className="h-24 w-full object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}
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
          // Бумага = цвет фона + полупрозрачная текстура поверх (как Backdrop на
          // сервере). Раньше текстура ложилась на тёмный холст → «фон чёрный,
          // а после сохранения светлый» (Марина 06.09).
          <div className="pointer-events-none absolute inset-0"
            style={bgMode === 'paper'
              ? { backgroundColor: eff.bg, backgroundImage: "url('/textures/paper.png')", backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: eff.bg }} />
        )}
        {/* Направляющие центра */}
        {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-primary/80" />}
        {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-primary/80" />}
        {blocks.map((b) => {
          const isTxt = b.type === 'text'
          const pxW = b.widthPct * canvasW
          const { weight, accentWeight } = weightsOf(b)
          const famName = editorFamilyOf(b.font ?? brand.font)
          const fontStack = `'${famName}', 'MontserratEd', system-ui, sans-serif`
          return (
            <div
              key={b.id}
              ref={(el) => { if (el) blockEls.current.set(b.id, el); else blockEls.current.delete(b.id) }}
              onPointerDown={(e) => onBlockDown(e, b.id)}
              style={{
                position: 'absolute', left: `${b.xPct * 100}%`, top: `${b.yPct * 100}%`,
                ...(isTxt ? { width: `${b.widthPct * 100}%` } : { display: 'flex' }),
                transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined, transformOrigin: 'center',
                cursor: 'move', touchAction: 'none',
                outline: selected === b.id ? `2px solid ${brand.accentColor}` : 'none', outlineOffset: 3,
              }}
            >
              {b.type === 'image' && b.src ? (() => {
                const pxH = pxW / (b.aspect || 1)
                const r = frameRadius(pxW, pxH, b.radius)
                const op = typeof b.opacity === 'number' ? clamp(b.opacity, 0.05, 1) : 1
                if (b.crop) {
                  const g = cropGeometry(pxW, pxH, b.srcAspect || b.aspect || 1, b.crop)
                  return (
                    <div style={{ position: 'relative', width: pxW, height: pxH, overflow: 'hidden', borderRadius: r, opacity: op, pointerEvents: 'none' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.src} alt="" draggable={false} style={{ position: 'absolute', left: g.left, top: g.top, width: g.iw, height: g.ih, maxWidth: 'none' }} />
                    </div>
                  )
                }
                // eslint-disable-next-line @next/next/no-img-element
                return <img src={b.src} alt="" draggable={false} style={{ width: pxW, height: pxH, objectFit: 'contain', borderRadius: r, opacity: op, pointerEvents: 'none' }} />
              })() : b.type === 'shape' && b.shape === 'badge' ? (
                <Badge size={pxW} color={b.color} label={b.text || '1'} fontFamily="'MontserratEd'" />
              ) : b.type === 'shape' && b.shape ? (
                <ArrowSvg w={pxW} h={pxW / (b.aspect || SHAPE_ASPECT[b.shape])} color={b.color} curve={b.shape === 'arrow-curve'} />
              ) : (
                <PreviewLines lines={lines.get(b.id) ?? []} size={b.size} scale={scale} plate={b.plate} plateBg={plateBackground(b, eff.bg)}
                  platedColor={plateTextColor(b, eff.text)} plainColor={b.color} accent={eff.accent} align={b.align}
                  weight={weight} accentWeight={accentWeight} italic={!!b.italic} fontFamily={fontStack} />
              )}
            </div>
          )
        })}
      </div>

      {/* Selected-block controls */}
      {sel && (
        <div className="mt-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
          {sel.type === 'text' && (
            <>
              <textarea ref={taRef} value={sel.text} onChange={(e) => patch(sel.id, { text: e.target.value })} rows={2}
                placeholder="Текст блока (слово в **звёздочках** = акцент)"
                className="w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm" />
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Выдели слова в тексте и:</span>
                <button type="button" onClick={() => wrapSelection(sel, '__')} className={chip(false)} title="жирным только выделенное">Ж слово</button>
                {FONT_HAS_ITALIC[(sel.font ?? brand.font ?? 'montserrat') as FontKey] && (
                  <button type="button" onClick={() => wrapSelection(sel, '*')} className={`${chip(false)} italic`} title="курсивом только выделенное">К слово</button>
                )}
                <span>· **акцент** — цветом</span>
              </div>
            </>
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
            {sel.type === 'text' && (
              <div className="inline-flex items-center gap-1" title="ширина плашки с текстом">
                <span className="text-[11px] text-muted-foreground">ширина</span>
                <button type="button" onClick={() => widthSel(sel, -1)} aria-label="уже плашку" className="h-7 w-7 rounded-md border border-border font-bold">‹</button>
                <span className="w-9 text-center text-muted-foreground">{Math.round(sel.widthPct * 100)}%</span>
                <button type="button" onClick={() => widthSel(sel, 1)} aria-label="шире плашку" className="h-7 w-7 rounded-md border border-border font-bold">›</button>
              </div>
            )}
            <button type="button" onClick={() => patch(sel.id, { rotation: sel.rotation - 10 })} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground"><RotateCw className="h-3 w-3 -scale-x-100" /> −10°</button>
            <button type="button" onClick={() => patch(sel.id, { rotation: sel.rotation + 10 })} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground"><RotateCw className="h-3 w-3" /> +10°</button>
            {sel.rotation !== 0 && <button type="button" onClick={() => patch(sel.id, { rotation: 0 })} className="text-[11px] text-muted-foreground underline">сброс ↻</button>}
            <button type="button" onClick={() => centerSel(sel)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-muted-foreground" title="по центру холста"><AlignCenterHorizontal className="h-3 w-3" /> центр</button>

            {sel.type === 'text' && (
              <>
                {/* Начертание (Марина 24.08): Ж = жирный/обычный, К = курсив.
                    К прячем для шрифтов без настоящего italic-файла — иначе
                    превью врало бы (браузер наклоняет сам, сервер — нет). */}
                <button type="button" onClick={() => patch(sel.id, { weight: (sel.weight ?? 'bold') === 'bold' ? 'normal' : 'bold' })}
                  aria-label="жирный" className={`${chip((sel.weight ?? 'bold') === 'bold')} font-bold`}>Ж</button>
                {FONT_HAS_ITALIC[(sel.font ?? brand.font ?? 'montserrat') as FontKey] && (
                  <button type="button" onClick={() => patch(sel.id, { italic: !sel.italic })}
                    aria-label="курсив" className={`${chip(!!sel.italic)} italic`}>К</button>
                )}
                <button type="button" onClick={() => patch(sel.id, { uppercase: !sel.uppercase })}
                  aria-label="заглавные" className={chip(!!sel.uppercase)} title="заглавными буквами">АА</button>
                <button type="button" onClick={() => patch(sel.id, { plate: !sel.plate })}
                  className={`rounded-lg px-2.5 py-1.5 font-medium ${sel.plate ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>
                  {sel.plate ? 'на плашке' : 'без плашки'}
                </button>
                <button type="button" onClick={() => patch(sel.id, { align: sel.align === 'left' ? 'center' : sel.align === 'center' ? 'right' : 'left' })}
                  className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground">
                  {sel.align === 'left' ? 'слева' : sel.align === 'center' ? 'по центру' : 'справа'}
                </button>
                <select value={sel.font ?? ''} onChange={(e) => patch(sel.id, { font: (e.target.value || undefined) as FontKey | undefined, italic: e.target.value && !FONT_HAS_ITALIC[e.target.value as FontKey] ? false : sel.italic })}
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-xs" aria-label="шрифт блока">
                  <option value="">Шрифт бренда</option>
                  {FONT_KEYS.map((k) => <option key={k} value={k}>{FONT_SHORT[k] ?? FONTS[k].name}</option>)}
                </select>
              </>
            )}
            <button type="button" onClick={() => duplicate(sel.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-muted-foreground"><Copy className="h-3.5 w-3.5" /> копия</button>
            <button type="button" onClick={() => removeBlock(sel.id)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2.5 py-1.5 font-medium text-rose-600"><Trash2 className="h-3.5 w-3.5" /> удалить</button>
          </div>

          {/* Цвет: текст / стрелка / номер — бренд + палитра + любой (Марина 06.09).
              09.09 (Светлана): выбор ПРИМЕНЯЕТСЯ и когда текст на плашке —
              раньше там всегда рисовался цвет темы, и палитра «не работала».
              Пока цвет не выбран явно, на плашке остаётся цвет стиля. */}
          {!isImage && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{isText ? 'Цвет текста:' : 'Цвет:'}</span>
              {swatches.map((c, i) => (
                <button key={i} type="button" onClick={() => patch(sel.id, { color: c, colorSet: true })} aria-label="цвет"
                  className={`h-6 w-6 rounded-full border ${(!isText || !sel.plate || sel.colorSet) && sel.color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`} style={{ background: c }} />
              ))}
              <label className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                свой <input type="color" value={/^#[0-9a-f]{6}$/i.test(sel.color) ? sel.color : '#ffffff'} onChange={(e) => patch(sel.id, { color: e.target.value, colorSet: true })} className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0" aria-label="свой цвет" />
              </label>
              {isText && sel.colorSet && sel.plate && (
                <button type="button" onClick={() => patch(sel.id, { colorSet: undefined })} className="text-[11px] text-muted-foreground underline">как в стиле</button>
              )}
            </div>
          )}

          {/* Цвет ПЛАШКИ (Светлана 09.09: «непонятно, почему выбрал именно эти
              цвета» — плашка красилась фоном стиля и нигде не показывалась).
              Без выбора — фон стиля, как раньше. */}
          {isText && sel.plate && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Цвет плашки:</span>
              {plateSwatches.map((c, i) => (
                <button key={i} type="button" onClick={() => patch(sel.id, { plateColor: c })} aria-label="цвет плашки"
                  className={`h-6 w-6 rounded-full border ${(sel.plateColor ?? '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`} style={{ background: c }} />
              ))}
              <label className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                свой <input type="color" value={/^#[0-9a-f]{6}$/i.test(sel.plateColor || '') ? (sel.plateColor as string) : eff.bg} onChange={(e) => patch(sel.id, { plateColor: e.target.value })} className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0" aria-label="свой цвет плашки" />
              </label>
              {sel.plateColor && (
                <button type="button" onClick={() => patch(sel.id, { plateColor: undefined })} className="text-[11px] text-muted-foreground underline">как в стиле</button>
              )}
            </div>
          )}

          {/* Картинка: форма, прозрачность, кадрирование */}
          {isImage && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] text-muted-foreground">Форма:</span>
                {([[0, 'углы'], [0.15, 'скруглить'], [0.5, 'круг']] as const).map(([r, label]) => (
                  <button key={r} type="button" onClick={() => patch(sel.id, { radius: r || undefined })} className={chip((sel.radius ?? 0) === r)}>{label}</button>
                ))}
                <label className="ml-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  прозрачность
                  <input type="range" min={0.2} max={1} step={0.05} value={sel.opacity ?? 1} onChange={(e) => patch(sel.id, { opacity: Number(e.target.value) })} className="w-24" aria-label="прозрачность" />
                  {Math.round((sel.opacity ?? 1) * 100)}%
                </label>
                <button type="button" onClick={() => {
                  if (sel.crop) { patch(sel.id, { crop: undefined, aspect: sel.srcAspect ?? sel.aspect }); setCropOpen(false) }
                  else { patch(sel.id, { crop: { zoom: 1.2, x: 0, y: 0 }, srcAspect: sel.srcAspect ?? sel.aspect ?? 1 }); setCropOpen(true) }
                }} className={`${chip(!!sel.crop)} inline-flex items-center gap-1`}><CropIcon className="h-3 w-3" /> {sel.crop ? 'убрать обрезку' : 'обрезать'}</button>
                {sel.crop && <button type="button" onClick={() => setCropOpen((v) => !v)} className="text-[11px] text-muted-foreground underline">{cropOpen ? 'свернуть' : 'настроить'}</button>}
              </div>
              {sel.crop && cropOpen && (
                <div className="space-y-1.5 rounded-lg border border-border bg-background/60 p-2 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Рамка:</span>
                    {([[sel.srcAspect ?? sel.aspect ?? 1, 'как исходник'], [1, '1:1'], [0.8, '4:5'], [0.75, '3:4'], [16 / 9, '16:9']] as const).map(([a, label]) => (
                      <button key={label} type="button" onClick={() => patch(sel.id, { aspect: a })} className={chip(Math.abs((sel.aspect ?? 1) - a) < 0.01)}>{label}</button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2">зум <input type="range" min={1} max={3} step={0.05} value={sel.crop.zoom} onChange={(e) => patch(sel.id, { crop: { ...sel.crop!, zoom: Number(e.target.value) } })} className="flex-1" /> {sel.crop.zoom.toFixed(2)}×</label>
                  <label className="flex items-center gap-2">сдвиг ↔ <input type="range" min={-1} max={1} step={0.02} value={sel.crop.x} onChange={(e) => patch(sel.id, { crop: { ...sel.crop!, x: Number(e.target.value) } })} className="flex-1" /></label>
                  <label className="flex items-center gap-2">сдвиг ↕ <input type="range" min={-1} max={1} step={0.02} value={sel.crop.y} onChange={(e) => patch(sel.id, { crop: { ...sel.crop!, y: Number(e.target.value) } })} className="flex-1" /></label>
                </div>
              )}
            </div>
          )}
          {isArrow && <p className="text-[11px] text-muted-foreground">Поверни элемент (двумя пальцами или ±10°), чтобы направить стрелку.</p>}
        </div>
      )}
      {!sel && blocks.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Нажми на элемент, чтобы выбрать и настроить. Двумя пальцами — размер и поворот.</p>}
    </>
  )
}
