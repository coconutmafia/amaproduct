'use client'

// «Создать визуал» — one place to turn content into images (owner request):
//   1. Серия сториз     → the story builder (photos + script → 9:16 frames).
//   2. Картинка к посту → paste post text → hook on image + caption (PostImage).
//   3. Пост-карусель    → paste carousel text → slide images (CarouselSlides).
// The same buttons also appear in the chat under generated answers — this page
// is for when the text is already written (or pasted from elsewhere).

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Images, GalleryHorizontalEnd, ImageIcon, ChevronRight, Palette, Bookmark, X, Clapperboard, Loader2, Download } from 'lucide-react'
import { PostImage } from '@/components/carousel/PostImage'
import { CarouselSlides } from '@/components/carousel/CarouselSlides'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'

interface SavedItem { id: string; title: string | null; body: string; content_type: string | null; created_at: string }

export default function VisualPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [postText, setPostText] = useState('')
  const [carouselText, setCarouselText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saved, setSaved] = useState<SavedItem[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  // «Видео с текстом» — burn brand text onto an uploaded video
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
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить видео') }
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
      const d = await res.json().catch(() => ({} as { url?: string; error?: string }))
      if (!res.ok || !d.url) throw new Error(d.error || 'Не удалось обработать видео')
      setVidUrl(d.url)
      setVidPath(null) // source consumed server-side
      toast.success('Готово — видео с твоим текстом ниже')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось обработать видео') }
    finally { setVidBusy(false) }
  }

  // «Выбрать из Готового» — pick a saved text and route it to the right tool
  async function openPicker() {
    setPickerOpen(true)
    if (saved.length > 0) return
    setSavedLoading(true)
    const { data } = await supabase.from('saved_content')
      .select('id, title, body, content_type, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(30)
    setSaved((data ?? []) as SavedItem[])
    setSavedLoading(false)
  }

  function pickSaved(it: SavedItem) {
    setPickerOpen(false)
    const isStories = it.content_type === 'stories' || /(сторис|stories|кадр)\s*\d/i.test(it.body)
    const isCarousel = it.content_type === 'carousel' || /слайд\s*\d/i.test(it.body)
    if (isStories) {
      try { localStorage.setItem(`ama_stories_script_${projectId}`, it.body) } catch { /* ignore */ }
      router.push(`/projects/${projectId}/stories`)
      return
    }
    if (isCarousel) { setCarouselText(it.body); toast.message('Текст подставлен в «Пост-карусель» ниже') }
    else { setPostText(it.body); toast.message('Текст подставлен в «Картинку к посту» ниже') }
  }

  // Text handed over from «Готовое» («Оформить визуально» on a saved item)
  useEffect(() => {
    if (!projectId) return
    try {
      const key = `ama_visual_prefill_${projectId}`
      const raw = localStorage.getItem(key)
      if (!raw) return
      localStorage.removeItem(key)
      const d = JSON.parse(raw) as { type?: string; text?: string }
      if (!d.text) return
      if (d.type === 'carousel') setCarouselText(d.text)
      else setPostText(d.text)
      toast.message('Текст из «Готового» подставлен — жми кнопку оформления')
    } catch { /* ignore */ }
  }, [projectId])

  return (
    <div className="mx-auto max-w-3xl p-5 pb-28">
      <Link href={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К проекту
      </Link>
      <h1 className="text-xl font-bold text-foreground">Создать визуал</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Преврати контент в картинки в твоём фирменном стиле.{' '}
        <Link href={`/projects/${projectId}/brand`} className="inline-flex items-center gap-1 text-primary underline"><Palette className="h-3.5 w-3.5" /> Настроить стиль</Link>
      </p>

      <button type="button" onClick={openPicker}
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10">
        <Bookmark className="h-4 w-4" /> Выбрать текст из «Готового»
      </button>

      {/* 1. Story series → builder */}
      <Link href={`/projects/${projectId}/stories`} className="mt-5 block rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Images className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Серия сториз</p>
            <p className="text-xs text-muted-foreground">Фото + сценарий → AI раскладывает на кадры 9:16 в твоём стиле сториз.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </Link>

      {/* 2. Post image */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <ImageIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Картинка к посту</p>
            <p className="text-xs text-muted-foreground">Крючок на изображении (своё фото или фирменный фон) + весь текст в подпись.</p>
          </div>
        </div>
        <div className="mt-3">
          <VoiceTextarea value={postText} onChange={setPostText} rows={4}
            placeholder="Вставь ГОТОВЫЙ текст поста (или надиктуй заголовок для картинки) — AI подберёт дословный крючок из текста" />
        </div>
        {postText.trim().length > 30 && <PostImage text={postText.trim()} projectId={projectId} />}
        {postText.trim().length > 0 && postText.trim().length <= 30 && (
          <p className="mt-1 text-[11px] text-muted-foreground">Вставь текст подлиннее — из пары слов крючок не собрать.</p>
        )}
      </section>

      {/* 3. Carousel */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <GalleryHorizontalEnd className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Пост-карусель</p>
            <p className="text-xs text-muted-foreground">Текст карусели → готовые слайды-картинки (обложка, слайды, финал) + ZIP.</p>
          </div>
        </div>
        <div className="mt-3">
          <VoiceTextarea value={carouselText} onChange={setCarouselText} rows={5}
            placeholder={'Вставь ГОТОВЫЙ текст карусели — можно прямо «Слайд 1: … Слайд 2: …» или связный текст; AI разложит ДОСЛОВНО, без переписывания'} />
        </div>
        {carouselText.trim().length > 30 && <CarouselSlides sourceText={carouselText.trim()} type="carousel" projectId={projectId} />}
      </section>

      {/* 4. Video + text overlay */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
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

      <p className="mt-4 text-[11px] text-muted-foreground">
        Подсказка: эти же кнопки появляются в чате «Создать контент» под сгенерированным текстом — там текст писать не нужно.
      </p>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setPickerOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-background shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Из «Готового»</p>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {savedLoading && <p className="py-8 text-center text-sm text-muted-foreground">Загружаю…</p>}
              {!savedLoading && saved.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">В «Готовом» этого проекта пока пусто.</p>}
              {saved.map((it) => (
                <button key={it.id} type="button" onClick={() => pickSaved(it)}
                  className="block w-full rounded-xl border border-border p-3 text-left hover:border-primary/40">
                  <p className="text-sm font-semibold text-foreground line-clamp-1">{it.title || 'Без названия'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{it.body}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
