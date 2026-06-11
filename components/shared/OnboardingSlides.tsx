'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import {
  Bot, Upload, Zap, BarChart3, ChevronRight,
  Users, Sparkles, Target, X, Palette,
} from 'lucide-react'

// All slides share the app's brand gradient (matches .gradient-accent) — the
// owner asked the onboarding to stop being rainbow-coloured per slide.
const BRAND_GRADIENT = 'from-[#F5A84A] via-[#E86BA0] to-[#D44E7E]'

const SLIDES = [
  {
    icon: Bot,
    title: 'Знакомься — это твой AI SMM-щик!',
    subtitle: 'Он знает всё о твоём блоге и пишет контент, который звучит как ты',
    points: [
      'Можешь дать ему имя — стань ближе к своему AI',
      'Он обучается на твоих материалах и стиле',
      'Работает 24/7 и никогда не выгорает',
    ],
    tip: '💡 Дай своему AI имя в настройках проекта — это делает работу теплее',
  },
  {
    icon: Upload,
    title: 'Загрузи свои материалы',
    subtitle: 'Чем больше знает AI — тем точнее пишет под тебя',
    points: [
      'Распаковка личности, карта смыслов, TOV',
      'Исследования аудитории, отзывы, кейсы',
      'Описание продуктов, воронки, стратегии',
    ],
    tip: '📁 Поддерживаются .txt, .docx, .xlsx, .csv — загружай сразу несколько файлов',
  },
  {
    icon: Zap,
    title: 'Генерируй контент за секунды',
    subtitle: 'Полный контент-план прогрева — от знакомства до продажи',
    points: [
      'Посты, карусели, сторис, рилсы, эфиры',
      'AI сам выстраивает прогрев по фазам',
      'Учитывает продукт, ЦА и дату запуска',
    ],
    tip: '🚀 Начни с кнопки «Сгенерировать контент-план» в своём проекте',
  },
  {
    icon: Palette,
    title: 'Контент не только текстом — картинками в ТВОЁМ стиле',
    subtitle: 'Карусели, посты и сторис как готовые изображения, оформленные под твой бренд',
    points: [
      'Загрузи примеры своего оформления — AI распознает твой стиль (цвета, шрифт, настроение)',
      'Карусель или пост → готовые слайды-картинки одной кнопкой',
      'Сторис по фото: загрузи фото + сценарий → раскладка в твоём фирменном стиле',
    ],
    tip: '🎨 Настрой «Фирменный стиль» в проекте — и весь визуал будет твой',
  },
  {
    icon: BarChart3,
    title: 'Анализируй и улучшай',
    subtitle: 'AI анализирует твой аккаунт и даёт конкретные рекомендации',
    points: [
      'Анализ Instagram-аккаунта и конкурентов',
      'Рекомендации по контент-стратегии',
      'Готовое: AI учится на твоём лучшем контенте',
    ],
    tip: '📊 Попробуй «Анализ аккаунта» в меню своего проекта',
  },
]

interface Props {
  userId: string
  onComplete: () => void
}

export function OnboardingSlides({ userId, onComplete }: Props) {
  const [slide, setSlide]     = useState(0)
  const [closing, setClosing] = useState(false)
  // Onboarding now shows on every entry (people forget) — the checkbox lets the
  // user opt out permanently. We only persist onboarding_done when they opt out.
  const [dontShow, setDontShow] = useState(false)
  const supabase = createClient()
  const current = SLIDES[slide]
  const isLast  = slide === SLIDES.length - 1

  // Ticking "больше не показывать" persists IMMEDIATELY (real opt-out — it will
  // genuinely never show again, however the modal is closed). Closing without
  // ticking just hides it for this session; it returns on the next entry.
  const toggleDontShow = async (checked: boolean) => {
    setDontShow(checked)
    try { await supabase.from('profiles').update({ onboarding_done: checked }).eq('id', userId) } catch { /* ignore */ }
  }

  const finish = () => { setClosing(true); onComplete() }
  const skip = () => { onComplete() }

  const Icon = current.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`relative w-full max-w-lg bg-card rounded-3xl shadow-2xl overflow-hidden transition-all duration-300 ${closing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}>

        {/* Gradient header */}
        <div className={`bg-gradient-to-br ${BRAND_GRADIENT} p-8 text-white relative overflow-hidden`}>
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }} />

          {/* Skip button */}
          <button
            onClick={skip}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="relative space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <Icon className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold leading-tight">{current.title}</h2>
              <p className="text-white/80 text-sm mt-1">{current.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <ul className="space-y-3">
            {current.points.map((point, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${BRAND_GRADIENT} mt-0.5`}>
                  <span className="text-white text-[10px] font-bold">{i + 1}</span>
                </div>
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl bg-secondary/50 border border-border p-3 text-xs text-muted-foreground">
            {current.tip}
          </div>

          {/* Opt-out: shown every entry, this stops it permanently */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={dontShow} onChange={(e) => toggleDontShow(e.target.checked)} className="h-4 w-4 rounded border-border accent-primary" />
            Больше не показывать
          </label>

          {/* Progress dots */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSlide(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === slide ? `w-6 bg-gradient-to-r ${BRAND_GRADIENT}` : 'w-2 bg-border'
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {slide > 0 && (
                <Button variant="outline" size="sm" onClick={() => setSlide(s => s - 1)}>
                  Назад
                </Button>
              )}
              {isLast ? (
                <Button
                  size="sm"
                  className={`bg-gradient-to-r ${BRAND_GRADIENT} text-white hover:opacity-90 border-0`}
                  onClick={finish}
                >
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Начать работу!
                </Button>
              ) : (
                <Button
                  size="sm"
                  className={`bg-gradient-to-r ${BRAND_GRADIENT} text-white hover:opacity-90 border-0`}
                  onClick={() => setSlide(s => s + 1)}
                >
                  Далее <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
