'use client'

// «Создать визуал» — one place to turn content into images (owner request):
//   1. Серия сториз     → the story builder (photos + script → 9:16 frames).
//   2. Картинка к посту → paste post text → hook on image + caption (PostImage).
//   3. Пост-карусель    → paste carousel text → slide images (CarouselSlides).
// The same buttons also appear in the chat under generated answers — this page
// is for when the text is already written (or pasted from elsewhere).

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Images, GalleryHorizontalEnd, ImageIcon, ChevronRight, Palette } from 'lucide-react'
import { PostImage } from '@/components/carousel/PostImage'
import { CarouselSlides } from '@/components/carousel/CarouselSlides'

export default function VisualPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [postText, setPostText] = useState('')
  const [carouselText, setCarouselText] = useState('')

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
        <textarea value={postText} onChange={(e) => setPostText(e.target.value)} rows={4}
          placeholder="Вставь текст поста — AI подберёт цепляющий крючок для картинки"
          className="mt-3 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm" />
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
        <textarea value={carouselText} onChange={(e) => setCarouselText(e.target.value)} rows={5}
          placeholder={'Вставь текст карусели — можно прямо «Слайд 1: … Слайд 2: …» или просто связный текст, AI разложит на слайды'}
          className="mt-3 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm" />
        {carouselText.trim().length > 30 && <CarouselSlides sourceText={carouselText.trim()} type="carousel" projectId={projectId} />}
      </section>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Подсказка: эти же кнопки появляются в чате «Создать контент» под сгенерированным текстом — там текст писать не нужно.
      </p>
    </div>
  )
}
