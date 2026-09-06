'use client'

// «Редактор сторис как в Инстаграме» — a single-slide designer (9:16). The whole
// editing surface (background, element library, drag/pinch, controls) lives in
// the shared <FreeCanvas/>; this wrapper just holds the one slide, the project
// brand, the «Сохранить картинку» export, the autosaved draft and the library
// of saved layouts («Сохранить оформление», Марина 06.09).

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import { Loader2, Download, Type, Plus, Save, FolderOpen, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  FreeCanvas, blankSlide, slideHasBg, exportBrandFor, buildFreeSlide, prepareFontsFor,
  type SlideValue, type Brand,
} from '@/components/carousel/FreeCanvas'
import { saveBlobSmart } from '@/lib/utils/saveFile'
import { fmtDateRu } from '@/lib/dates'

// A request from the parent to load a specific series frame into the editor
// (photo + its text as editable blocks). `token` changes to re-trigger a load.
export interface EditorLoadRequest { token: number; slide: SlideValue; index: number }

interface SavedLayout { id: string; title: string; format: string; design: SlideValue; preview_url: string | null; updated_at: string }

const isEmptySlide = (s: SlideValue) => s.blocks.length === 0 && !s.photoUrl && !s.photoTop && !s.photoBottom

export function StoryEditor({
  projectId, photos, loadReq, onAddToSeries, seriesLen = 0,
  renderFormat = 'story', unitLabel = 'сторис', title = 'Редактор сторис (двигай элементы)',
}: {
  projectId: string
  photos?: string[]
  loadReq?: EditorLoadRequest | null
  // slide = раскладка, из которой собрана картинка (снимок на момент экспорта).
  // Серия хранит её вместе с кадром — повторное «Редактировать вручную»
  // открывает НАСТОЯЩИЕ блоки, а не пустой чёрный холст (Станислав, 25.08).
  onAddToSeries?: (args: { blob: Blob; index: number; slide: SlideValue }) => Promise<void> | void
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
  // Слайд, из которого собран resultBlob (юзер мог продолжить править после
  // экспорта — в серию уходит именно та раскладка, что на картинке).
  const [resultSlide, setResultSlide] = useState<SlideValue | null>(null)
  // Where «Добавить в серию» will put the export: an existing slot index, or
  // 'append' for a new frame at the end.
  const [target, setTarget] = useState<number | 'append'>('append')
  const [addingToSeries, setAddingToSeries] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  // Сохранённые оформления (миграция 048) + черновик в localStorage: «возвращаться
  // и редактировать, а не начинать сначала каждый раз» (Марина 06.09).
  const draftKey = `ama_story_editor_${projectId}_${renderFormat}`
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const [layoutsReady, setLayoutsReady] = useState(false)
  const [savingLayout, setSavingLayout] = useState(false)
  const [layoutTitle, setLayoutTitle] = useState('')
  const [askTitle, setAskTitle] = useState(false)
  const [busyLayoutId, setBusyLayoutId] = useState<string | null>(null)
  const restoredRef = useRef(false)

  const loadLayouts = useCallback(async () => {
    try {
      const res = await fetch(`/api/story-layouts?projectId=${projectId}`)
      const d = await res.json().catch(() => ({} as { layouts?: SavedLayout[] }))
      if (res.ok && Array.isArray(d.layouts)) setLayouts((d.layouts as SavedLayout[]).filter((l) => l.format === renderFormat || !l.format))
    } catch { /* список не критичен */ }
    finally { setLayoutsReady(true) }
  }, [projectId, renderFormat])
  useEffect(() => { loadLayouts() }, [loadLayouts])

  // Черновик: восстановить при открытии (если нас не попросили открыть конкретный кадр).
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (loadReq) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw) as SlideValue
      if (d && Array.isArray(d.blocks) && !isEmptySlide(d)) {
        setSlide(d)
        toast.message('Восстановил незаконченное оформление', { action: { label: 'Начать заново', onClick: () => { setSlide(blankSlide()); try { localStorage.removeItem(draftKey) } catch { /* */ } } } })
      }
    } catch { /* битый черновик — игнор */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (isEmptySlide(slide)) localStorage.removeItem(draftKey)
        else localStorage.setItem(draftKey, JSON.stringify(slide))
      } catch { /* квота/приватный режим */ }
    }, 400)
    return () => clearTimeout(t)
  }, [slide, draftKey])

  // Parent asked to edit a specific frame → load its photo + text blocks, aim
  // the save at that slot, and scroll the editor into view.
  useEffect(() => {
    if (!loadReq) return
    setSlide(loadReq.slide)
    setTarget(loadReq.index)
    setResultUrl(null); setResultBlob(null); setResultSlide(null)
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
      // Строки текста считаются здесь тем же шрифтом, что на сервере — дождаться его.
      await prepareFontsFor(slide, brand)
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slide: buildFreeSlide(slide, 0, 1, brand), format: renderFormat, projectId, brand: exportBrandFor(slide, brand) }),
      })
      if (!res.ok) throw new Error('Не удалось собрать картинку — попробуй ещё раз')
      const blob = await res.blob()
      setResultBlob(blob)
      setResultSlide(JSON.parse(JSON.stringify(slide)) as SlideValue)
      setResultUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setExporting(false) }
  }

  async function addToSeries() {
    if (!resultBlob || !onAddToSeries) return
    setAddingToSeries(true)
    try {
      const index = target === 'append' ? seriesLen : target
      await onAddToSeries({ blob: resultBlob, index, slide: resultSlide ?? slide })
    } finally { setAddingToSeries(false) }
  }

  // Превью для библиотеки оформлений: последний экспорт, если он с этой раскладки.
  async function uploadPreview(): Promise<string | null> {
    if (!resultBlob || !resultSlide || JSON.stringify(resultSlide) !== JSON.stringify(slide)) return null
    try {
      const fd = new FormData()
      fd.append('projectId', projectId); fd.append('kind', 'story-out')
      fd.append('files', new File([resultBlob], 'layout.png', { type: 'image/png' }))
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({} as { urls?: string[] }))
      return res.ok ? d.urls?.[0] ?? null : null
    } catch { return null }
  }

  async function saveLayout() {
    const name = layoutTitle.trim() || `Оформление ${fmtDateRu(Date.now(), { day: 'numeric', month: 'short' })}`
    setSavingLayout(true)
    try {
      const previewUrl = await uploadPreview()
      const res = await fetch('/api/story-layouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: name, format: renderFormat, design: slide, previewUrl }),
      })
      const d = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) throw new Error(d.error || 'Не удалось сохранить оформление')
      toast.success(`Оформление «${name}» сохранено — открывай из «Мои оформления»`)
      setLayoutTitle(''); setAskTitle(false); setLayoutsOpen(true)
      await loadLayouts()
    } catch (e) { toast.error(friendlyError(e, 'Не удалось сохранить оформление'), { duration: 9000 }) }
    finally { setSavingLayout(false) }
  }

  function openLayout(l: SavedLayout) {
    setSlide(JSON.parse(JSON.stringify(l.design)) as SlideValue)
    setResultUrl(null); setResultBlob(null); setResultSlide(null)
    toast.message(`Открыл «${l.title}» — правь и сохраняй картинку`)
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function deleteLayout(id: string) {
    setBusyLayoutId(id)
    try {
      const res = await fetch(`/api/story-layouts?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Не удалось удалить')
      setLayouts((prev) => prev.filter((l) => l.id !== id))
    } catch (e) { toast.error(friendlyError(e, 'Не удалось удалить')) }
    finally { setBusyLayoutId(null) }
  }

  return (
    <section ref={sectionRef} className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Type className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">Добавляй текст, стрелки, иконки, номера и картинки. Перетаскивай пальцем, двумя пальцами — масштаб и поворот. Черновик сохраняется сам.</p>
        </div>
      </div>

      <div className="mt-3">
        <FreeCanvas projectId={projectId} brand={brand} value={slide} onChange={setSlide} format={canvasFormat} photos={photos} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportImg} disabled={exporting || !hasBg || slide.blocks.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {exporting ? 'Собираю картинку…' : 'Сохранить картинку'}
        </button>
        <button type="button" onClick={() => setAskTitle((v) => !v)} disabled={savingLayout || isEmptySlide(slide)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:border-primary/40 disabled:opacity-40">
          <Save className="h-4 w-4" /> Сохранить оформление
        </button>
        {layoutsReady && (
          <button type="button" onClick={() => setLayoutsOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:border-primary/40">
            {layoutsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <FolderOpen className="h-4 w-4" /> Мои оформления{layouts.length > 0 ? ` (${layouts.length})` : ''}
          </button>
        )}
      </div>
      {askTitle && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={layoutTitle} onChange={(e) => setLayoutTitle(e.target.value)} placeholder="Название — напр. «Кейс, тёмный фон»" maxLength={80}
            className="h-9 flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 text-sm" />
          <button type="button" onClick={saveLayout} disabled={savingLayout}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">
            {savingLayout ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Сохранить
          </button>
          <span className="text-[11px] text-muted-foreground">Раскладка со всеми элементами — потом откроешь и доправишь.</span>
        </div>
      )}
      {layoutsOpen && (
        <div className="mt-2 space-y-1.5">
          {layouts.length === 0 && <p className="text-[11px] text-muted-foreground">Пока пусто — собери слайд и нажми «Сохранить оформление».</p>}
          {layouts.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2">
              {l.preview_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={l.preview_url} alt="" className="h-14 w-9 rounded object-cover" />
                : <div className="flex h-14 w-9 items-center justify-center rounded bg-secondary text-[10px] text-muted-foreground">нет превью</div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{l.title}</p>
                <p className="text-[11px] text-muted-foreground">{fmtDateRu(l.updated_at, { day: 'numeric', month: 'short' })} · элементов: {l.design?.blocks?.length ?? 0}</p>
              </div>
              <button type="button" onClick={() => openLayout(l)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:border-primary/40">Открыть</button>
              <button type="button" onClick={() => deleteLayout(l.id)} disabled={busyLayoutId === l.id} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive" aria-label="удалить">
                {busyLayoutId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {resultUrl && (
        <div className="mt-3 space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resultUrl} alt="Готовый кадр" className="mx-auto max-h-96 rounded-xl border border-border" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => resultBlob && saveBlobSmart(`${renderFormat}.png`, resultBlob)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:border-primary/40">
              <Download className="h-3.5 w-3.5" /> Скачать
            </button>
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
