'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Download } from 'lucide-react'
import { DeletePlanButton } from './DeletePlanButton'
import { AiEditChat } from '@/components/ai/AiEditChat'
import { downloadPlanCsv } from '@/lib/planCsv'
import type { WarmupPlanData } from '@/types'

const PHASE_LABELS: Record<string, string> = {
  niche: 'На нишу', expert: 'На эксперта', product: 'На продукт', objections: 'Возражения',
  awareness: 'Знакомство', trust: 'Доверие', desire: 'Желание', close: 'Закрытие', activation: 'Активация',
}

interface Plan {
  id: string
  name: string
  duration_days: number
  status: string
  strategic_summary?: string | null
  plan_data: WarmupPlanData | null
}

interface WarmupPlanListProps {
  initialPlans: Plan[]
  projectId: string
}

export function WarmupPlanList({ initialPlans, projectId }: WarmupPlanListProps) {
  const [plans, setPlans] = useState<Plan[]>(initialPlans)
  const [activeChatPlanId, setActiveChatPlanId] = useState<string | null>(null)

  const handlePlanUpdate = (planId: string) => (updatedData: Record<string, unknown>) => {
    setPlans((prev) =>
      prev.map((p) =>
        p.id === planId
          ? { ...p, plan_data: updatedData.plan_data as WarmupPlanData }
          : p
      )
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Планы прогрева</h2>
      {plans.map((plan) => (
        <Card key={plan.id} className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{plan.name}</p>
                <p className="text-xs text-muted-foreground">{plan.duration_days} дней</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  className={`text-xs ${
                    plan.status === 'active'
                      ? 'bg-green-500/15 text-green-400 border-green-500/25'
                      : plan.status === 'approved'
                      ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
                      : 'bg-secondary text-muted-foreground border-border'
                  }`}
                >
                  {plan.status}
                </Badge>

                {/* AI Edit toggle */}
                <button
                  onClick={() => setActiveChatPlanId(activeChatPlanId === plan.id ? null : plan.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    activeChatPlanId === plan.id
                      ? 'gradient-accent text-white border-transparent'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  }`}
                >
                  ✦ AI-правка
                </button>

                {/* Download as a spreadsheet (CSV) */}
                <button
                  onClick={() => downloadPlanCsv(plan.name, plan.plan_data)}
                  title="Скачать план в таблицу (CSV — Excel / Google Sheets)"
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
                >
                  <Download className="h-3 w-3" /> Таблица
                </button>

                <DeletePlanButton planId={plan.id} projectId={projectId} />
              </div>
            </div>

            {plan.strategic_summary && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{plan.strategic_summary}</p>
            )}

            {/* Phase summary */}
            {plan.plan_data && (() => {
              const phases = plan.plan_data?.warmup_plan?.phases
              if (!phases?.length) return null
              return (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {phases.map((p) => (
                    <span
                      key={p.phase}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-xs text-muted-foreground border border-border"
                    >
                      {PHASE_LABELS[p.phase] || p.label || p.phase}
                      <span className="opacity-50">· {p.daily_plan?.length ?? 0} дн.</span>
                    </span>
                  ))}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      ))}

      {/* Floating AI chat — shown for active plan */}
      {activeChatPlanId && (
        <AiEditChat
          projectId={projectId}
          contextType="warmup_plan"
          contextId={activeChatPlanId}
          contextLabel={`${plans.find((p) => p.id === activeChatPlanId)?.name ?? 'План прогрева'}`}
          onPlanUpdate={handlePlanUpdate(activeChatPlanId)}
        />
      )}
    </div>
  )
}
