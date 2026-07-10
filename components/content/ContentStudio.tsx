'use client'

// Unified content studio (Матвей: один редактор для всех форматов). Block order
// and naming follow the tester's spec (UNIFY_EDITOR.md):
//   1. Загрузка фото → 2. Текст / сценарий → (Крючок — только для «пост»)
//   → 3. Формат + «Создать контент» → Оформленный контент
// Phase 1: POST works end-to-end. Carousel/Stories are ported in Phases 2–3.

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Download, Sparkles, Wand2, CalendarPlus, Check } from 'lucide-react'
import { friendlyError } from '@/lib/friendlyError'
import { takeStudioHandoff } from '@/lib/studioHandoff'
import { SaveButton } from '@/components/content/SaveButton'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { PhotoUploader } from '@/components/content/PhotoUploader'
import { StoryEditor, type EditorLoadRequest } from '@/components/carousel/StoryEditor'
import { StoriesPanel } from '@/components/content/StoriesPanel'
import { type Block, type SlideValue } from '@/components/carousel/FreeCanvas'

type Format = 'post' | 'carousel' | 'stories'
interface Brand { accentColor?: string; bg?: string; text?: string; bgStyle?: string; handle?: string; logoUrl?: string; font?: string; accentStyle?: 'gradient' | 'flat'; styleNotes?: string }

const FORMATS: { id: Format; label: string }[] = [
  { id: 'post', label: 'Пост' },
  { id: 'carousel', label: 'Карусель' },
  { id: 'stories', label: 'Сторис' },
]

function firstLine(text: string): string {
  const l = text.split('\n').map((s) => s.trim()).find(Boolean) || ''
  return l.replace(/^[#>\-*\s]+/, '').slice(0, 90)
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function ContentStudio({ projectId, initialFormat = 'post', initialText = '' }: {
  projectId: string
  initialFormat?: Format
  initialText?: string
}) {
  const [format, setFormat] = useState<Format>(initialFormat)
  const [brand, setBrand] = useState<Brand | undefined>()
  // Text lives in the shell so «В план» / «В Готовое» can save it for any format.
  const [text, setText] = useState(initialText)
  // Set when we arrived from a specific content-plan day (путь A) → auto-bind.
  const [day, setDay] = useState<number | null>(null)
  const [phase, setPhase] = useState<string | undefined>()
  const [dayLocked, setDayLocked] = useState(false)

  // Handoff from the chat / content-plan («Оформить»): format + scenario + day.
  useEffect(() => {
    const h = takeStudioHandoff(projectId)
    if (!h) return
    setFormat(h.format)
    setText(h.text)
    setPhase(h.phase)
    if (typeof h.day === 'number' && h.day > 0) { setDay(h.day); setDayLocked(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error && (d.accentColor || d.bg || d.handle || d.logoUrl || d.font)) {
        setBrand({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle, handle: d.handle, logoUrl: d.logoUrl, font: d.font, accentStyle: d.accentStyle, styleNotes: d.styleNotes })
      }
    }).catch(() => {})
  }, [projectId])

  const persistKey = `${projectId}:${format}:${day ?? 'free'}`

  return (
    <div className="mx-auto max-w-2xl p-5 pb-24">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Создать контент</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Выбери формат, загрузи фото, напиши текст — соберём в твоём стиле.
        {!brand && <> <Link href={`/projects/${projectId}/brand`} className="text-primary underline">Сначала настрой стиль →</Link></>}
      </p>

      {/* Format tabs — one consistent entry point for all formats */}
      <div className="mt-4 inline-flex rounded-xl border border-border bg-card p-1">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFormat(f.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${format === f.id ? 'gradient-accent text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {dayLocked && day && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
          <CalendarPlus className="h-3.5 w-3.5" /> Привязано ко дню {day} контент-плана
        </p>
      )}

      <div className="mt-5">
        {format === 'post' && <PostPanel projectId={projectId} brand={brand} text={text} onTextChange={setText} persistKey={persistKey} />}
        {format === 'carousel' && <CarouselPanel projectId={projectId} brand={brand} text={text} onTextChange={setText} persistKey={persistKey} />}
        {format === 'stories' && <StoriesPanel projectId={projectId} text={text} onTextChange={setText} persistKey={persistKey} />}
      </div>

      <PublicationBar projectId={projectId} format={format} text={text}
        day={day} setDay={setDay} dayLocked={dayLocked} phase={phase} />
    </div>
  )
}

// ── Сохранение публикации: «В Готовое» + «В план» (с выбором дня) ─────────────
function PublicationBar({ projectId, format, text, day, setDay, dayLocked, phase }: {
  projectId: string; format: Format; text: string
  day: number | null; setDay: (d: number | null) => void; dayLocked: boolean; phase?: string
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function saveToPlan() {
    if (!text.trim()) { toast.error('Сначала напиши текст'); return }
    if (!day || day < 1) { toast.error('Выбери день контент-плана'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/content-items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, contentType: format, dayNumber: day, phase: phase || 'awareness', bodyText: text }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})) as { error?: string }; throw new Error(j.error || 'Ошибка') }
      setSaved(true)
      toast.success(`Публикация добавлена в контент-план, день ${day}`)
    } catch (e) { toast.error(friendlyError(e, 'Не удалось добавить в план')) }
    finally { setSaving(false) }
  }

  if (!text.trim()) return null

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">Сохранить публикацию</p>
      <div className="flex flex-wrap items-center gap-2">
        <SaveButton body={text} projectId={projectId} contentType={format}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:border-primary/40" />

        {!dayLocked && (
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            День
            <input type="number" min={1} value={day ?? ''} onChange={(e) => setDay(e.target.value ? Number(e.target.value) : null)}
              placeholder="№" className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
          </label>
        )}

        <button type="button" onClick={saveToPlan} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />}
          {saving ? 'Сохраняю…' : saved ? 'В плане' : 'В план'}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {dayLocked
          ? 'День взят из контент-плана, откуда ты начал(а).'
          : 'Укажи номер дня контент-плана — публикация появится в нём.'}
      </p>
    </section>
  )
}

