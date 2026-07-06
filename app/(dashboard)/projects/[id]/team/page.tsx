import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { TeamMembers } from '@/components/projects/TeamMembers'
import { PLAN_CONFIG } from '@/lib/generations-config'
import type { SubscriptionTier } from '@/lib/generations-config'

interface Props {
  params: Promise<{ id: string }>
}

export default async function TeamPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: project } = await supabase.from('projects').select('id, name, owner_id').eq('id', id).single()
  if (!project) notFound()

  // Team management is owner-only (see plan) — not a member's business, and
  // the invite/seat-limit logic below needs the OWNER's tier, not a viewer's.
  if (project.owner_id !== user.id) notFound()

  const [{ data: ownerProfile }, { data: members }] = await Promise.all([
    supabase.from('profiles').select('email, subscription_tier').eq('id', user.id).single(),
    supabase.from('project_members').select('id, user_id, invited_email, role, status').eq('project_id', id).order('created_at', { ascending: true }),
  ])

  const tier = (ownerProfile?.subscription_tier ?? 'trial') as SubscriptionTier
  const seatLimit = PLAN_CONFIG[tier]?.teamSeats ?? 0

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Команда</h1>
          <p className="text-sm text-muted-foreground truncate">{project.name}</p>
        </div>
      </div>

      {seatLimit === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Командный доступ недоступен на тарифе «{PLAN_CONFIG[tier]?.label ?? tier}». Перейди на тариф Про (+1 место)
          или Продюсер (команда 3–5 + клиентский доступ) на странице{' '}
          <Link href="/pricing" className="underline font-medium">тарифов</Link>.
        </div>
      ) : (
        <TeamMembers
          projectId={id}
          ownerEmail={ownerProfile?.email ?? user.email ?? ''}
          seatLimit={seatLimit}
          initialMembers={members ?? []}
        />
      )}
    </div>
  )
}
