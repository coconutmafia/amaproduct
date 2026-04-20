'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import {
  Bot, Upload, Zap, BarChart3, ChevronRight,
  Users, Sparkles, Target, Gift, X,
} from 'lucide-react'

const SLIDES = [
  {
    icon: Bot,
    gradient: 'from-violet-500 to-purple-600',
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
    gradient: 'from-blue-500 to-cyan-500',
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
    gradient: 'from-amber-500 to-orange-500',
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
    icon: BarChart3,
    gradient: 'from-green-500 to-emerald-500',
    title: 'Анализируй и улучшай',
    subtitle: 'AI анализирует твой аккаунт и даёт конкретные рекомендации',
    points: [
      'Анализ Instagram-аккаунта и конкурентов',
      'Рекомендации по контент-стратегии',
      'Style Bank: сохраняй лучшие форматы',
    ],
    tip: '📊 Попробуй «Анализ аккаунта» в меню своего проекта',
  },
  {
    icon: Gift,
    gradient: 'from-pink-500 to-rose-500',
    title: 'Приглашай — получай бонусные запросы',
    subtitle: 'Поделись сервисом с коллегами и получай бонусы',
    points: [
      'Твой реферал регистрируется → +10 бонусных запросов тебе',
      'Твой реферал оплачивает → +25 запросов тебе',
      '2-й уровень: если твой реферал кого-то пригласил — ты тоже получаешь',
    ],
    tip: '🔗 Твоя реферальная ссылка в разделе «Твои бонусы»',
  },
]

interface Props {
  userId: string
  onComplete: () => void
}

export function OnboardingSlides({ userId, onComplete }: Props) {
  const [slide, setSlide]     = useState(0)
  const [closing, setClosing] = useState(false)
  const supabase = createClient()
  const current = SLIDES[slide]
  const isLast  = slide === SLIDES.length - 1

  const finish = async () => {
    setClosing(true)
    await supabase.from('profiles').update({ onboarding_done: true }).eq('id', userId)
    onComplete()
  }

  const skip = async () => {
    await supabase.from('profiles').update({ onboarding_done: true }).eq('id', userId)
    onComplete()
  }

  const Icon = current.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`relative w-full max-w-lg bg-card rounded-3xl shadow-2xl overflow-hidden transition-all duration-300 ${closing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}>

        {/* Gradient header */}
        <div className={`bg-gradient-to-br ${current.gradient} p-8 text-white relative overflow-hidden`}>
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
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${current.gradient} mt-0.5`}>
                  <span className="text-white text-[10px] font-bold">{i + 1}</span>
                </div>
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl bg-secondary/50 border border-border p-3 text-xs text-muted-foreground">
            {current.tip}
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSlide(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === slide ? `w-6 bg-gradient-to-r ${current.gradient}` : 'w-2 bg-border'
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
                  className={`bg-gradient-to-r ${current.gradient} text-white hover:opacity-90 border-0`}
                  onClick={finish}
                >
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Начать работу!
                </Button>
              ) : (
                <Button
                  size="sm"
                  className={`bg-gradient-to-r ${current.gradient} text-white hover:opacity-90 border-0`}
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
