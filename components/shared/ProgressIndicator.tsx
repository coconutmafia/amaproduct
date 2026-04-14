'use client'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface ProgressIndicatorProps {
  score: number
  showLabel?: boolean
  className?: string
}

export function ProgressIndicator({ score, showLabel = true, className }: ProgressIndicatorProps) {
  const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'

  const getMissingMessage = (score: number) => {
    if (score >= 90) return 'База знаний отлична!'
    if (score >= 70) return 'Загрузите Tone of Voice для персонального контента'
    if (score >= 50) return 'Добавьте кейсы и маркетинговую стратегию'
    return 'Загрузите материалы для начала генерации контента'
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
