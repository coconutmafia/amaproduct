'use client'

// Story builder: upload photos + a script → AI lays the script out into story
// frames (minimal on-screen text, brand voice) → the engine renders each frame
// 9:16 over your photo in your brand style → preview + download (PNG / ZIP).
// (Photo stories work today; video overlay is a later step — needs a video engine.)

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Upload, Loader2, Sparkles, Download, Trash2, Wand2 } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'
import { analyzePhotoBands, pickPlacement, type PhotoBands } from '@/lib/photoBands'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { showUpgrade } from '@/components/billing/UpgradeDialog'
import { VideoStory } from '@/components/carousel/VideoStory'
import { SchemeStory } from '@/components/carousel/SchemeStory'
import { StoryEditor } from '@/components/carousel/StoryEditor'

interface Brand { accentColor?: string; bg?: string; text?: string; bgStyle?: string; handle?: string; logoUrl?: string }
interface Frame {
  headline: string; body: string; cta: string
  position?: 'top' | 'center' | 'bottom'
  plate?: boolean
  // The photo this frame renders over (assigned at build, survives edits and
  // is stored with the set so a saved series can be reopened for edits).
  photo?: string
  // Set when the user explicitly changed it via a chat edit — photo analysis
  // must not override an explicit instruction.
  posLocked?: boolean
  plateLocked?: boolean
}
interface SetFrame { url: string; headline?: string; body?: string; cta?: string; position?: string; photo?: string }
interface StorySet { id: string; created_at: string; script: string; frames: SetFrame[] }

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
  // Gallery of saved designed sets + chat/voice edits
  const [sets, setSets] = useState<StorySet[]>([])
  const [savedSetId, setSavedSetId] = useState<string | null>(null)
  const [savingSet, setSavingSet] = useState(false)
  const [setBusyId, setSetBusyId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)

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

  // Load the saved-sets gallery
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/stories/sets?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && Array.isArray(d.sets)) setSets(d.sets as StorySet[])
    }).catch(() => {})
  }, [projectId])

  // Persist a rendered series into «Мои оформленные сторис» (storage + index).
  // Re-saving with the same setId replaces the set (used after chat edits).
  async function saveSet(frames: Frame[], blobs: Blob[], existingSetId: string | null) {
    setSavingSet(true)
    try {
      const urls: string[] = []
      for (let i = 0; i < blobs.length; i++) {
        const file = await downscaleImage(new File([blobs[i]], `story-${i + 1}.png`, { type: 'image/png' }), 1920, 0.87)
        const fd = new FormData()
        fd.append('projectId', projectId)
        fd.append('kind', 'story-out')
        fd.append('files', file)
        const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
        if (!res.ok || !data.urls?.[0]) throw new Error(data.error || 'Не удалось сохранить кадр')
        urls.push(data.urls[0])
      }
      const res = await fetch('/api/stories/sets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId, setId: existingSetId || undefined, script,
          frames: frames.map((f, i) => ({ url: urls[i], headline: f.headline, body: f.body, cta: f.cta, position: f.position, photo: f.photo })),
        }),
      })
      const d = await res.json().catch(() => ({} as { set?: StorySet; sets?: StorySet[]; error?: string }))
      if (!res.ok || !d.set) throw new Error(d.error || 'Не удалось сохранить серию')
      setSavedSetId(d.set.id)
      if (Array.isArray(d.sets)) setSets(d.sets)
      toast.success('Серия сохранена в «Мои оформленные сторис»')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить серию')
    } finally { setSavingSet(false) }
  }

  // Chat/voice edit of the designed series → re-render → re-save the same set
  async function applyEdit() {
    if (!editText.trim() || rendered.length === 0 || editing) return
    setEditing(true)
    try {
      const res = await fetch('/api/ai/edit-stories', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, frames: rendered.map((r) => r.frame), instruction: editText }),
      })
      const d = await res.json().catch(() => ({} as { stories?: Frame[]; error?: string }))
      if (!res.ok || !d.stories?.length) throw new Error(d.error || 'Не удалось применить правку')
      // Merge with the previous frames: anything the edit explicitly CHANGED
      // (position / plate) becomes locked so photo-analysis won't override it.
      const old = rendered.map((r) => r.frame)
      const frames = (d.stories as Frame[]).map((nf, i) => {
        const prev = old[i]
        const posChanged = !!nf.position && !!prev && nf.position !== prev.position
        const plateGiven = typeof nf.plate === 'boolean'
        return {
          ...nf,
          photo: prev?.photo ?? (photos.length ? photos[i % photos.length] : undefined),
          posLocked: (prev?.posLocked || posChanged) || undefined,
          plate: plateGiven ? nf.plate : prev?.plate,
          plateLocked: (prev?.plateLocked || (plateGiven && nf.plate !== prev?.plate)) || undefined,
        } as Frame
      })
      const blobs = await Promise.all(frames.map((f: Frame, i: number) => renderFrame(f, i)))
      rendered.forEach((r) => URL.revokeObjectURL(r.url))
      setRendered(blobs.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), frame: frames[i] })))
      setEditText('')
      toast.success('Правка применена — пересохраняю серию')
      void saveSet(frames, blobs, savedSetId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось применить правку')
    } finally { setEditing(false) }
  }

  // Reopen a SAVED set for edits («нет возможности редактировать визуал» — the
  // edit bar only existed for a freshly built series). Restores frames+photos
  // into the builder, re-renders, and edits overwrite the same set.
  async function openSetForEdit(set: StorySet) {
    setSetBusyId(set.id)
    try {
      const frames: Frame[] = set.frames.map((sf) => ({
        headline: sf.headline || '', body: sf.body || '', cta: sf.cta || '',
        position: (['top', 'center', 'bottom'].includes(String(sf.position)) ? sf.position : undefined) as Frame['position'],
        posLocked: sf.position ? true : undefined,
        photo: sf.photo,
      }))
      if (set.script) setScript(set.script)
      const uniquePhotos = [...new Set(frames.map((f) => f.photo).filter((p): p is string => !!p))]
      if (uniquePhotos.length) setPhotos(uniquePhotos.slice(0, 8))
      const blobs = await Promise.all(frames.map((f, i) => renderFrame(f, i)))
      rendered.forEach((r) => URL.revokeObjectURL(r.url))
      setRendered(blobs.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), frame: frames[i] })))
      setSavedSetId(set.id)
      toast.success('Серия открыта — панель правок под кадрами (можно голосом)')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось открыть серию') }
    finally { setSetBusyId(null) }
  }

  async function downloadSetZip(set: StorySet) {
    setSetBusyId(set.id)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      for (let i = 0; i < set.frames.length; i++) {
        const r = await fetch(set.frames[i].url)
        if (!r.ok) throw new Error('Не удалось скачать кадр')
        zip.file(`story-${String(i + 1).padStart(2, '0')}.jpg`, await r.blob())
      }
      download(await zip.generateAsync({ type: 'blob' }), 'stories.zip')
    } catch { toast.error('Не удалось собрать ZIP') }
    finally { setSetBusyId(null) }
  }

  async function deleteSet(set: StorySet) {
    setSetBusyId(set.id)
    try {
      const res = await fetch(`/api/stories/sets?projectId=${projectId}&setId=${encodeURIComponent(set.id)}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || 'Не удалось удалить') }
      setSets((prev) => prev.filter((s) => s.id !== set.id))
      if (savedSetId === set.id) setSavedSetId(null)
      toast.success('Серия удалена')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось удалить') }
    finally { setSetBusyId(null) }
  }

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

  // Photo-band analysis cache (per photo URL)
  const bandsCache = useRef(new Map<string, PhotoBands | null>())
  async function getBands(url: string): Promise<PhotoBands | null> {
    if (!bandsCache.current.has(url)) bandsCache.current.set(url, await analyzePhotoBands(url))
    return bandsCache.current.get(url) ?? null
  }

  // Final layout per frame: explicit user edits win; otherwise the PHOTO
  // decides (text goes to the calmest band; uniform band → no plates).
  async function resolveLayout(frame: Frame, photoUrl: string | undefined, idx: number): Promise<Frame> {
    const fallback: Frame = { ...frame, position: frame.position || (idx % 2 === 0 ? 'bottom' : 'top'), plate: frame.plate ?? true }
    if (!photoUrl) return { ...fallback, plate: false }
    const bands = await getBands(photoUrl)
    if (!bands) return fallback
    const pick = pickPlacement(bands, brand?.text || '#1A1A1A')
    return {
      ...frame,
      position: frame.posLocked && frame.position ? frame.position : pick.position,
      plate: frame.plateLocked && frame.plate !== undefined ? frame.plate : pick.plate,
      ...(frame.plateLocked && frame.plate === false ? {} : {}),
    }
  }

  async function renderFrame(frame: Frame, idx: number): Promise<Blob> {
    const photoUrl = frame.photo
    const f = await resolveLayout(frame, photoUrl, idx)
    let textColor: string | undefined
    if (f.plate === false && photoUrl) {
      const bands = await getBands(photoUrl)
      textColor = bands ? pickPlacement(bands, brand?.text || '#1A1A1A').textColor : '#FFFFFF'
    }
    const res = await fetch('/api/carousel/render', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'story', brand,
        slide: { kind: 'story', headline: frame.headline, body: frame.body, action: frame.cta, position: f.position, plate: f.plate, textColor, photoUrl },
      }),
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
      if (planRes.status === 402) { showUpgrade('limit'); return }
      const planData = await planRes.json()
      if (!planRes.ok) throw new Error(planData.error || 'Ошибка раскладки')
      const planned = (planData.stories || []) as Frame[]
      if (planned.length === 0) throw new Error('Пустая раскадровка')
      // Pin each frame to its photo — edits and the saved set keep the pairing
      const frames = planned.map((f, i) => ({ ...f, photo: photos.length ? photos[i % photos.length] : undefined }))

      const blobs = await Promise.all(frames.map((f, i) => renderFrame(f, i)))
      setRendered(blobs.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), frame: frames[i] })))
      // Auto-save into the gallery (new set per build) — nothing gets lost
      setSavedSetId(null)
      void saveSet(frames, blobs, null)
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
        <p className="mt-0.5 text-[11px] text-muted-foreground">В каком порядке загрузишь — в таком и оформит: 1-е фото = 1-й кадр.</p>
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
        {uploading && <p className="mt-2 text-[11px] text-muted-foreground">Загружаю и сжимаю фото — обычно 5-15 секунд на фото.</p>}
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">2. Сценарий / идея сторис</p>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5}
          placeholder="О чём сторис? Напиши идею или сценарий своими словами — AI разложит на кадры в твоём голосе."
          className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm" />
        <button type="button" onClick={build} disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Оформляю сторис…' : 'Оформить сторис'}
        </button>
        {busy && <p className="mt-2 text-[11px] text-muted-foreground">Обычно 1-2 минуты: раскладываю сценарий на кадры и оформляю каждый в твоём стиле. Не закрывай страницу.</p>}
      </section>

      {/* Video stories — text over a video (was only on «Создать визуал»; owner looked for it here) */}
      <div className="mt-5 mb-2 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> или видео-сторис <div className="h-px flex-1 bg-border" />
      </div>
      <VideoStory projectId={projectId} />

      {/* Story scheme — stages joined by hand-drawn connectors */}
      <div className="mt-5 mb-2 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> или схема <div className="h-px flex-1 bg-border" />
      </div>
      <SchemeStory projectId={projectId} />

      {/* Free drag editor — Instagram-style text-over-photo */}
      <div className="mt-5 mb-2 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> или свободный редактор <div className="h-px flex-1 bg-border" />
      </div>
      <StoryEditor projectId={projectId} />

      {rendered.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Готовые сторис · {rendered.length}</p>
            <button type="button" onClick={downloadZip} disabled={zipping}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> {zipping ? 'Собираю…' : 'Скачать всё (ZIP)'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {savingSet ? 'Сохраняю серию в «Мои оформленные сторис»…' : 'Серия автоматически сохраняется в «Мои оформленные сторис» ниже — найдёшь её там в любой момент.'}
          </p>
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

          {/* Chat/voice edits — «на третьей сторис поменяй…» */}
          <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Wand2 className="h-3.5 w-3.5 text-primary" /> Правки — голосом или текстом</p>
            <VoiceTextarea value={editText} onChange={setEditText} rows={2}
              placeholder="Например: «на 3-й сторис сделай текст короче», «в последней поменяй призыв на опрос», «на первой подними текст наверх»" />
            <button type="button" onClick={applyEdit} disabled={editing || !editText.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              {editing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {editing ? 'Применяю правку…' : 'Применить правку'}
            </button>
            {editing && <p className="text-[11px] text-muted-foreground">Обычно до минуты: правлю кадры и пересобираю картинки.</p>}
          </div>
        </section>
      )}

      {/* Gallery — saved designed series */}
      {sets.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">Мои оформленные сторис · {sets.length}</p>
          <div className="mt-3 space-y-4">
            {sets.map((set) => (
              <div key={set.id} className="rounded-xl border border-[#ECECEC] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{new Date(set.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {set.frames.length} кадров</p>
                    {set.script && <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{set.script}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => openSetForEdit(set)} disabled={setBusyId === set.id} title="Открыть для правок"
                      className="flex h-7 items-center justify-center gap-1 rounded-lg border border-[#E8E8E8] px-2 text-[11px] font-semibold text-muted-foreground hover:text-primary">
                      {setBusyId === set.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Редактировать
                    </button>
                    <button type="button" onClick={() => downloadSetZip(set)} disabled={setBusyId === set.id} title="Скачать ZIP"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-primary">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteSet(set)} disabled={setBusyId === set.id} title="Удалить серию"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8E8E8] text-muted-foreground hover:text-red-500 hover:border-red-200">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {set.frames.map((f, i) => (
                    <a key={i} href={f.url} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt={`кадр ${i + 1}`} className="h-28 w-16 rounded-md border border-border object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
