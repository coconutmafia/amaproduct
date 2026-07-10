'use client'

// Unified content studio (Матвей: один редактор для всех форматов). Block order
// and naming follow the tester's spec (UNIFY_EDITOR.md):
//   1. Загрузка фото → 2. Текст / сценарий → (Крючок — только для «пост»)
//   → 3. Формат + «Создать контент» → Оформленный контент
// Phase 1: POST works end-to-end. Carousel/Stories are ported in Phases 2–3.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Download, Sparkles } from 'lucide-react'
import { friendlyError } from '@/lib/friendlyError'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { PhotoUploader } from '@/components/content/PhotoUploader'

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

  useEffect(() => {
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error && (d.accentColor || d.bg || d.handle || d.logoUrl || d.font)) {
        setBrand({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle, handle: d.handle, logoUrl: d.logoUrl, font: d.font, accentStyle: d.accentStyle, styleNotes: d.styleNotes })
      }
    }).catch(() => {})
  }, [projectId])

  return (
    <div className="mx-auto max-w-2xl p-5 pb-24">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Создать контент</h1>
      <p className="mt-1 text-sm text-muted-foreground">Выбери формат, загрузи фото, напиши текст — соберём в твоём стиле.</p>

      {/* Format tabs — one consistent entry point for all formats */}
      <div className="mt-4 inline-flex rounded-xl border border-border bg-card p-1">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFormat(f.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${format === f.id ? 'gradient-accent text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {format === 'post' && <PostPanel projectId={projectId} brand={brand} initialText={initialText} />}
        {format === 'carousel' && <CarouselPanel projectId={projectId} brand={brand} initialText={initialText} />}
        {format === 'stories' && (
          <ComingSoon format="Сторис" href={`/projects/${projectId}/stories`}
            note="Сторис пока на отдельной странице «Оформление сторис». Перенос в этот единый редактор — Фаза 3." />
        )}
      </div>
    </div>
  )
}

function ComingSoon({ format, note, href }: { format: string; note: string; href?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-5 text-center space-y-3">
      <p className="text-sm font-semibold text-foreground">{format} — переносим в единый редактор</p>
      <p className="text-sm text-muted-foreground leading-relaxed">{note}</p>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Открыть текущий редактор {format.toLowerCase()} →
        </Link>
      )}
    </div>
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

function CarouselPanel({ projectId, brand, initialText }: { projectId: string; brand?: Brand; initialText: string }) {
  const [photos, setPhotos] = useState<string[]>([])
  const [text, setText] = useState(initialText)
  const [fmt, setFmt] = useState<CarouselFmt>('carousel')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [slides, setSlides] = useState<{ url: string; blob: Blob }[]>([])
  const [zipping, setZipping] = useState(false)

  async function renderSlide(carousel: Dict, index: number, photoMap: Record<number, string>): Promise<Blob> {
    const res = await fetch('/api/carousel/render', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carousel, index, format: fmt, brand, photos: photoMap }),
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
      const carousel = d.carousel as Dict

      // 1-е фото → 1-й слайд (обложка), 2-е → 2-й, … (порядок фото = порядок слайдов)
      const photoMap: Record<number, string> = {}
      photos.forEach((u, i) => { photoMap[i] = u })

      setStatus('Рисую слайды…')
      const n = slideCount(carousel)
      const blobs = await Promise.all(Array.from({ length: n }, (_, i) => renderSlide(carousel, i, photoMap)))
      setSlides(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })))
    } catch (e) { toast.error(friendlyError(e, 'Не удалось создать карусель')) }
    finally { setBusy(false); setStatus('') }
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
        onChange={(p) => setPhotos(p)} />

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
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Post format ───────────────────────────────────────────────────────────────
function PostPanel({ projectId, brand, initialText }: { projectId: string; brand?: Brand; initialText: string }) {
  const [photos, setPhotos] = useState<string[]>([])
  const [text, setText] = useState(initialText)
  const [headline, setHeadline] = useState(() => firstLine(initialText))
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
        onChange={(p) => { setPhotos(p); setImg(null) }} />

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
