'use client'

// Brand-kit setup for a project, in TWO tabs (owner request):
//   «Стиль постов»  — samples → AI extracts palette → edit → carousel preview.
//   «Стиль сториз»  — separate style for story frames, stored in brand_kit.story
//                     (jsonb, no migration); stories inherit the posts style
//                     until a story style is recognised/saved.
// The saved kit is used by the slide renderer so this project's carousels/
// posts/stories come out in the creator's own style.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Upload, Sparkles, ArrowLeft, ImageIcon, CheckCircle2, X } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'

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

const ANALYZE_HINT = 'Распознавание занимает ~30-60 секунд'

export default function BrandPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'posts' | 'story'>('posts')

  // ── Posts (main) style ──
  const [brand, setBrand] = useState<Brand>(DEFAULTS)
  const [samples, setSamples] = useState<string[]>([])
  const [kitSummary, setKitSummary] = useState<string>('')
  const [analyzing, setAnalyzing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [previewing, setPreviewing] = useState(false)

  // ── Story style (brand_kit.story) ──
  const [hasStoryStyle, setHasStoryStyle] = useState(false)
  const [storyBrand, setStoryBrand] = useState<Pick<Brand, 'accentColor' | 'bg' | 'text' | 'bgStyle'>>(DEFAULTS)
  const [storySamples, setStorySamples] = useState<string[]>([])
  const [storySummary, setStorySummary] = useState<string>('')
  const [storyAnalyzing, setStoryAnalyzing] = useState(false)
  const [storyUploading, setStoryUploading] = useState(false)
  const [storySaving, setStorySaving] = useState(false)
  const [storyPreviewUrl, setStoryPreviewUrl] = useState<string | null>(null)
  const [storyPreviewing, setStoryPreviewing] = useState(false)

  const set = (patch: Partial<Brand>) => setBrand((b) => ({ ...b, ...patch }))
  const setStory = (patch: Partial<typeof storyBrand>) => setStoryBrand((b) => ({ ...b, ...patch }))

  // Load existing kit (both styles).
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error) {
        const main: Brand = {
          accentColor: d.accentColor || DEFAULTS.accentColor,
          bg: d.bg || DEFAULTS.bg,
          text: d.text || DEFAULTS.text,
          bgStyle: (d.bgStyle as BgStyle) || DEFAULTS.bgStyle,
          handle: d.handle || '',
          logoUrl: d.logoUrl || null,
        }
        setBrand(main)
        if (d.kit?.summary) setKitSummary(d.kit.summary)
        if (Array.isArray(d.kit?.samples)) setSamples(d.kit.samples)
        const story = d.kit?.story as { accentColor?: string; bg?: string; text?: string; bgStyle?: string; summary?: string; samples?: string[] } | undefined
        if (story && (story.accentColor || story.bg)) {
          setHasStoryStyle(true)
          setStoryBrand({
            accentColor: story.accentColor || main.accentColor,
            bg: story.bg || main.bg,
            text: story.text || main.text,
            bgStyle: (story.bgStyle as BgStyle) || main.bgStyle,
          })
          if (story.summary) setStorySummary(story.summary)
          if (Array.isArray(story.samples)) setStorySamples(story.samples)
        } else {
          // No separate story style yet → start from the posts style
          setStoryBrand({ accentColor: main.accentColor, bg: main.bg, text: main.text, bgStyle: main.bgStyle })
        }
      }
    }).catch(() => {})
  }, [projectId])

  // Debounced live previews (carousel for posts tab, 9:16 frame for story tab).
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

  const renderStoryPreview = useCallback(async (b: typeof storyBrand, handle: string, logoUrl: string | null) => {
    setStoryPreviewing(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          format: 'story',
          brand: { ...b, handle, logoUrl },
          slide: { kind: 'story', headline: 'твой **заголовок**', body: 'так будут выглядеть твои сторис', action: 'это твой стиль сториз' },
        }),
      })
      if (res.ok) { const blob = await res.blob(); setStoryPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob) }) }
    } finally { setStoryPreviewing(false) }
  }, [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (tab === 'posts') void renderPreview(brand, previewIdx)
      else void renderStoryPreview(storyBrand, brand.handle, brand.logoUrl)
    }, 350)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [tab, brand, previewIdx, storyBrand, renderPreview, renderStoryPreview])

  async function uploadFiles(files: FileList | null, kind: 'sample' | 'logo', forStory = false) {
    if (!files || files.length === 0) return
    const setBusy = forStory ? setStoryUploading : setUploading
    setBusy(true)
    try {
      // Downscale on-device (iPhone photos are 4–12 MB; Vercel caps the request
      // body at ~4.5 MB) and upload ONE file per request so a batch never
      // exceeds the limit either.
      const all: string[] = []
      for (const f of Array.from(files).slice(0, 8)) {
        const small = await downscaleImage(f, kind === 'logo' ? 900 : 1600)
        const fd = new FormData()
        fd.append('projectId', projectId)
        fd.append('kind', kind)
        fd.append('files', small)
        const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
        if (!res.ok) throw new Error(data.error || (res.status === 413 ? 'Фото слишком большое' : `Не удалось загрузить (${res.status})`))
        all.push(...(data.urls || []))
      }
      if (kind === 'logo') { set({ logoUrl: all[0] }); toast.success('Логотип загружен') }
      else if (forStory) { setStorySamples((s) => [...s, ...all].slice(0, 8)); toast.success('Примеры сториз загружены') }
      else { setSamples((s) => [...s, ...all].slice(0, 8)); toast.success('Примеры загружены') }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить') }
    finally { setBusy(false) }
  }

  async function removeSample(url: string, forStory: boolean) {
    // Optimistic removal; restore on failure.
    const prev = forStory ? storySamples : samples
    const setList = forStory ? setStorySamples : setSamples
    setList(prev.filter((u) => u !== url))
    try {
      const res = await fetch('/api/brand-kit/upload', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, url, target: forStory ? 'story' : 'posts' }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Не удалось удалить')
      toast.success('Фото удалено')
    } catch (e) {
      setList(prev)
      toast.error(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  async function analyze(forStory = false) {
    const urls = forStory ? storySamples : samples
    if (urls.length === 0) { toast.error(forStory ? 'Сначала загрузи примеры оформления сториз' : 'Сначала загрузи примеры стиля'); return }
    const setBusy = forStory ? setStoryAnalyzing : setAnalyzing
    setBusy(true)
    try {
      const res = await fetch('/api/brand-kit/analyze', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, sampleUrls: urls, ...(forStory ? { target: 'story' } : {}) }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка анализа')
      if (forStory) {
        setStoryBrand({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle })
        if (d.story?.summary) setStorySummary(d.story.summary)
        setHasStoryStyle(true)
        toast.success('Стиль сториз распознан — проверь цвета и сохрани')
      } else {
        set({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle })
        if (d.kit?.summary) setKitSummary(d.kit.summary)
        toast.success('Стиль распознан — проверь цвета и сохрани')
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось распознать') }
    finally { setBusy(false) }
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
      toast.success('Стиль постов сохранён')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось сохранить') }
    finally { setSaving(false) }
  }

  async function saveStory() {
    setStorySaving(true)
    try {
      const res = await fetch('/api/brand-kit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, story: storyBrand }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setHasStoryStyle(true)
      toast.success('Стиль сториз сохранён')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось сохранить') }
    finally { setStorySaving(false) }
  }

  const swatch = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="flex items-center gap-2 text-xs font-medium text-foreground">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-9 rounded-lg border border-border bg-transparent p-0.5" />
      <span className="flex flex-col"><span>{label}</span><span className="text-muted-foreground">{value}</span></span>
    </label>
  )

  // Samples + analyze section, shared between tabs.
  const samplesSection = (forStory: boolean) => {
    const urls = forStory ? storySamples : samples
    const busy = forStory ? storyAnalyzing : analyzing
    const up = forStory ? storyUploading : uploading
    const recognized = forStory ? !!storySummary || hasStoryStyle : !!kitSummary
    const summary = forStory ? storySummary : kitSummary
    return (
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">1. {forStory ? 'Примеры оформления твоих сториз' : 'Примеры твоего стиля'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {urls.map((u, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
              <button type="button" onClick={() => removeSample(u, forStory)} title="Удалить фото"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-background shadow hover:bg-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {up ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            <span className="text-[10px]">Добавить</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files, 'sample', forStory)} />
          </label>
        </div>
        {recognized && !busy && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-green-600">
            <CheckCircle2 className="h-4 w-4" /> Стиль распознан — проверь цвета ниже и сохрани
          </p>
        )}
        <button type="button" onClick={() => analyze(forStory)} disabled={busy || urls.length === 0}
          className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
            recognized && !busy
              ? 'border border-border text-foreground hover:border-primary/40'
              : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Распознаю стиль…' : recognized ? 'Распознать заново' : 'Распознать стиль'}
        </button>
        {(busy || (!recognized && urls.length > 0)) && (
          <p className="mt-2 text-[11px] text-muted-foreground">{ANALYZE_HINT}{busy ? ' — не закрывай страницу.' : '.'}</p>
        )}
        {summary && <p className="mt-2 text-xs text-muted-foreground italic">{summary}</p>}
      </section>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-5 pb-28">
      <Link href={`/projects/${projectId}/knowledge`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К материалам
      </Link>
      <h1 className="text-xl font-bold text-foreground">Фирменный стиль</h1>
      <p className="mt-1 text-sm text-muted-foreground">Загрузи примеры своего оформления — AI распознает цвета, фон и настроение. Стиль постов и стиль сториз настраиваются отдельно.</p>

      {/* Tabs */}
      <div className="mt-4 inline-flex rounded-xl border border-border bg-card p-1 text-sm">
        <button type="button" onClick={() => setTab('posts')}
          className={`rounded-lg px-4 py-2 font-semibold ${tab === 'posts' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Стиль постов
        </button>
        <button type="button" onClick={() => setTab('story')}
          className={`rounded-lg px-4 py-2 font-semibold ${tab === 'story' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          Стиль сториз
        </button>
      </div>

      {tab === 'story' && !hasStoryStyle && (
        <p className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs text-foreground">
          Пока сторис используют стиль постов. Загрузи примеры оформления своих сториз и нажми «Распознать стиль» — у сториз появится свой стиль.
        </p>
      )}

      {samplesSection(tab === 'story')}

      {/* 2. Edit + preview */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">2. Настройки стиля</p>
          <div className="mt-3 flex flex-col gap-3">
            {tab === 'posts' ? (
              <>
                {swatch('Акцент', brand.accentColor, (v) => set({ accentColor: v }))}
                {swatch('Фон', brand.bg, (v) => set({ bg: v }))}
                {swatch('Текст', brand.text, (v) => set({ text: v }))}
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
              </>
            ) : (
              <>
                {swatch('Акцент', storyBrand.accentColor, (v) => setStory({ accentColor: v }))}
                {swatch('Фон', storyBrand.bg, (v) => setStory({ bg: v }))}
                {swatch('Текст', storyBrand.text, (v) => setStory({ text: v }))}
                <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                  Тип фона
                  <select value={storyBrand.bgStyle} onChange={(e) => setStory({ bgStyle: e.target.value as BgStyle })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
                    <option value="paper">Бумага (фактура)</option>
                    <option value="solid">Однотонный</option>
                    <option value="gradient">Градиент</option>
                  </select>
                </label>
                <p className="text-[11px] text-muted-foreground">Ник и лого — общие, задаются во вкладке «Стиль постов».</p>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Превью</p>
            {tab === 'posts' && (
              <div className="flex gap-1">
                {PREVIEWS.map((p) => (
                  <button key={p.i} type="button" onClick={() => setPreviewIdx(p.i)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${previewIdx === p.i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{p.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className={`mt-3 flex items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary/20 ${tab === 'posts' ? 'aspect-[4/5]' : 'aspect-[9/16] max-h-96 mx-auto'}`}>
            {tab === 'posts' ? (
              previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="превью" className={`h-full w-full object-contain transition-opacity ${previewing ? 'opacity-50' : ''}`} />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              )
            ) : storyPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={storyPreviewUrl} alt="превью сторис" className={`h-full w-full object-contain transition-opacity ${storyPreviewing ? 'opacity-50' : ''}`} />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </section>

      {tab === 'posts' ? (
        <button type="button" onClick={save} disabled={saving}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить стиль постов
        </button>
      ) : (
        <button type="button" onClick={saveStory} disabled={storySaving}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {storySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить стиль сториз
        </button>
      )}
    </div>
  )
}
