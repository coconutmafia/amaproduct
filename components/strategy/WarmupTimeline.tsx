'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'
import type { WarmupPlanData, ContentType, WarmupPhase } from '@/types'

interface WarmupTimelineProps {
  planData: WarmupPlanData
  projectId: string
  warmupPlanId: string
  onGenerateContent?: (day: number, contentType: ContentType, phase: WarmupPhase) => void
}

const CONTENT_TYPE_ICONS: Record<string, { label: string; color: string }> = {
  post: { label: 'П', color: 'bg-blue-500/20 text-blue-400' },
  stories: { label: 'С', color: 'bg-pink-500/20 text-pink-400' },
  reels: { label: 'R', color: 'bg-orange-500/20 text-orange-400' },
  carousel: { label: 'К', color: 'bg-purple-500/20 text-purple-400' },
  live: { label: 'Э', color: 'bg-red-500/20 text-red-400' },
  webinar: { label: 'В', color: 'bg-green-500/20 text-green-400' },
}

const PHASE_COLORS: Record<string, string> = {
  awareness: 'phase-bg-awareness phase-awareness',
  trust: 'phase-bg-trust phase-trust',
  desire: 'phase-bg-desire phase-desire',
  close: 'phase-bg-close phase-close',
}

const PHASE_LABELS: Record<string, string> = {
  awareness: 'Осознание',
  trust: 'Доверие',
  desire: 'Желание',
  close: 'Закрытие',
}

export function WarmupTimeline({ planData, projectId, warmupPlanId, onGenerateContent }: WarmupTimelineProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const phases = planData.warmup_plan.phases

  const selectedDayData = phases
    .flatMap((p) => p.daily_plan.map((d) => ({ ...d, phase: p.phase as WarmupPhase })))
    .find((d) => d.day === selectedDay)

  return (
    <div className="space-y-6">
      {/* Phase columns */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${phases.length}, 1fr)` }}>
        {phases.map((phase) => (
          <div key={phase.phase} className="space-y-2">
            <div className={`p-2 rounded-lg border text-center text-xs font-semibold ${PHASE_COLORS[phase.phase]}`}>
              {PHASE_LABELS[phase.phase]}
              <span className="block text-[10px] opacity-70">Дни {phase.days}</span>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {phase.daily_plan.slice(0, 14).map((day) => (
                <button
                  key={day.day}
                  onClick={() => setSelectedDay(selectedDay === day.day ? null : day.day)}
                  className={`relative flex flex-col items-center gap-0.5 p-1 rounded-md transition-all ${
                    selectedDay === day.day
                      ? 'bg-primary text-white scale-110 shadow-lg shadow-primary/25'
                      : 'hover:bg-secondary'
                  }`}
                >
                  <span className="text-[9px] font-bold">{day.day}</span>
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {day.format.slice(0, 2).map((fmt) => {
                      const info = CONTENT_TYPE_ICONS[fmt]
                      return info ? (
                        <span
                          key={fmt}
                          className={`text-[7px] font-bold rounded px-0.5 ${selectedDay === day.day ? 'bg-white/20 text-white' : info.color}`}
                        >
                          {info.label}
                        </span>
                      ) : null
                    })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.entries(CONTENT_TYPE_ICONS).map(([key, { label, color }]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`inline-block px-1.5 py-0.5 rounded font-bold ${color}`}>{label}</span>
            ={key === 'post' ? 'Пост' : key === 'stories' ? 'Сториз' : key === 'reels' ? 'Рилс' : key === 'carousel' ? 'Карусель' : key === 'live' ? 'Эфир' : 'Вебинар'}
          </span>
        ))}
        <span className="text-[10px]">Кликайте на день для просмотра и генерации</span>
      </div>

      {/* Selected day details */}
      {selectedDayData && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">День {selectedDayData.day}: {selectedDayData.theme}</h3>
                <p className="text-xs text-muted-foreground">{PHASE_LABELS[selectedDayData.phase]} · {selectedDayData.visual_mood}</p>
              </div>
              <Badge className={`text-xs ${PHASE_COLORS[selectedDayData.phase]}`}>
                {PHASE_LABELS[selectedDayData.phase]}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Ключевое сообщение</p>
                <p className="text-foreground">{selectedDayData.key_message}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">CTA</p>
                <p className="text-foreground">{selectedDayData.cta}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Смысловой крючок</p>
                <p className="text-foreground">{selectedDayData.warmup_hook}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedDayData.format.map((fmt) => (
                <Button
                  key={fmt}
                  size="sm"
                  onClick={() => onGenerateContent?.(selectedDayData.day, fmt as ContentType, selectedDayData.phase)}
                  className="h-7 text-xs gradient-accent text-white hover:opacity-90"
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  Сгенерировать {fmt}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
