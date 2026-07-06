import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { WarmupWizard } from '@/components/strategy/WarmupWizard'
import { WarmupPlanList } from '@/components/strategy/WarmupPlanList'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  params: Promise<{ id: string }>
}

export default async function StrategyPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  // RLS (projects_select, migration 025) scopes this to owned + member
  // projects — no app-layer owner_id filter needed.
  const { data: project } = await supabase.from('projects').select('*').eq('id', id).single()
  if (!project) notFound()

  const [{ data: products }, { data: funnels }, { data: warmupPlans }] = await Promise.all([
    supabase.from('products').select('*').eq('project_id', id).eq('is_active', true),
    supabase.from('funnels').select('*').eq('project_id', id).eq('is_active', true),
    supabase.from('warmup_plans').select('*').eq('project_id', id).order('created_at', { ascending: false }),
  ])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">План прогрева</h1>
          <p className="text-sm text-muted-foreground">{project.name}</p>
        </div>
      </div>

      {/* Existing plans — client component with AI edit */}
      {warmupPlans && warmupPlans.length > 0 && (
        <WarmupPlanList initialPlans={warmupPlans} projectId={id} />
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
