'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ProgressIndicatorProps {
  score: number
  showLabel?: boolean
  className?: string
  loadedTypes?: string[]
  animated?: boolean
}

export function ProgressIndicator({ score, showLabel = true, className, loadedTypes, animated = false }: ProgressIndicatorProps) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const color = score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-500'
  const barColor = score >= 80
    ? 'from-emerald-400 to-green-500'
    : score >= 50
    ? 'from-amber-400 to-yellow-500'
    : 'from-rose-400 to-red-500'

  const getMissingMessage = (score: number) => {
    if (score >= 90) return 'База знаний отличная!'
    const loaded = new Set(loadedTypes ?? [])
    if (score >= 70) {
      if (!loaded.has('tone_of_voice')) return 'Загрузите Tone of Voice для персонального контента'
      return 'Загрузите Tone of Voice или маркетинговую стратегию'
    }
    if (score >= 50) {
      const missing: string[] = []
      if (!loaded.has('marketing_strategy')) missing.push('маркетинговую стратегию')
      if (!loaded.has('audience_research') && !loaded.has('audience_survey') && !loaded.has('interview_transcript')) {
        missing.push('исследование аудитории')
      }
      if (missing.length === 0) return 'Загрузите Tone of Voice для улучшения результатов'
      return `Добавьте ${missing.join(' и ')}`
    }
    if (score >= 25) {
      const missing: string[] = []
      if (!loaded.has('cases_reviews')) missing.push('кейсы')
      if (!loaded.has('product_description')) missing.push('описание продукта')
      if (missing.length === 0) return 'Добавьте маркетинговую стратегию'
      return `Добавьте ${missing.join(' и ')}`
    }
    return 'Загрузите материалы для начала работы с AI'
  }

  return (
    <div ref={ref} className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Полнота базы</span>
        <motion.span
          className={cn('font-bold', color)}
          initial={animated ? { opacity: 0 } : false}
          animate={animated && inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.5 }}
        >
          {score}%
        </motion.span>
      </div>

      {/* Animated gradient progress bar */}
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r', barColor)}
          initial={{ width: 0 }}
          animate={(animated ? inView : true) ? { width: `${score}%` } : { width: 0 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: animated ? 0.2 : 0 }}
        />
      </div>

      {showLabel && (
        <p className="text-xs text-muted-foreground">{getMissingMessage(score)}</p>
      )}
    </div>
  )
}
