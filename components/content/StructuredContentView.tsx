'use client'

// Renders AI-generated structured content (reels / carousel / stories) as a
// readable layout instead of a raw JSON dump. Every field is optional —
// AI output varies, so we guard everything.

import { objectToReadableText } from '@/lib/contentToText'
import { CarouselSlides } from '@/components/carousel/CarouselSlides'

type Dict = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const arr = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])

function Field({ label, value }: { label: string; value: unknown }) {
  const s = str(value).trim()
  if (!s) return null
  return (
    <p className="text-[13px] leading-snug">
      <span className="font-semibold text-foreground/70">{label}: </span>
      <span className="text-foreground">{s}</span>
    </p>
  )
}

function Card({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-1">
      <span className="inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-primary/10 text-primary mb-1">
        {tag}
      </span>
      {children}
    </div>
  )
}

export function StructuredContentView({ data }: { data: Dict }) {
  const reels   = data.reels as Dict | undefined
  const carousel = data.carousel as Dict | undefined
  const stories = (data.stories_series ?? data.stories) as Dict | undefined
  const email   = data.email as Dict | undefined
  const live    = data.live as Dict | undefined

  // ── Reels ─────────────────────────────────────────────────────────────────
  if (reels) {
    const scenes = arr(reels.scenes)
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Сценарий рилз</p>
        {str(reels.title)   && <p className="text-sm font-bold text-foreground">{str(reels.title)}</p>}
        {str(reels.hook_text) && <Field label="Хук" value={reels.hook_text} />}
        {str(reels.total_duration) && <p className="text-xs text-muted-foreground">Длительность: {str(reels.total_duration)}</p>}
        {scenes.map((sc, i) => {
          const visual = sc.visual as Dict | undefined
          const audio  = sc.audio as Dict | undefined
          return (
            <Card key={i} tag={`Сцена ${str(sc.scene) || i + 1}${sc.timing ? ` · ${str(sc.timing)}` : ''}${sc.type ? ` · ${str(sc.type)}` : ''}`}>
              {visual && <Field label="Кадр" value={visual.description} />}
              {visual && <Field label="Камера" value={visual.camera} />}
              {visual && <Field label="Действие" value={visual.action} />}
              <Field label="Текст на экране" value={sc.text_overlay} />
              {audio && <Field label="Озвучка" value={audio.speech} />}
              {audio && <Field label="Тон" value={audio.tone} />}
              <Field label="Переход" value={sc.transition} />
            </Card>
          )
        })}
        {str(reels.description_text) && <Field label="Описание под видео" value={reels.description_text} />}
      </div>
    )
  }

  // ── Carousel ──────────────────────────────────────────────────────────────
  if (carousel) {
    const cover  = carousel.cover as Dict | undefined
    const slides = arr(carousel.slides)
    const last   = carousel.last_slide as Dict | undefined
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Карусель{carousel.total_slides ? ` · ${str(carousel.total_slides)} слайдов` : ''}</p>
        {cover && (
          <Card tag="Обложка">
            <Field label="Заголовок" value={cover.headline} />
            <Field label="Подзаголовок" value={cover.subheadline} />
            <Field label="Визуал" value={cover.visual_description} />
          </Card>
        )}
        {slides.map((sl, i) => (
          <Card key={i} tag={`Слайд ${str(sl.slide) || i + 2}${sl.type ? ` · ${str(sl.type)}` : ''}`}>
            <Field label="Заголовок" value={sl.headline} />
            <Field label="Текст" value={sl.body} />
            {str(sl.emoji) && <p className="text-base">{str(sl.emoji)}</p>}
          </Card>
        ))}
        {last && (
          <Card tag="Финальный слайд">
            <Field label="Текст" value={last.text} />
            <Field label="Призыв" value={last.action} />
          </Card>
        )}
        <CarouselSlides carousel={carousel} />
      </div>
    )
  }

  // ── Stories ───────────────────────────────────────────────────────────────
  if (stories) {
    const list = arr(stories.stories)
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Серия сторис</p>
        {str(stories.goal) && <Field label="Цель серии" value={stories.goal} />}
        {list.map((st, i) => {
          const visual = st.visual as Dict | undefined
          const text   = st.text as Dict | undefined
          const inter  = st.interactive as Dict | undefined
          return (
            <Card key={i} tag={`Сторис ${str(st.story_number) || i + 1}${st.type ? ` · ${str(st.type)}` : ''}`}>
              {text && <Field label="Заголовок" value={text.headline} />}
              {text && <Field label="Подпись" value={text.subtext} />}
              {visual && <Field label="Фон" value={visual.background} />}
              {visual && <Field label="В кадре" value={visual.main_element} />}
              <Field label="Голос" value={st.voiceover} />
              {inter && str(inter.type) && (
                <Field
                  label="Интерактив"
                  value={`${str(inter.type)}${inter.question ? ` — ${str(inter.question)}` : ''}${Array.isArray(inter.options) ? ` (${(inter.options as string[]).join(' / ')})` : ''}`}
                />
              )}
              <Field label="Переход" value={st.transition} />
            </Card>
          )
        })}
      </div>
    )
  }

  // ── Email ───────────────────────────────────────────────────────────────
  if (email) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Письмо для рассылки</p>
        <Field label="Тема" value={email.subject} />
        <Field label="Прехедер" value={email.preheader} />
        {str(email.body) && <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground mt-1">{str(email.body)}</p>}
        <Field label="Кнопка" value={email.cta_text} />
        <Field label="P.S." value={email.ps} />
      </div>
    )
  }

  // ── Live (эфир) ─────────────────────────────────────────────────────────
  if (live) {
    const structure = arr(live.structure)
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Сценарий эфира{str(live.duration_min) ? ` · ${str(live.duration_min)} мин` : ''}</p>
        {str(live.title) && <p className="text-sm font-bold text-foreground">{str(live.title)}</p>}
        {str(live.goal) && <Field label="Цель" value={live.goal} />}
        {structure.map((b, i) => (
          <Card key={i} tag={`${str(b.block) || `Блок ${i + 1}`}${str(b.duration_min) ? ` · ${str(b.duration_min)} мин` : ''}`}>
            <Field label="Содержание" value={b.content} />
            <Field label="Интерактив" value={b.interactive} />
          </Card>
        ))}
        {str(live.promo_text) && <Field label="Промо" value={live.promo_text} />}
      </div>
    )
  }

  // Unknown shape — render readable labeled text, NEVER a raw JSON dump.
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">{objectToReadableText(data)}</p>
    </div>
  )
}
