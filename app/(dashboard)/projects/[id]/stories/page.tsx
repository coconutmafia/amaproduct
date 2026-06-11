'use client'

// Story builder: upload photos + a script → AI lays the script out into story
// frames (minimal on-screen text, brand voice) → the engine renders each frame
// 9:16 over your photo in your brand style → preview + download (PNG / ZIP).
// (Photo stories work today; video overlay is a later step — needs a video engine.)

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Upload, Loader2, Sparkles, Download } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'

interface Brand { accentColor?: string; bg?: string; text?: string; bgStyle?: string; handle?: string; logoUrl?: string }
interface Frame { headline: string; body: string; cta: string; position?: 'top' | 'center' | 'bottom' }

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export default function StoriesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [photos, setPhotos] = useState<string[]>([])
  const [script, setScript] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [brand, setBrand] = useState<Brand | undefined>()
  const [rendered, setRendered] = useState<{ url: string; blob: Blob; frame: Frame }[]>([])
  const [zipping, setZipping] = useState(false)

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error && (d.accentColor || d.bg || d.handle || d.logoUrl)) {
        // Separate story style (brand_kit.story) wins over the posts style
        const story = (d.kit?.story ?? {}) as { accentColor?: string; bg?: string; text?: string; bgStyle?: string }
        setBrand({
          accentColor: story.accentColor || d.accentColor,
          bg: story.bg || d.bg,
          text: story.text || d.text,
          bgStyle: story.bgStyle || d.bgStyle,
          handle: d.handle, logoUrl: d.logoUrl,
        })
      }
    }).catch(() => {})
  }, [projectId])

  // Script handed over from the chat («Оформить сторис» on a stories answer)
  useEffect(() => {
    if (!projectId) return
    try {
      const key = `ama_stories_script_${projectId}`
      const handed = localStorage.getItem(key)
      if (handed) {
        localStorage.removeItem(key)
        setScript((s) => s || handed)
        toast.message('Сценарий из чата подставлен — жми «Собрать сторис»')
        return
      }
      // Draft restore — leaving the page must not lose the work (owner: «я
      // выйду, и оно всё — теперь не найду»). Photos are storage URLs → cheap.
      const draft = localStorage.getItem(`ama_stories_draft_${projectId}`)
      if (draft) {
        const d = JSON.parse(draft) as { script?: string; photos?: string[] }
        if (d.script) setScript((s) => s || d.script || '')
        if (Array.isArray(d.photos) && d.photos.length) setPhotos((p) => (p.length ? p : d.photos!))
      }
    } catch { /* ignore */ }
  }, [projectId])

  // Auto-save the builder draft (script + photo URLs)
  useEffect(() => {
    if (!projectId) return
    try {
      if (script.trim() || photos.length) localStorage.setItem(`ama_stories_draft_${projectId}`, JSON.stringify({ script, photos }))
    } catch { /* ignore */ }
  }, [projectId, script, photos])

  async function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      // One downscaled file per request — iPhone originals blow Vercel's
      // ~4.5 MB body cap (story frames render at 1080×1920, 2000px is plenty).
      const all: string[] = []
      for (const f of Array.from(files).slice(0, 8)) {
        const small = await downscaleImage(f, 2000)
        const fd = new FormData()
        fd.append('projectId', projectId)
        fd.append('kind', 'story')
        fd.append('files', small)
        const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
        if (!res.ok) throw new Error(data.error || (res.status === 413 ? 'Фото слишком большое' : `Не удалось загрузить (${res.status})`))
        all.push(...(data.urls || []))
      }
      setPhotos((p) => [...p, ...all].slice(0, 8))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить') }
    finally { setUploading(false) }
  }

  async function renderFrame(frame: Frame, photoUrl: string | undefined): Promise<Blob> {
    const res = await fetch('/api/carousel/render', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'story', brand, slide: { kind: 'story', headline: frame.headline, body: frame.body, action: frame.cta, position: frame.position, photoUrl } }),
    })
    if (!res.ok) throw new Error('render failed')
    return res.blob()
  }

  async function build() {
    if (!script.trim()) { toast.error('Напиши сценарий или идею сторис'); return }
    setBusy(true)
    rendered.forEach((r) => URL.revokeObjectURL(r.url))
    setRendered([])
    try {
      const planRes = await fetch('/api/ai/plan-stories', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, script, count: photos.length || 5 }),
      })
      const planData = await planRes.json()
      if (!planRes.ok) throw new Error(planData.error || 'Ошибка раскладки')
      const frames = (planData.stories || []) as Frame[]
      if (frames.length === 0) throw new Error('Пустая раскадровка')

      const blobs = await Promise.all(frames.map((f, i) => renderFrame(f, photos.length ? photos[i % photos.length] : undefined)))
      setRendered(blobs.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), frame: frames[i] })))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось собрать сторис') }
    finally { setBusy(false) }
  }

  async function downloadZip() {
    if (rendered.length === 0) return
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      rendered.forEach((r, i) => zip.file(`story-${String(i + 1).padStart(2, '0')}.png`, r.blob))
      download(await zip.generateAsync({ type: 'blob' }), 'stories.zip')
    } catch { toast.error('Не удалось собрать ZIP') }
    finally { setZipping(false) }
  }

  return (
    <div className="mx-auto max-w-3xl p-5 pb-24">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Оформление сторис</h1>
      <p className="mt-1 text-sm text-muted-foreground">Загрузи фото и напиши сценарий — AI разложит его на кадры сторис в твоём фирменном стиле. {!brand && <Link href={`/projects/${projectId}/brand`} className="text-primary underline">Сначала настрой стиль →</Link>}</p>

      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">1. Фото (по одному на кадр; если меньше — повторятся)</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="h-24 w-[3.4rem] rounded-lg border border-border object-cover" />
          ))}
          <label className="flex h-24 w-[3.4rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="text-[9px]">фото</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadPhotos(e.target.files)} />
          </label>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">2. Сценарий / идея сторис</p>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5}
          placeholder="О чём сторис? Напиши идею или сценарий своими словами — AI разложит на кадры в твоём голосе."
          className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm" />
        <button type="button" onClick={build} disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Собираю сторис…' : 'Собрать сторис'}
        </button>
      </section>

      {rendered.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Готовые сторис · {rendered.length}</p>
            <button type="button" onClick={downloadZip} disabled={zipping}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> {zipping ? 'Собираю…' : 'Скачать всё (ZIP)'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Скачай картинки сейчас — в сервисе они пока не хранятся. Сценарий и фото сохраняются как черновик: вернёшься и нажмёшь «Собрать сторис» заново.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rendered.map((r, i) => (
              <div key={i} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={`Сторис ${i + 1}`} className="w-full rounded-lg border border-border" />
                <button type="button" onClick={() => download(r.blob, `story-${String(i + 1).padStart(2, '0')}.png`)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground">↓ Сторис {i + 1}</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
