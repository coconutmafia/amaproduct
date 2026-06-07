'use client'

// Brand-kit setup for a project: upload style samples → AI extracts the palette/
// background/mood → edit colours/handle/logo → live slide preview → save. The
// saved kit is used by the slide renderer so this project's carousels/posts/
// stories come out in the creator's own style.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Upload, Sparkles, ArrowLeft, ImageIcon } from 'lucide-react'

type BgStyle = 'paper' | 'solid' | 'gradient'
interface Brand {
  accentColor: string
  bg: string
  text: string
  bgStyle: BgStyle
  handle: string
  logoUrl: string | null
}
const DEFAULTS: Brand = { accentColor: '#EC1E8C', bg: '#F3EEE7', text: '#262321', bgStyle: 'paper', handle: '', logoUrl: null }

const DEMO = {
  cover: { headline: 'твой **заголовок** в твоём стиле', subheadline: 'так будут выглядеть твои карусели и посты' },
  slides: [{ headline: 'пример **слайда**', body: 'текст контента подаётся в фирменном стиле: цвета, шрифт, акценты — твои.' }],
  last_slide: { text: 'нравится?', action: 'это твой фирменный стиль' },
}
const PREVIEWS = [{ i: 0, label: 'Обложка' }, { i: 1, label: 'Слайд' }, { i: 2, label: 'Финал' }]

export default function BrandPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [brand, setBrand] = useState<Brand>(DEFAULTS)
  const [samples, setSamples] = useState<string[]>([])
  const [kitSummary, setKitSummary] = useState<string>('')
  const [analyzing, setAnalyzing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [previewing, setPreviewing] = useState(false)

  const set = (patch: Partial<Brand>) => setBrand((b) => ({ ...b, ...patch }))

  // Load existing kit.
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error) {
        setBrand({
          accentColor: d.accentColor || DEFAULTS.accentColor,
          bg: d.bg || DEFAULTS.bg,
          text: d.text || DEFAULTS.text,
          bgStyle: (d.bgStyle as BgStyle) || DEFAULTS.bgStyle,
          handle: d.handle || '',
          logoUrl: d.logoUrl || null,
        })
        if (d.kit?.summary) setKitSummary(d.kit.summary)
        if (Array.isArray(d.kit?.samples)) setSamples(d.kit.samples)
      }
    }).catch(() => {})
  }, [projectId])

  // Debounced live preview.
  const renderPreview = useCallback(async (b: Brand, idx: number) => {
    setPreviewing(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ carousel: DEMO, index: idx, format: 'carousel', brand: b }),
      })
      if (res.ok) { const blob = await res.blob(); setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob) }) }
    } finally { setPreviewing(false) }
  }, [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void renderPreview(brand, previewIdx), 350)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [brand, previewIdx, renderPreview])

  async function uploadFiles(files: FileList | null, kind: 'sample' | 'logo') {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('kind', kind)
      Array.from(files).slice(0, 8).forEach((f) => fd.append('files', f))
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      if (kind === 'logo') { set({ logoUrl: data.urls[0] }); toast.success('Логотип загружен') }
      else { setSamples((s) => [...s, ...data.urls].slice(0, 8)); toast.success('Примеры загружены') }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить') }
    finally { setUploading(false) }
  }

  async function analyze() {
    if (samples.length === 0) { toast.error('Сначала загрузи примеры стиля'); return }
    setAnalyzing(true)
    try {
      const res = await fetch('/api/brand-kit/analyze', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, sampleUrls: samples }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка анализа')
      set({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle })
      if (d.kit?.summary) setKitSummary(d.kit.summary)
      toast.success('Стиль распознан')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось распознать') }
    finally { setAnalyzing(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/brand-kit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, ...brand }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      toast.success('Фирменный стиль сохранён')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось сохранить') }
    finally { setSaving(false) }
  }

  const swatch = (label: string, key: 'accentColor' | 'bg' | 'text') => (
    <label className="flex items-center gap-2 text-xs font-medium text-foreground">
      <input type="color" value={brand[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Brand>)} className="h-9 w-9 rounded-lg border border-border bg-transparent p-0.5" />
      <span className="flex flex-col"><span>{label}</span><span className="text-muted-foreground">{brand[key]}</span></span>
    </label>
  )

  return (
    <div className="mx-auto max-w-3xl p-5 pb-24">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Фирменный стиль</h1>
      <p className="mt-1 text-sm text-muted-foreground">Загрузи примеры своего оформления — AI распознает цвета, фон и настроение, и твои карусели/посты/сторис будут в твоём стиле.</p>
      <Link href={`/projects/${projectId}/stories`} className="mt-2 inline-block text-sm text-primary underline">Оформить сторис по фото →</Link>

      {/* 1. Samples + analyze */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">1. Примеры твоего стиля</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {samples.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
          ))}
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            <span className="text-[10px]">Добавить</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files, 'sample')} />
          </label>
        </div>
        <button type="button" onClick={analyze} disabled={analyzing || samples.length === 0}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analyzing ? 'Распознаю стиль…' : 'Распознать стиль'}
        </button>
        {kitSummary && <p className="mt-2 text-xs text-muted-foreground italic">{kitSummary}</p>}
      </section>

      {/* 2. Edit + preview */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">2. Настройки стиля</p>
          <div className="mt-3 flex flex-col gap-3">
            {swatch('Акцент', 'accentColor')}
            {swatch('Фон', 'bg')}
            {swatch('Текст', 'text')}
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Тип фона
              <select value={brand.bgStyle} onChange={(e) => set({ bgStyle: e.target.value as BgStyle })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
                <option value="paper">Бумага (фактура)</option>
                <option value="solid">Однотонный</option>
                <option value="gradient">Градиент</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Ник (на слайдах)
              <input value={brand.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="@username" className="h-9 rounded-lg border border-border bg-background px-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 hover:border-primary/40">
                <ImageIcon className="h-4 w-4" /> {brand.logoUrl ? 'Сменить лого' : 'Загрузить лого'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadFiles(e.target.files, 'logo')} />
              </span>
              {brand.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={brand.logoUrl} alt="" className="h-9 rounded border border-border object-contain" />}
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Превью</p>
            <div className="flex gap-1">
              {PREVIEWS.map((p) => (
                <button key={p.i} type="button" onClick={() => setPreviewIdx(p.i)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium ${previewIdx === p.i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary/20">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="превью" className={`h-full w-full object-contain transition-opacity ${previewing ? 'opacity-50' : ''}`} />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </section>

      <button type="button" onClick={save} disabled={saving}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить фирменный стиль
      </button>
    </div>
  )
}
