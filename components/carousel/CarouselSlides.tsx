'use client'

// "Сделать слайды" — turns a carousel into real slide images. Works two ways:
//  • carousel: a structured carousel object (generator / saved items)
//  • sourceText: raw chat-generated text → structured on open via /api/carousel/structure
// Renders each slide via /api/carousel/render, previews them, and offers per-slide
// + ZIP download. Loads the project's brand kit so slides match the creator's style.

import { useState } from 'react'
import { toast } from 'sonner'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { downscaleImage } from '@/lib/downscaleImage'

type Dict = Record<string, unknown>

interface Brand {
  accentColor?: string
  bg?: string
  text?: string
  bgStyle?: 'paper' | 'solid' | 'gradient'
  handle?: string
  logoUrl?: string
}

function slideCount(carousel: Dict): number {
  const slides = Array.isArray(carousel.slides) ? carousel.slides : []
  return (carousel.cover ? 1 : 0) + slides.length + (carousel.last_slide ? 1 : 0)
}

async function renderSlide(carousel: Dict, index: number, brand?: Brand, photos?: Record<number, string>): Promise<Blob> {
  const res = await fetch('/api/carousel/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ carousel, index, format: 'carousel', brand, photos }),
  })
  if (!res.ok) throw new Error(`slide ${index + 1}: ${res.status}`)
  return res.blob()
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function CarouselSlides({
  carousel: initialCarousel,
  sourceText,
  type = 'carousel',
  projectId,
  brand,
}: {
  carousel?: Dict
  sourceText?: string
  type?: string
  projectId?: string
  brand?: Brand
}) {
  const [carousel, setCarousel] = useState<Dict | undefined>(initialCarousel)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [slides, setSlides] = useState<{ url: string; blob: Blob }[]>([])
  const [zipping, setZipping] = useState(false)
  const [effBrand, setEffBrand] = useState<Brand | undefined>(brand)
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  // Per-slide photo backgrounds (owner: «хочу добавлять свои картинки/подложку»)
  const [slidePhotos, setSlidePhotos] = useState<Record<number, string>>({})
  const [photoBusy, setPhotoBusy] = useState<number | null>(null)

  // Nothing to work with → render nothing. (Structured-but-empty also hides.)
  if (!initialCarousel && !sourceText) return null
  if (initialCarousel && slideCount(initialCarousel) === 0) return null

  async function generate(c: Dict, b?: Brand, photos?: Record<number, string>) {
    setStatus('Рисую слайды…')
    slides.forEach((s) => URL.revokeObjectURL(s.url))
    setSlides([])
    const n = slideCount(c)
    const ph = photos ?? slidePhotos
    const blobs = await Promise.all(Array.from({ length: n }, (_, i) => renderSlide(c, i, b ?? effBrand, ph)))
    setSlides(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })))
  }

  // Set/remove the creator's own photo as a slide background → re-render that slide
  async function setSlidePhoto(i: number, files: FileList | null) {
    if (!files?.[0] || !projectId || !carousel) return
    setPhotoBusy(i)
    try {
      const small = await downscaleImage(files[0], 2000)
      const fd = new FormData()
      fd.append('projectId', projectId); fd.append('kind', 'post'); fd.append('files', small)
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
      if (!res.ok || !d.urls?.[0]) throw new Error(d.error || 'Не удалось загрузить фото')
      const next = { ...slidePhotos, [i]: d.urls[0] }
      setSlidePhotos(next)
      const blob = await renderSlide(carousel, i, effBrand, next)
      setSlides((prev) => prev.map((s, j) => (j === i ? (URL.revokeObjectURL(s.url), { blob, url: URL.createObjectURL(blob) }) : s)))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось') }
    finally { setPhotoBusy(null) }
  }

  async function clearSlidePhoto(i: number) {
    if (!carousel) return
    setPhotoBusy(i)
    try {
      const next = { ...slidePhotos }
      delete next[i]
      setSlidePhotos(next)
      const blob = await renderSlide(carousel, i, effBrand, next)
      setSlides((prev) => prev.map((s, j) => (j === i ? (URL.revokeObjectURL(s.url), { blob, url: URL.createObjectURL(blob) }) : s)))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось') }
    finally { setPhotoBusy(null) }
  }

  async function openModal() {
    setOpen(true)
    if (slides.length > 0) return
    setBusy(true)
    setErr(null)
    try {
      // 1) brand kit (so slides match the creator's style)
      let b = brand
      if (!b && projectId) {
        try {
          const r = await fetch(`/api/brand-kit?projectId=${projectId}`)
          const d = await r.json()
          if (r.ok && (d.accentColor || d.bg || d.handle || d.logoUrl)) {
            b = { accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle, handle: d.handle, logoUrl: d.logoUrl }
          }
        } catch { /* default theme */ }
      }
      setEffBrand(b)

      // 2) resolve the carousel — structure raw text on demand if needed
      let c = carousel
      if (!c && sourceText) {
        setStatus('Раскладываю на слайды…')
        const r = await fetch('/api/carousel/structure', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: sourceText, type }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Не удалось разложить на слайды')
        c = d.carousel as Dict
        setCarousel(c)
      }
      if (!c) throw new Error('Нет данных карусели')

      await generate(c, b)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сгенерировать слайды')
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  // Chat/voice edit of the slides («на 2-м слайде не разрывай 15 тысяч…») —
  // only the requested bits change, then the slides re-render.
  async function applyEdit() {
    if (!editText.trim() || !carousel || editing) return
    setEditing(true)
    try {
      const res = await fetch('/api/ai/edit-carousel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ carousel, instruction: editText }),
      })
      const d = await res.json().catch(() => ({} as { carousel?: Dict; error?: string }))
      if (!res.ok || !d.carousel) throw new Error(d.error || 'Не удалось применить правку')
      setCarousel(d.carousel)
      setEditText('')
      await generate(d.carousel)
      toast.success('Правка применена')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось применить правку')
    } finally { setEditing(false) }
  }

  async function downloadZip() {
    if (slides.length === 0) return
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      slides.forEach((s, i) => zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, s.blob))
      download(await zip.generateAsync({ type: 'blob' }), 'carousel-slides.zip')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось собрать ZIP')
    } finally {
      setZipping(false)
    }
  }

  const count = slides.length || (carousel ? slideCount(carousel) : 0)

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
      >
        🖼 Сделать слайды-картинки
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Слайды карусели{count ? ` · ${count}` : ''}</p>
              <div className="flex items-center gap-2">
                {projectId && (
                  <a href={`/projects/${projectId}/brand`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/40">🎨 Стиль</a>
                )}
                <button
                  type="button"
                  onClick={downloadZip}
                  disabled={busy || zipping || slides.length === 0}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
                >
                  {zipping ? 'Собираю…' : 'Скачать всё (ZIP)'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/40">
                  Закрыть
                </button>
              </div>
            </div>

            <div className="overflow-auto p-4">
              {busy && <p className="py-10 text-center text-sm text-muted-foreground">{status || 'Готовлю…'}</p>}
              {err && (
                <div className="py-6 text-center">
                  <p className="text-sm text-red-500">{err}</p>
                  <button type="button" onClick={openModal} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/40">
                    Повторить
                  </button>
                </div>
              )}
              {!busy && !err && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {slides.map((s, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt={`Слайд ${i + 1}`} className={`w-full rounded-lg border border-border ${photoBusy === i ? 'opacity-50' : ''}`} />
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => download(s.blob, `slide-${String(i + 1).padStart(2, '0')}.png`)}
                            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            ↓ Слайд {i + 1}
                          </button>
                          {projectId && (
                            slidePhotos[i] ? (
                              <button type="button" onClick={() => clearSlidePhoto(i)} disabled={photoBusy !== null}
                                className="text-[11px] font-medium text-muted-foreground hover:text-red-500">
                                {photoBusy === i ? '…' : '✕ фон'}
                              </button>
                            ) : (
                              <label className={`cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-primary ${photoBusy !== null ? 'opacity-50' : ''}`}>
                                {photoBusy === i ? 'Загружаю…' : '📷 Фото'}
                                <input type="file" accept="image/*" className="hidden" disabled={photoBusy !== null}
                                  onChange={(e) => setSlidePhoto(i, e.target.files)} />
                              </label>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {slides.length > 0 && (
                    <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">Правки — голосом или текстом</p>
                      <VoiceTextarea value={editText} onChange={setEditText} rows={2}
                        placeholder="Например: «на 2-м слайде не разрывай 15 тысяч рублей», «обложку сделай короче», «выдели слово система»" />
                      <button type="button" onClick={applyEdit} disabled={editing || !editText.trim()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
                        {editing ? 'Применяю правку…' : 'Применить правку'}
                      </button>
                      {editing && <p className="text-[11px] text-muted-foreground">Обычно до минуты: правлю слайды и перерисовываю.</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
