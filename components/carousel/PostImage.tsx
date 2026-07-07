'use client'

// "Сделать картинку поста" — turns a generated post into a feed image:
// the headline laid over the user's OWN photo, or on the project's brand
// background. Format: 4:5 (1080×1350, best IG reach) or 1:1. Single image → download.

import { useState } from 'react'
import { toast } from 'sonner'
import { downscaleImage } from '@/lib/downscaleImage'
import { friendlyError } from '@/lib/friendlyError'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'

interface Brand {
  accentColor?: string; bg?: string; text?: string
  bgStyle?: 'paper' | 'solid' | 'gradient'; handle?: string; logoUrl?: string
  font?: string; accentStyle?: 'gradient' | 'flat'; styleNotes?: string
}

function firstLine(text: string): string {
  const l = text.split('\n').map((s) => s.trim()).find(Boolean) || ''
  return l.replace(/^[#>\-*\s]+/, '').slice(0, 90)
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function PostImage({ text, projectId, brand }: { text: string; projectId?: string; brand?: Brand }) {
  const [open, setOpen] = useState(false)
  const [headline, setHeadline] = useState(() => firstLine(text))
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [fmt, setFmt] = useState<'post45' | 'post' | 'postWide'>('post45')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null)
  const [effBrand, setEffBrand] = useState<Brand | undefined>(brand)
  const [hooking, setHooking] = useState(false)
  const [captionCopied, setCaptionCopied] = useState(false)

  async function openModal() {
    setOpen(true)
    if (!effBrand && projectId) {
      try {
        const r = await fetch(`/api/brand-kit?projectId=${projectId}`)
        const d = await r.json()
        if (r.ok && (d.accentColor || d.bg || d.handle || d.logoUrl || d.font)) setEffBrand({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle, handle: d.handle, logoUrl: d.logoUrl, font: d.font, accentStyle: d.accentStyle, styleNotes: d.styleNotes })
      } catch { /* default theme */ }
    }
    // The default headline is just the first line — for real posts that's the
    // worst hook (owner pasted a post and got its opening words on the cover).
    // Auto-pick a proper hook right away; she can still edit or re-roll it.
    if (headline === firstLine(text) && text.trim().length > 60) void suggestHook()
  }

  async function uploadPhoto(files: FileList | null) {
    if (!files?.[0] || !projectId) return
    setUploading(true)
    try {
      // Downscale on-device: iPhone originals exceed Vercel's ~4.5 MB body cap.
      const small = await downscaleImage(files[0], 2000)
      const fd = new FormData()
      fd.append('projectId', projectId); fd.append('kind', 'post'); fd.append('files', small)
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({} as { urls?: string[]; error?: string }))
      if (!res.ok) throw new Error(d.error || (res.status === 413 ? 'Фото слишком большое' : `Не удалось загрузить (${res.status})`))
      setPhotoUrl((d.urls || [])[0] || null); setImg(null)
    } catch (e) { toast.error(friendlyError(e, 'Не удалось загрузить')) }
    finally { setUploading(false) }
  }

  async function make() {
    if (!headline.trim()) { toast.error('Добавь заголовок'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: fmt, brand: effBrand, slide: { kind: photoUrl ? 'photo' : 'post', headline, photoUrl } }),
      })
      if (!res.ok) throw new Error('Не удалось сделать картинку')
      const blob = await res.blob()
      setImg((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) } })
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setBusy(false) }
  }

  async function suggestHook() {
    setHooking(true)
    try {
      const res = await fetch('/api/post-hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, styleNotes: effBrand?.styleNotes }) })
      const d = await res.json()
      if (!res.ok || !d.hook) throw new Error(d.error || 'Не удалось')
      setHeadline(d.hook); setImg(null)
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setHooking(false) }
  }

  function copyCaption() {
    navigator.clipboard?.writeText(text).then(() => { setCaptionCopied(true); setTimeout(() => setCaptionCopied(false), 1500) }).catch(() => toast.error('Не удалось скопировать'))
  }

  return (
    <>
      <button type="button" onClick={openModal} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
        🖼 Сделать картинку поста
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Картинка поста</p>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/40">Закрыть</button>
            </div>

            <div className="space-y-4 overflow-auto p-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-foreground">Крючок на картинке <span className="text-muted-foreground">(коротко!)</span></label>
                  <button type="button" onClick={suggestHook} disabled={hooking}
                    className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
                    {hooking ? '✨ Подбираю…' : '✨ Подобрать крючок'}
                  </button>
                </div>
                <VoiceTextarea value={headline} onChange={(v) => { setHeadline(v.slice(0, 70)); setImg(null) }} rows={2}
                  placeholder="Крючок на картинке — впиши или надиктуй" />
                <p className="text-[11px] text-muted-foreground">Одна цепляющая фраза, чтобы захотелось дочитать (можно надиктовать). Весь текст поста — в подписи ниже. Слово в **звёздочках** = акцент.</p>
              </div>

              {/* Caption — the full post goes UNDER the photo on Instagram, not on the image */}
              <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">Подпись под постом (весь текст)</p>
                  <button type="button" onClick={copyCaption} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-secondary/60">
                    {captionCopied ? '✓ Скопировано' : 'Скопировать'}
                  </button>
                </div>
                <p className="max-h-28 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{text}</p>
                <p className="text-[11px] text-muted-foreground">Картинку публикуешь как фото, а этот текст — в подпись. Хочешь весь текст на картинках? Сделай <b>карусель</b>.</p>
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
                  {uploading ? 'Загружаю…' : photoUrl ? 'Сменить фото' : '📷 Своё фото'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files)} />
                </label>
                {photoUrl && <button type="button" onClick={() => { setPhotoUrl(null); setImg(null) }} className="text-xs text-muted-foreground hover:text-foreground">убрать (фирменный фон)</button>}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Формат:</span>
                {([['post45', '4:5 (лента)'], ['post', '1:1 (квадрат)'], ['postWide', 'Горизонтальный']] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => { setFmt(v); setImg(null) }}
                    className={`rounded-lg px-3 py-1.5 font-medium ${fmt === v ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
                ))}
              </div>

              <button type="button" onClick={make} disabled={busy} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
                {busy ? 'Делаю картинку…' : 'Сделать картинку'}
              </button>

              {img && (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="превью" className="max-h-[50vh] w-auto rounded-lg border border-border" />
                  <button type="button" onClick={() => download(img.blob, 'post.png')} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">↓ Скачать картинку</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