// ── Carousel format ───────────────────────────────────────────────────────────
// Built like the stories series (tester): photos in order → slides in order.
// Cover = first slide, final = last slide. Formats 4:5 / 1:1 / 16:9.
type Dict = Record<string, unknown>
type CarouselFmt = 'carousel' | 'post' | 'carouselWide'

function slideCount(c: Dict): number {
  const slides = Array.isArray(c.slides) ? c.slides : []
  return (c.cover ? 1 : 0) + slides.length + (c.last_slide ? 1 : 0)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Text of slide `i`: 0 = обложка, последний = финальный, остальные — из slides[].
function slideTextAt(c: Dict, i: number): { headline: string; body: string } {
  const slides = (Array.isArray(c.slides) ? c.slides : []) as Dict[]
  const hasCover = !!c.cover
  const n = slideCount(c)
  if (hasCover && i === 0) {
    const cov = c.cover as Dict
    return { headline: str(cov.headline), body: str(cov.subheadline) }
  }
  if (c.last_slide && i === n - 1) {
    const last = c.last_slide as Dict
    return { headline: str(last.text), body: str(last.action) }
  }
  const sl = slides[i - (hasCover ? 1 : 0)] ?? {}
  return { headline: str(sl.headline), body: str(sl.body) }
}

let _cbid = 0
const cBlockId = () => `cb${++_cbid}`

// Slide → free-editor value (photo bg + its text as editable blocks).
function carouselSlideToSlide(c: Dict, i: number, photo?: string): SlideValue {
  const { headline, body } = slideTextAt(c, i)
  const blocks: Block[] = []
  let y = 0.14
  const add = (text: string, size: number) => {
    if (!text.trim()) return
    blocks.push({
      id: cBlockId(), type: 'text', text: text.trim(),
      xPct: 0.08, yPct: Math.min(y, 0.9), widthPct: 0.84,
      size, color: '#FFFFFF', plate: true, align: 'left', rotation: 0,
    })
    y += 0.14
  }
  add(headline, 64)
  add(body, 40)
  return { bgMode: 'photo', photoUrl: photo ?? null, photoTop: null, photoBottom: null, blocks }
}

function CarouselPanel({ projectId, brand, text, onTextChange, persistKey }: { projectId: string; brand?: Brand; text: string; onTextChange: (v: string) => void; persistKey?: string }) {
  const [photos, setPhotos] = useState<string[]>([])
  const setText = onTextChange
  const [fmt, setFmt] = useState<CarouselFmt>('carousel')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [carousel, setCarousel] = useState<Dict | null>(null)
  // `manual` slides were designed by hand — AI re-renders must not overwrite them.
  const [slides, setSlides] = useState<{ url: string; blob: Blob; manual?: boolean }[]>([])
  const [zipping, setZipping] = useState(false)
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editReq, setEditReq] = useState<EditorLoadRequest | null>(null)
  const tokenRef = useRef(0)

  // 1-е фото → 1-й слайд (обложка), 2-е → 2-й, … (порядок фото = порядок слайдов)
  function photoMap(): Record<number, string> {
    const m: Record<number, string> = {}
    photos.forEach((u, i) => { m[i] = u })
    return m
  }

  async function renderSlide(c: Dict, index: number): Promise<Blob> {
    const res = await fetch('/api/carousel/render', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carousel: c, index, format: fmt, brand, photos: photoMap() }),
    })
    if (!res.ok) throw new Error(`слайд ${index + 1}: ${res.status}`)
    return res.blob()
  }

  async function create() {
    if (!text.trim()) { toast.error('Напиши текст — разложим его на слайды'); return }
    setBusy(true)
    slides.forEach((s) => URL.revokeObjectURL(s.url))
    setSlides([])
    try {
      setStatus('Раскладываю на слайды…')
      const r = await fetch('/api/carousel/structure', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, type: 'carousel', styleNotes: brand?.styleNotes }),
      })
      const d = await r.json()
      if (!r.ok || !d.carousel) throw new Error(d.error || 'Не удалось разложить на слайды')
      const c = d.carousel as Dict
      setCarousel(c)

      setStatus('Рисую слайды…')
      const n = slideCount(c)
      const blobs = await Promise.all(Array.from({ length: n }, (_, i) => renderSlide(c, i)))
      setSlides(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })))
    } catch (e) { toast.error(friendlyError(e, 'Не удалось создать карусель')) }
    finally { setBusy(false); setStatus('') }
  }

  // AI-правка текста слайдов. Вручную оформленные слайды не перерисовываем.
  async function applyEdit() {
    if (!carousel || !editText.trim() || editing) return
    setEditing(true)
    try {
      const res = await fetch('/api/ai/edit-carousel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ carousel, instruction: editText }),
      })
      const d = await res.json().catch(() => ({} as { carousel?: Dict; error?: string }))
      if (!res.ok || !d.carousel) throw new Error(d.error || 'Не удалось применить правку')
      const c = d.carousel as Dict
      setCarousel(c)
      const prev = slides
      const n = slideCount(c)
      const blobs = await Promise.all(Array.from({ length: n }, (_, i) =>
        prev[i]?.manual ? Promise.resolve(prev[i].blob) : renderSlide(c, i)))
      prev.forEach((s) => URL.revokeObjectURL(s.url))
      setSlides(blobs.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), manual: prev[i]?.manual })))
      setEditText('')
      toast.success('Правка применена')
    } catch (e) { toast.error(friendlyError(e, 'Не удалось применить правку')) }
    finally { setEditing(false) }
  }

  // Открыть слайд в свободном редакторе (фото + его текст блоками).
  function editSlideManually(i: number) {
    if (!carousel) return
    tokenRef.current += 1
    setEditReq({ token: tokenRef.current, slide: carouselSlideToSlide(carousel, i, photos[i]), index: i })
    toast.message('Слайд открыт в редакторе ниже — меняй и жми «Добавить в серию»')
  }

  // Экспорт из свободного редактора → в конкретный слайд серии (или новый).
  function addManualToSeries({ blob, index }: { blob: Blob; index: number }) {
    const url = URL.createObjectURL(blob)
    const arr = [...slides]
    if (index >= 0 && index < arr.length) {
      URL.revokeObjectURL(arr[index].url)
      arr[index] = { url, blob, manual: true }
    } else {
      arr.push({ url, blob, manual: true })
    }
    setSlides(arr)
    toast.success('Слайд добавлен в серию')
  }

  async function downloadZip() {
    if (slides.length === 0) return
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      slides.forEach((s, i) => zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, s.blob))
      download(await zip.generateAsync({ type: 'blob' }), 'carousel.zip')
    } catch { toast.error('Не удалось собрать ZIP') }
    finally { setZipping(false) }
  }

  return (
    <div className="space-y-4">
      {/* 1. Загрузка фото — порядок = порядок слайдов */}
      <PhotoUploader projectId={projectId} photos={photos} kind="post" max={10}
        onChange={(p) => setPhotos(p)} persistKey={persistKey} />

      {/* 2. Текст / сценарий — текст, который ляжет на слайды */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm font-semibold text-foreground">Текст / сценарий</p>
        <VoiceTextarea value={text} onChange={setText} rows={5}
          placeholder="Текст, который пойдёт на слайды. Первый слайд станет обложкой, последний — финальным." />
      </section>

      {/* 3. Формат + «Создать контент» */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Формат:</span>
          {([['carousel', '4:5 (вертикальная)'], ['post', '1:1 (квадрат)'], ['carouselWide', '16:9 (горизонтальная)']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setFmt(v)}
              className={`rounded-lg px-3 py-1.5 font-medium ${fmt === v ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={create} disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {status || 'Создаю…'}</> : <><Sparkles className="h-4 w-4" /> Создать контент</>}
        </button>
      </section>

      {/* 4. Свободный редактор — любой формат, можно унести туда слайд */}
      <StoryEditor projectId={projectId} photos={photos} loadReq={editReq}
        onAddToSeries={addManualToSeries} seriesLen={slides.length}
        renderFormat={fmt} unitLabel="слайд" title="Свободный редактор слайда (двигай элементы)" />

      {/* Оформленный контент */}
      {slides.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Оформленный контент · {slides.length}</p>
            <button type="button" onClick={downloadZip} disabled={zipping}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> {zipping ? 'Собираю…' : 'Скачать всё (ZIP)'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {slides.map((s, i) => (
              <div key={i} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={`Слайд ${i + 1}`} className="w-full rounded-lg border border-border" />
                <button type="button" onClick={() => download(s.blob, `slide-${String(i + 1).padStart(2, '0')}.png`)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  ↓ {i === 0 ? 'Обложка' : i === slides.length - 1 ? 'Финальный' : `Слайд ${i + 1}`}
                </button>
                <button type="button" onClick={() => editSlideManually(i)}
                  className="text-[11px] font-medium text-primary/80 hover:text-primary">✎ Редактировать вручную</button>
              </div>
            ))}
          </div>

          {/* Правки голосом/текстом — как у сторис */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Wand2 className="h-3.5 w-3.5 text-primary" /> Правки — голосом или текстом</p>
            <VoiceTextarea value={editText} onChange={setEditText} rows={2}
              placeholder="Например: «на 3-м слайде сделай текст короче», «в финальном поменяй призыв»" />
            <button type="button" onClick={applyEdit} disabled={editing || !editText.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              {editing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {editing ? 'Применяю правку…' : 'Применить правку'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

// ── Post format ───────────────────────────────────────────────────────────────
function PostPanel({ projectId, brand, text, onTextChange, persistKey }: { projectId: string; brand?: Brand; text: string; onTextChange: (v: string) => void; persistKey?: string }) {
  const [photos, setPhotos] = useState<string[]>([])
  const setText = onTextChange
  const [headline, setHeadline] = useState(() => firstLine(text))
  const [fmt, setFmt] = useState<'post45' | 'post' | 'postWide'>('post45')
  const [hooking, setHooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null)
  const photoUrl = photos[0] ?? null

  async function suggestHook() {
    if (!text.trim()) { toast.error('Сначала напиши текст поста'); return }
    setHooking(true)
    try {
      const res = await fetch('/api/post-hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, styleNotes: brand?.styleNotes }) })
      const d = await res.json()
      if (!res.ok || !d.hook) throw new Error(d.error || 'Не удалось')
      setHeadline(d.hook); setImg(null)
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setHooking(false) }
  }

  async function create() {
    if (!headline.trim()) { toast.error('Добавь крючок на картинку'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: fmt, brand, slide: { kind: photoUrl ? 'photo' : 'post', headline, photoUrl } }),
      })
      if (!res.ok) throw new Error('Не удалось сделать картинку')
      const blob = await res.blob()
      setImg((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) } })
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {/* 1. Загрузка фото */}
      <PhotoUploader projectId={projectId} photos={photos} kind="post" max={1} showOrderHint={false}
        onChange={(p) => { setPhotos(p); setImg(null) }} persistKey={persistKey} />

      {/* 2. Текст / сценарий */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm font-semibold text-foreground">Текст / сценарий</p>
        <VoiceTextarea value={text} onChange={setText} rows={4}
          placeholder="Напиши или надиктуй текст поста — он пойдёт в подпись, а крючок ляжет на картинку." />
      </section>

      {/* 2b. Крючок — только для формата «пост» */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Крючок на картинке <span className="font-normal text-muted-foreground">(коротко!)</span></p>
          <button type="button" onClick={suggestHook} disabled={hooking}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
            {hooking ? '✨ Подбираю…' : '✨ Подобрать крючок'}
          </button>
        </div>
        <VoiceTextarea value={headline} onChange={(v) => { setHeadline(v.slice(0, 70)); setImg(null) }} rows={2}
          placeholder="Одна цепляющая фраза. Слово в **звёздочках** = акцент." />
      </section>

      {/* 3. Формат + «Создать контент» — всегда в одном месте, после фото и текста */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Формат:</span>
          {([['post45', '4:5 (лента)'], ['post', '1:1 (квадрат)'], ['postWide', 'Горизонтальный']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => { setFmt(v); setImg(null) }}
              className={`rounded-lg px-3 py-1.5 font-medium ${fmt === v ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={create} disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Создаю…</> : <><Sparkles className="h-4 w-4" /> Создать контент</>}
        </button>
      </section>

      {/* Оформленный контент */}
      {img && (
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">Оформленный контент</p>
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="превью" className="max-h-[60vh] w-auto rounded-lg border border-border" />
            <button type="button" onClick={() => download(img.blob, 'post.png')} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> Скачать картинку
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
