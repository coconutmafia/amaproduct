import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { WarmupWizard } from '@/components/strategy/WarmupWizard'
import { WarmupTimeline } from '@/components/strategy/WarmupTimeline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { WarmupPlanData } from '@/types'

interface Props {
  params: Promise<{ id: string }>
}

export default async function StrategyPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).eq('owner_id', user.id).single()
  if (!project) notFound()

  const [{ data: products }, { data: funnels }, { data: warmupPlans }] = await Promise.all([
    supabase.from('products').select('*').eq('project_id', id).eq('is_active', true),
    supabase.from('funnels').select('*').eq('project_id', id).eq('is_active', true),
    supabase.from('warmup_plans').select('*').eq('project_id', id).order('created_at', { ascending: false }),
  ])

  const activeplan = warmupPlans?.find((p) => p.status === 'active' || p.status === 'approved')

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Стратегия прогрева</h1>
          <p className="text-sm text-muted-foreground">{project.name}</p>
        </div>
      </div>

      {/* Existing plans */}
      {warmupPlans && warmupPlans.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Планы прогрева</h2>
          {warmupPlans.map((plan) => (
            <Card key={plan.id} className="border-border bg-card">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{plan.name}</p>
                    <p className="text-xs text-muted-foreground">{plan.duration_days} дней</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs ${
                      plan.status === 'active' ? 'bg-green-500/15 text-green-400 border-green-500/25' :
                      plan.status === 'approved' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
                      'bg-secondary text-muted-foreground border-border'
                    }`}>
                      {plan.status}
                    </Badge>
                  </div>
                </div>

                {plan.strategic_summary && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{plan.strategic_summary}</p>
                )}

                {plan.plan_data && (
                  <div className="mt-4">
                    <WarmupTimeline
                      planData={plan.plan_data as WarmupPlanData}
                      projectId={id}
                      warmupPlanId={plan.id}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create new plan */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">
            {warmupPlans && warmupPlans.length > 0 ? 'Создать новый план прогрева' : 'Создать план прогрева'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WarmupWizard
            projectId={id}
            products={products || []}
            funnels={funnels || []}
          />
        </CardContent>
      </Card>
    </div>
  )
}
