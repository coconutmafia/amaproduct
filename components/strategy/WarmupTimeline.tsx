'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { WarmupPlanData, ContentType, WarmupPhase } from '@/types'

interface WarmupTimelineProps {
  planData: WarmupPlanData
  projectId: string
  warmupPlanId: string
  onGenerateContent?: (day: number, contentType: ContentType, phase: WarmupPhase) => void
}

const PHASE_COLORS: Record<string, string> = {
  // new names
  niche: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  expert: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  product: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  objections: 'bg-green-500/10 text-green-400 border-green-500/20',
  // legacy names
  activation: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  awareness: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  trust: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  desire: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  close: 'bg-green-500/10 text-green-400 border-green-500/20',
}

const PHASE_LABELS: Record<string, string> = {
  niche: 'Прогрев на нишу',
  expert: 'Прогрев на эксперта',
  product: 'Прогрев на продукт',
  objections: 'Отработка возражений',
  activation: 'Активация',
  awareness: 'Знакомство',
  trust: 'Доверие',
  desire: 'Желание',
  close: 'Закрытие',
}

export function WarmupTimeline({ planData, projectId }: WarmupTimelineProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  // Защита от старых/неполных данных плана — любое отсутствующее поле не крашит страницу
  const phases = planData?.warmup_plan?.phases ?? []

  const allDays = phases.flatMap((p) =>
    (p.daily_plan ?? []).map((d) => ({ ...d, phase: p.phase as WarmupPhase }))
  )
  const selectedDayData = allDays.find((d) => d.day === selectedDay)

  // Если данные плана повреждены — показываем заглушку вместо краша
  if (!planData?.warmup_plan?.phases) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Данные плана недоступны. Создайте новый план.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Phase strips */}
      <div className="space-y-3">
        {phases.map((phase) => (
          <div key={phase.phase} className="space-y-1.5">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-xs font-semibold ${PHASE_COLORS[phase.phase] || 'bg-secondary text-muted-foreground border-border'}`}>
              {PHASE_LABELS[phase.phase] || phase.phase}
              <span className="opacity-60 font-normal">·  {phase.daily_plan?.length ?? 0} дней</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(phase.daily_plan ?? []).map((day) => (
                <button
                  key={day.day}
                  onClick={() => setSelectedDay(selectedDay === day.day ? null : day.day)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold transition-all ${
                    selectedDay === day.day
                      ? 'bg-primary text-white scale-110 shadow-lg shadow-primary/25'
                      : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {day.day}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Selected day details */}
      {selectedDayData && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">День {selectedDayData.day} · {PHASE_LABELS[selectedDayData.phase] || selectedDayData.phase}</p>
                <p className="text-sm font-medium text-foreground mt-1">
                  {/* Support both old (theme) and new (meaning) structure */}
                  {(selectedDayData as Record<string, unknown>).meaning as string || (selectedDayData as Record<string, unknown>).theme as string || '—'}
                </p>
              </div>
              <Badge className={`text-xs shrink-0 ml-2 ${PHASE_COLORS[selectedDayData.phase]}`}>
                {PHASE_LABELS[selectedDayData.phase]}
              </Badge>
            </div>
            <Button size="sm" asChild className="gradient-accent text-white hover:opacity-90 text-xs h-7">
              <Link href={`/projects/${projectId}/generator`}>
                <ExternalLink className="mr-1.5 h-3 w-3" />
                Создать контент для этого дня
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground">Нажми на день чтобы увидеть смысл и перейти к созданию контента</p>
    </div>
  )
}
