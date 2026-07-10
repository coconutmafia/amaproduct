'use client'

// «Редактор сторис как в Инстаграме» — a single-slide designer (9:16). The whole
// editing surface (background, element library, drag/pinch, controls) lives in
// the shared <FreeCanvas/>; this wrapper just holds the one slide, the project
// brand, and the «Сохранить картинку» export.

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import { Loader2, Download, Type, Plus } from 'lucide-react'
import {
  FreeCanvas, blankSlide, slideHasBg, exportBrandFor, buildFreeSlide,
  type SlideValue, type Brand,
} from '@/components/carousel/FreeCanvas'

// A request from the parent to load a specific series frame into the editor
// (photo + its text as editable blocks). `token` changes to re-trigger a load.
export interface EditorLoadRequest { token: number; slide: SlideValue; index: number }

export function StoryEditor({
  projectId, photos, loadReq, onAddToSeries, seriesLen = 0,
  renderFormat = 'story', unitLabel = 'сторис', title = 'Редактор сторис (двигай элементы)',
}: {
  projectId: string
  photos?: string[]
  loadReq?: EditorLoadRequest | null
  onAddToSeries?: (args: { blob: Blob; index: number }) => Promise<void> | void
  seriesLen?: number
  /** engine FormatKey — 'story' | 'carousel' | 'post' | 'post45' | 'postWide' | 'carouselWide' */
  renderFormat?: string
  /** what one unit is called in the «Заменить …» selector */
  unitLabel?: string
  title?: string
}) {
  // 9:16 gets the tall canvas; every other aspect uses the carousel canvas.
  const canvasFormat: 'story' | 'carousel' = renderFormat === 'story' ? 'story' : 'carousel'
  const [slide, setSlide] = useState<SlideValue>(blankSlide)
  const [brand, setBrand] = useState<Brand>({ accentColor: '#EC1E8C', bg: '#F5F0E8', text: '#1A1A1A' })
  const [exporting, setExporting] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  // Where «Добавить в серию» will put the export: an existing slot index, or
  // 'append' for a new frame at the end.
  const [target, setTarget] = useState<number | 'append'>('append')
  const [addingToSeries, setAddingToSeries] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  // Parent asked to edit a specific frame → load its photo + text blocks, aim
  // the save at that slot, and scroll the editor into view.
  useEffect(() => {
    if (!loadReq) return
    setSlide(loadReq.slide)
    setTarget(loadReq.index)
    setResultUrl(null); setResultBlob(null)
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadReq?.token])

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
        body: JSON.stringify({ slide: buildFreeSlide(slide), format: renderFormat, projectId, brand: exportBrandFor(slide, brand) }),
      })
      if (!res.ok) throw new Error('Не удалось собрать картинку — попробуй ещё раз')
      const blob = await res.blob()
      setResultBlob(blob)
      setResultUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setExporting(false) }
  }

  async function addToSeries() {
    if (!resultBlob || !onAddToSeries) return
    setAddingToSeries(true)
    try {
      const index = target === 'append' ? seriesLen : target
      await onAddToSeries({ blob: resultBlob, index })
    } finally { setAddingToSeries(false) }
  }

  return (
    <section ref={sectionRef} className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Type className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">Добавляй текст, стрелки, иконки, номера и картинки. Перетаскивай пальцем, двумя пальцами — масштаб и поворот.</p>
        </div>
      </div>

      <div className="mt-3">
        <FreeCanvas projectId={projectId} brand={brand} value={slide} onChange={setSlide} format={canvasFormat} photos={photos} />
      </div>

      <button type="button" onClick={exportImg} disabled={exporting || !hasBg || slide.blocks.length === 0}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {exporting ? 'Собираю картинку…' : 'Сохранить картинку'}
      </button>

      {resultUrl && (
        <div className="mt-3 space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resultUrl} alt="Готовый кадр" className="mx-auto max-h-96 rounded-xl border border-border" />
          <div className="flex flex-wrap items-center gap-2">
            <a href={resultUrl} download={`${renderFormat}.png`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:border-primary/40">
              <Download className="h-3.5 w-3.5" /> Скачать
            </a>
            {onAddToSeries && (
              <>
                <select value={String(target)} onChange={(e) => setTarget(e.target.value === 'append' ? 'append' : Number(e.target.value))}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
                  {Array.from({ length: seriesLen }).map((_, i) => <option key={i} value={i}>Заменить {unitLabel} {i + 1}</option>)}
                  <option value="append">Новый в конце</option>
                </select>
                <button type="button" onClick={addToSeries} disabled={addingToSeries}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
                  {addingToSeries ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Добавить в серию
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
