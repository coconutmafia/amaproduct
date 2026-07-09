'use client'

// Unified content studio (Матвей: один редактор для всех форматов). Single
// consistent base flow — pick format → text → photo → options → generate →
// preview → download — with per-format differences layered on top. Phase 1:
// shell + tabs + the POST format end-to-end. Carousel/Stories are wired to
// their current editors until Phases 2–3 port them in (see UNIFY_EDITOR.md).

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Download, Sparkles, Image as ImageIcon } from 'lucide-react'
import { downscaleImage } from '@/lib/downscaleImage'
import { friendlyError } from '@/lib/friendlyError'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'

type Format = 'post' | 'carousel' | 'stories'
interface Brand { accentColor?: string; bg?: string; text?: string; bgStyle?: string; handle?: string; logoUrl?: string; font?: string; accentStyle?: 'gradient' | 'flat'; styleNotes?: string }

const FORMATS: { id: Format; label: string }[] = [
  { id: 'post', label: 'Пост' },
  { id: 'carousel', label: 'Карусель' },
  { id: 'stories', label: 'Сторис' },
]

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

export function ContentStudio({ projectId, initialFormat = 'post', initialText = '' }: {
  projectId: string
  initialFormat?: Format
  initialText?: string
}) {
  const [format, setFormat] = useState<Format>(initialFormat)
  const [brand, setBrand] = useState<Brand | undefined>()

  useEffect(() => {
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error && (d.accentColor || d.bg || d.handle || d.logoUrl || d.font)) {
        setBrand({ accentColor: d.accentColor, bg: d.bg, text: d.text, bgStyle: d.bgStyle, handle: d.handle, logoUrl: d.logoUrl, font: d.font, accentStyle: d.accentStyle, styleNotes: d.styleNotes })
      }
    }).catch(() => {})
  }, [projectId])

  return (
    <div className="mx-auto max-w-2xl p-5 pb-24">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Создать контент</h1>
      <p className="mt-1 text-sm text-muted-foreground">Выбери формат, напиши текст, добавь фото — соберём в твоём стиле.</p>

      {/* Format tabs — the one consistent entry point for all formats */}
      <div className="mt-4 inline-flex rounded-xl border border-border bg-card p-1">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFormat(f.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${format === f.id ? 'gradient-accent text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {format === 'post' && <PostPanel projectId={projectId} brand={brand} initialText={initialText} />}
        {format === 'carousel' && (
          <ComingSoon format="Карусель"
            note="Карусель пока собирается в чате-ассистенте (кнопка под сгенерированным текстом) и в разделе «Создать визуал». Перенос в этот единый редактор — Фаза 2." />
        )}
        {format === 'stories' && (
          <ComingSoon format="Сторис" href={`/projects/${projectId}/stories`}
            note="Сторис пока на отдельной странице «Оформление сторис». Перенос в этот единый редактор — Фаза 3." />
        )}
      </div>
    </div>
  )
}

function ComingSoon({ format, note, href }: { format: string; note: string; href?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-5 text-center space-y-3">
      <p className="text-sm font-semibold text-foreground">{format} — переносим в единый редактор</p>
      <p className="text-sm text-muted-foreground leading-relaxed">{note}</p>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Открыть текущий редактор {format.toLowerCase()} →
        </Link>
      )}
    </div>
  )
}

// ── Post format panel ──────────────────────────────────────────────────────────
function PostPanel({ projectId, brand, initialText }: { projectId: string; brand?: Brand; initialText: string }) {
  const [text, setText] = useState(initialText)
  const [headline, setHeadline] = useState(() => firstLine(initialText))
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [fmt, setFmt] = useState<'post45' | 'post' | 'postWide'>('post45')
  const [uploading, setUploading] = useState(false)
  const [hooking, setHooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null)

  async function suggestHook() {
    if (!text.trim()) { toast.error('Сначала напиши текст поста'); return }
    setHooking(true)
    try {
      const res = await fetch('/api/post-hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, styleNotes: brand?.styleNotes }) })
      const d = await res.json()
      if (!res.ok || !d.hook) throw new Error(d.error || 'Не удалось')
      setHeadline(d.hook); setImg(null)
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setHooking(false) }
  }

  async function uploadPhoto(files: FileList | null) {
    if (!files?.[0]) return
    setUploading(true)
    try {
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
    if (!headline.trim()) { toast.error('Добавь крючок на картинку'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: fmt, brand, slide: { kind: photoUrl ? 'photo' : 'post', headline, photoUrl } }),
      })
      if (!res.ok) throw new Error('Не удалось сделать картинку')
      const blob = await res.blob()
      setImg((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) } })
    } catch (e) { toast.error(friendlyError(e, 'Ошибка')) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {/* 1. Text */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">1. Текст поста</label>
        <VoiceTextarea value={text} onChange={(v) => setText(v)} rows={4}
          placeholder="Напиши или надиктуй текст поста — он пойдёт в подпись, а крючок ляжет на картинку." />
      </div>

      {/* 2. Hook (headline on the image) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-foreground">2. Крючок на картинке <span className="text-muted-foreground">(коротко!)</span></label>
          <button type="button" onClick={suggestHook} disabled={hooking}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
            {hooking ? '✨ Подбираю…' : '✨ Подобрать крючок'}
          </button>
        </div>
        <VoiceTextarea value={headline} onChange={(v) => { setHeadline(v.slice(0, 70)); setImg(null) }} rows={2}
          placeholder="Одна цепляющая фраза. Слово в **звёздочках** = акцент." />
      </div>

      {/* 3. Photo */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">3. Фон</label>
        <div className="flex items-center gap-3">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
            {uploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…</> : <><ImageIcon className="h-3.5 w-3.5" /> {photoUrl ? 'Сменить фото' : 'Своё фото'}</>}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files)} />
          </label>
          {photoUrl && <button type="button" onClick={() => { setPhotoUrl(null); setImg(null) }} className="text-xs text-muted-foreground hover:text-foreground">убрать (фирменный фон)</button>}
        </div>
      </div>

      {/* 4. Format */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Формат:</span>
        {([['post45', '4:5 (лента)'], ['post', '1:1 (квадрат)'], ['postWide', 'Горизонтальный']] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => { setFmt(v); setImg(null) }}
            className={`rounded-lg px-3 py-1.5 font-medium ${fmt === v ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      <button type="button" onClick={make} disabled={busy}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Делаю картинку…</> : <><Sparkles className="h-4 w-4" /> Сделать картинку</>}
      </button>

      {img && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="превью" className="max-h-[60vh] w-auto rounded-lg border border-border" />
          <button type="button" onClick={() => download(img.blob, 'post.png')} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
            <Download className="h-3.5 w-3.5" /> Скачать картинку
          </button>
        </div>
      )}
    </div>
  )
}
