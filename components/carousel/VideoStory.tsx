'use client'

// «Видео с текстом (сторис)» — upload a clip, burn brand-styled text over it via
// our slide engine + ffmpeg, download the 9:16 result. Extracted so it lives both
// on «Создать визуал» AND inside «Оформление сторис» (owner looked for video where
// she designs stories, not on a separate page).

import { useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/friendlyError'
import { Clapperboard, Loader2, Download } from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'
import { showUpgrade } from '@/components/billing/UpgradeDialog'

export function VideoStory({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const [vidPath, setVidPath] = useState<string | null>(null)
  const [vidName, setVidName] = useState('')
  const [vidUploading, setVidUploading] = useState(false)
  const [vidText, setVidText] = useState('')
  const [vidPos, setVidPos] = useState<'top' | 'center' | 'bottom'>('bottom')
  const [vidPlate, setVidPlate] = useState(true)
  const [vidBusy, setVidBusy] = useState(false)
  const [vidUrl, setVidUrl] = useState<string | null>(null)

  async function uploadVideo(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    if (f.size > 50 * 1024 * 1024) { toast.error('Видео до 50 МБ (примерно до минуты) — обрежь или сожми'); return }
    setVidUploading(true); setVidUrl(null)
    try {
      const ext = (f.name.split('.').pop() || 'mp4').toLowerCase()
      const res = await fetch('/api/video/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ext }),
      })
      const d = await res.json().catch(() => ({} as { path?: string; token?: string; error?: string }))
      if (!res.ok || !d.path || !d.token) throw new Error(d.error || 'Не удалось подготовить загрузку')
      const { error } = await supabase.storage.from('project-brand').uploadToSignedUrl(d.path, d.token, f)
      if (error) throw new Error('Сеть оборвалась при загрузке видео — попробуй ещё раз')
      setVidPath(d.path); setVidName(f.name)
      toast.success('Видео загружено — впиши текст и жми «Наложить текст»')
    } catch (e) { toast.error(friendlyError(e, 'Не удалось загрузить видео')) }
    finally { setVidUploading(false) }
  }

  async function burnText() {
    if (!vidPath || !vidText.trim() || vidBusy) return
    setVidBusy(true); setVidUrl(null)
    try {
      const res = await fetch('/api/video/overlay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, videoPath: vidPath, text: vidText, position: vidPos, plate: vidPlate }),
      })
      if (res.status === 402) {
        // Причина важна: неоплатившему нельзя показывать «лимит исчерпан» (у него 0 создано).
        const d = await res.clone().json().catch(() => ({} as { code?: string }))
        showUpgrade(d.code === 'payment_required' ? 'needs_plan' : 'limit')
        return
      }
      const d = await res.json().catch(() => ({} as { url?: string; error?: string }))
      if (!res.ok || !d.url) throw new Error(d.error || 'Не удалось обработать видео')
      setVidUrl(d.url)
      setVidPath(null) // source consumed server-side
      toast.success('Готово — видео с твоим текстом ниже')
    } catch (e) { toast.error(friendlyError(e, 'Не удалось обработать видео')) }
    finally { setVidBusy(false) }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Clapperboard className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Видео с текстом (сторис)</p>
          <p className="text-xs text-muted-foreground">Загрузи видео — текст ляжет поверх в твоём фирменном стиле, скачаешь готовый ролик 9:16.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:border-primary/40">
          {vidUploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю видео…</> : vidPath ? '🎬 Сменить видео' : '🎬 Загрузить видео'}
          <input type="file" accept="video/*" className="hidden" disabled={vidUploading} onChange={(e) => uploadVideo(e.target.files)} />
        </label>
        {vidPath && <span className="max-w-[180px] truncate text-[11px] text-muted-foreground">{vidName}</span>}
      </div>
      {vidUploading && <p className="mt-1 text-[11px] text-muted-foreground">Обычно 10-40 секунд, зависит от размера видео.</p>}

      {vidPath && (
        <>
          <div className="mt-3">
            <VoiceTextarea value={vidText} onChange={setVidText} rows={2}
              placeholder="Текст на видео — впиши или надиктуй. Слово в **звёздочках** = акцент" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Текст:</span>
            {([['top', 'сверху'], ['center', 'по центру'], ['bottom', 'снизу']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setVidPos(v)}
                className={`rounded-lg px-3 py-1.5 font-medium ${vidPos === v ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
            ))}
            <button type="button" onClick={() => setVidPlate(!vidPlate)}
              className={`rounded-lg px-3 py-1.5 font-medium ${vidPlate ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`}>
              {vidPlate ? 'на плашках' : 'без плашек'}
            </button>
          </div>
          <button type="button" onClick={burnText} disabled={vidBusy || !vidText.trim()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
            {vidBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {vidBusy ? 'Накладываю текст…' : 'Наложить текст'}
          </button>
          {vidBusy && <p className="mt-1 text-[11px] text-muted-foreground">Обычно 1-3 минуты: обрабатываю видео и вшиваю текст. Не закрывай страницу.</p>}
        </>
      )}

      {vidUrl && (
        <div className="mt-3 space-y-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={vidUrl} controls playsInline className="mx-auto max-h-96 rounded-xl border border-border" />
          <a href={vidUrl} download="story-video.mp4" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
            <Download className="h-3.5 w-3.5" /> Скачать видео
          </a>
        </div>
      )}
    </section>
  )
}
