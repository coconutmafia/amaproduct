'use client'

// "Сделать картинку поста" — turns a generated post into a feed image:
// the headline laid over the user's OWN photo, or on the project's brand
// background. Format: 4:5 (1080×1350, best IG reach) or 1:1. Single image → download.

import { useState } from 'react'
import { toast } from 'sonner'

interface Brand {
  accentColor?: string; bg?: string; text?: string
  bgStyle?: 'paper' | 'solid' | 'gradient'; handle?: string; logoUrl?: string
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
  const [fmt, setFmt] = useState<'post45' | 'post'>('post45')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null)
  const [effBrand, setEffBrand] = useState<Brand | undefined>(brand)

  async function openModal() {
    setOpen(true)
    if (!effBrand && projectId) {
      try {
        const r = await fetch(`/api/brand-kit?projectId=${projectId}`)
        const d = await r.json()
        if (r.ok && (d.accentColor || d.bg || d.handle || d.logoUrl)) setEffBrand({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle, handle: d.handle, logoUrl: d.logoUrl })
      } catch { /* default theme */ }
    }
  }

  async function uploadPhoto(files: FileList | null) {
    if (!files?.[0] || !projectId) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId); fd.append('kind', 'post'); fd.append('files', files[0])
      const res = await fetch('/api/brand-kit/upload', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка загрузки')
      setPhotoUrl(d.urls[0]); setImg(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить') }
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
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ошибка') }
    finally { setBusy(false) }
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
              <label className="block text-xs font-medium text-foreground">
                Заголовок на картинке
                <textarea value={headline} onChange={(e) => setHeadline(e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg border border-border bg-background p-2 text-sm" />
                <span className="text-[11px] text-muted-foreground">Выдели слово **звёздочками** — будет акцентом.</span>
              </label>

              <div className="flex items-center gap-3">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
                  {uploading ? 'Загружаю…' : photoUrl ? 'Сменить фото' : '📷 Своё фото'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files)} />
                </label>
                {photoUrl && <button type="button" onClick={() => { setPhotoUrl(null); setImg(null) }} className="text-xs text-muted-foreground hover:text-foreground">убрать (фирменный фон)</button>}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Формат:</span>
                {([['post45', '4:5 (лента)'], ['post', '1:1 (квадрат)']] as const).map(([v, label]) => (
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
