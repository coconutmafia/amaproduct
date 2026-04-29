'use client'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface ProgressIndicatorProps {
  score: number
  showLabel?: boolean
  className?: string
  loadedTypes?: string[] // actual material types already uploaded
}

export function ProgressIndicator({ score, showLabel = true, className, loadedTypes }: ProgressIndicatorProps) {
  const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'

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
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Полнота базы</span>
        <span className={cn('font-bold', color)}>{score}%</span>
      </div>
      <div className="relative">
        <Progress value={score} className="h-2" />
      </div>
      {showLabel && (
        <p className="text-xs text-muted-foreground">{getMissingMessage(score)}</p>
      )}
    </div>
  )
}
