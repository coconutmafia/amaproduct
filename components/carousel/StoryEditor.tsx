'use client'

// «Редактор сторис как в Инстаграме» — a single-slide designer (9:16). The whole
// editing surface (background, element library, drag/pinch, controls) lives in
// the shared <FreeCanvas/>; this wrapper just holds the one slide, the project
// brand, and the «Сохранить картинку» export.

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2, Download, Type } from 'lucide-react'
import {
  FreeCanvas, blankSlide, slideHasBg, exportBrandFor, buildFreeSlide,
  type SlideValue, type Brand,
} from '@/components/carousel/FreeCanvas'

export function StoryEditor({ projectId }: { projectId: string }) {
  const [slide, setSlide] = useState<SlideValue>(blankSlide)
  const [brand, setBrand] = useState<Brand>({ accentColor: '#EC1E8C', bg: '#F5F0E8', text: '#1A1A1A' })
  const [exporting, setExporting] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  // Brand colours (accent + plate) so the editor matches the project's style.
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

  const hasBg = slideHasBg(slide)

  async function exportImg() {
    if (slide.bgMode === 'photo' && !slide.photoUrl) { toast.error('Сначала загрузи фото или выбери фон'); return }
    if (slide.bgMode === 'split' && !(slide.photoTop && slide.photoBottom)) { toast.error('Загрузи оба фото — верх и низ'); return }
    if (slide.blocks.length === 0) { toast.error('Добавь хотя бы один элемент'); return }
    setExporting(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slide: buildFreeSlide(slide), format: 'story', projectId, brand: exportBrandFor(slide, brand) }),
      })
      if (!res.ok) throw new Error('Не удалось собрать картинку — попробуй ещё раз')
      const blob = await res.blob()
      setResultUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ошибка') }
    finally { setExporting(false) }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Type className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Редактор сторис (двигай элементы)</p>
          <p className="text-xs text-muted-foreground">Добавляй текст, стрелки, иконки, номера и картинки. Перетаскивай пальцем, двумя пальцами — масштаб и поворот.</p>
        </div>
      </div>

      <div className="mt-3">
        <FreeCanvas projectId={projectId} brand={brand} value={slide} onChange={setSlide} format="story" />
      </div>

      <button type="button" onClick={exportImg} disabled={exporting || !hasBg || slide.blocks.length === 0}
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
