'use client'

// «Дизайн-карусель» — a multi-slide designer (4:5). Each slide is a full
// <FreeCanvas/> (photo / 2 photos / backdrop + draggable text, arrows, badges,
// icons, stickers, AI images, gradient accents). Build → render every slide via
// the engine → preview grid + per-slide download + ZIP. This brings the whole
// designer to carousels (owner's main reference = a designed carousel).

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import { Loader2, Plus, Copy, Trash2, GalleryHorizontalEnd, Images } from 'lucide-react'
import {
  FreeCanvas, blankSlide, slideHasBg, exportBrandFor, buildFreeSlide,
  type SlideValue, type Brand,
} from '@/components/carousel/FreeCanvas'

const MAX_SLIDES = 12

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function CarouselDesigner({ projectId }: { projectId: string }) {
  const [slides, setSlides] = useState<SlideValue[]>([blankSlide()])
  const [active, setActive] = useState(0)
  const [brand, setBrand] = useState<Brand>({ accentColor: '#EC1E8C', bg: '#F5F0E8', text: '#1A1A1A' })
  const [building, setBuilding] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [results, setResults] = useState<{ url: string; blob: Blob }[]>([])

  useEffect(() => {
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      setBrand((b) => ({
        accentColor: d.accentColor || b.accentColor,
        bg: d.bg || b.bg,
        text: d.text || b.text,
        bgStyle: d.bgStyle || undefined,
        font: d.font || undefined,
        accentStyle: d.accentStyle === 'flat' ? 'flat' : 'gradient',
      }))
    }).catch(() => {})
  }, [projectId])

  const updateActive = (v: SlideValue) => setSlides((prev) => prev.map((s, i) => (i === active ? v : s)))

  function addSlide() {
    if (slides.length >= MAX_SLIDES) { toast.error(`Максимум ${MAX_SLIDES} слайдов`); return }
    setSlides((prev) => [...prev, blankSlide()])
    setActive(slides.length)
  }
  function duplicateSlide() {
    if (slides.length >= MAX_SLIDES) { toast.error(`Максимум ${MAX_SLIDES} слайдов`); return }
    const copy = JSON.parse(JSON.stringify(slides[active])) as SlideValue
    setSlides((prev) => [...prev.slice(0, active + 1), copy, ...prev.slice(active + 1)])
    setActive(active + 1)
  }
  function removeSlide(i: number) {
    if (slides.length <= 1) return
    setSlides((prev) => prev.filter((_, j) => j !== i))
    setActive((a) => (i < a ? a - 1 : Math.min(a, slides.length - 2)))
  }

  async function build() {
    const missing = slides.findIndex((s) => !slideHasBg(s))
    if (missing >= 0) { setActive(missing); toast.error(`Слайд ${missing + 1}: выбери фон или загрузи фото`); return }
    setBuilding(true)
    results.forEach((r) => URL.revokeObjectURL(r.url))
    setResults([])
    try {
      const blobs: Blob[] = []
      // Sequential keeps memory + the render function calm; carousels are ≤12 slides.
      for (let i = 0; i < slides.length; i++) {
        const res = await fetch('/api/carousel/render', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slide: buildFreeSlide(slides[i], i, slides.length), format: 'carousel', projectId, brand: exportBrandFor(slides[i], brand) }),
        })
        if (!res.ok) throw new Error(`Слайд ${i + 1}: не удалось собрать`)
        blobs.push(await res.blob())
      }
      setResults(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })))
      toast.success('Карусель собрана')
    } catch (e) { toast.error(friendlyError(e, 'Ошибка сборки')) }
    finally { setBuilding(false) }
  }

  async function downloadZip() {
    if (results.length === 0) return
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      results.forEach((r, i) => zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, r.blob))
      download(await zip.generateAsync({ type: 'blob' }), 'carousel.zip')
    } catch (e) { toast.error(friendlyError(e, 'Не удалось собрать ZIP')) }
    finally { setZipping(false) }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <GalleryHorizontalEnd className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Дизайн-карусель (с нуля)</p>
          <p className="text-xs text-muted-foreground">Каждый слайд — свой холст 4:5: фон, текст, стрелки, иконки, номера, AI-картинки. Собери все слайды → ZIP.</p>
        </div>
      </div>

      {/* Slide strip */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {slides.map((s, i) => (
          <div key={i} className={`group relative inline-flex items-center rounded-lg border ${i === active ? 'border-primary bg-primary/10' : 'border-border'} `}>
            <button type="button" onClick={() => setActive(i)}
              className={`px-3 py-1.5 text-xs font-semibold ${i === active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              Слайд {i + 1}{!slideHasBg(s) ? ' ·' : ''}
            </button>
            {slides.length > 1 && (
              <button type="button" onClick={() => removeSlide(i)} aria-label="удалить слайд"
                className="pr-2 text-muted-foreground hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
            )}
          </div>
        ))}
        <button type="button" onClick={addSlide} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"><Plus className="h-3.5 w-3.5" /> Слайд</button>
        <button type="button" onClick={duplicateSlide} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"><Copy className="h-3.5 w-3.5" /> Копия</button>
      </div>

      {/* Active slide editor */}
      <div className="mt-3">
        <FreeCanvas key={active} projectId={projectId} brand={brand} value={slides[active]} onChange={updateActive} format="carousel" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={build} disabled={building}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
          {building ? 'Собираю слайды…' : `Собрать карусель (${slides.length})`}
        </button>
        {results.length > 0 && (
          <button type="button" onClick={downloadZip} disabled={zipping}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary/40 disabled:opacity-40">
            {zipping ? 'Собираю…' : 'Скачать всё (ZIP)'}
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {results.map((r, i) => (
            <div key={i} className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={`Слайд ${i + 1}`} className="w-full rounded-lg border border-border" />
              <button type="button" onClick={() => download(r.blob, `slide-${String(i + 1).padStart(2, '0')}.png`)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground">↓ Слайд {i + 1}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
