'use client'

// "Сделать слайды" — turns a carousel's structured_data into real slide images.
// Renders each slide via /api/carousel/render (one request per slide), previews
// them, and offers per-slide download + "download all" as a ZIP (jszip).
// Drop-in: needs only the `carousel` object (cover/slides[]/last_slide).

import { useState } from 'react'

type Dict = Record<string, unknown>

interface Brand {
  accentColor?: string
  bg?: string
  bgStyle?: 'paper' | 'solid' | 'gradient'
  handle?: string
}

function slideCount(carousel: Dict): number {
  const slides = Array.isArray(carousel.slides) ? carousel.slides : []
  return (carousel.cover ? 1 : 0) + slides.length + (carousel.last_slide ? 1 : 0)
}

async function renderSlide(carousel: Dict, index: number, brand?: Brand): Promise<Blob> {
  const res = await fetch('/api/carousel/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ carousel, index, format: 'carousel', brand }),
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

export function CarouselSlides({ carousel, brand }: { carousel: Dict; brand?: Brand }) {
  const total = slideCount(carousel)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [slides, setSlides] = useState<{ url: string; blob: Blob }[]>([])
  const [zipping, setZipping] = useState(false)

  if (total === 0) return null

  async function generate() {
    setBusy(true)
    setErr(null)
    slides.forEach((s) => URL.revokeObjectURL(s.url))
    setSlides([])
    try {
      const blobs = await Promise.all(Array.from({ length: total }, (_, i) => renderSlide(carousel, i, brand)))
      setSlides(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сгенерировать слайды')
    } finally {
      setBusy(false)
    }
  }

  function openModal() {
    setOpen(true)
    if (slides.length === 0) void generate()
  }

  async function downloadZip() {
    if (slides.length === 0) return
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      slides.forEach((s, i) => zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, s.blob))
      const out = await zip.generateAsync({ type: 'blob' })
      download(out, 'carousel-slides.zip')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось собрать ZIP')
    } finally {
      setZipping(false)
    }
  }

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
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Слайды карусели{total ? ` · ${total}` : ''}</p>
              <div className="flex items-center gap-2">
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
              {busy && <p className="py-10 text-center text-sm text-muted-foreground">Рисую {total} слайдов…</p>}
              {err && (
                <div className="py-6 text-center">
                  <p className="text-sm text-red-500">{err}</p>
                  <button type="button" onClick={generate} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/40">
                    Повторить
                  </button>
                </div>
              )}
              {!busy && !err && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {slides.map((s, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt={`Слайд ${i + 1}`} className="w-full rounded-lg border border-border" />
                      <button
                        type="button"
                        onClick={() => download(s.blob, `slide-${String(i + 1).padStart(2, '0')}.png`)}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        ↓ Слайд {i + 1}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
