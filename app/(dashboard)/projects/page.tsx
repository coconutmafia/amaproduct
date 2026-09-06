import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { Plus, FolderKanban } from 'lucide-react'
import { ProjectsListClient } from '@/components/projects/ProjectsListClient'
import { projectLimitFor, PLAN_LABEL } from '@/lib/projects/limit'

function pluralizeProjects(n: number) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs >= 11 && abs <= 19) return `${n} проектов`
  if (last === 1) return `${n} проект`
  if (last >= 2 && last <= 4) return `${n} проекта`
  return `${n} проектов`
}

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  // RLS (projects_select, migration 025) scopes this to owned + member
  // projects — no app-layer owner_id filter needed.
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })

  // Лимит проектов тарифа виден ДО нажатия «Новый проект» (Полина 06.09).
  const { data: prof } = await supabase.from('profiles').select('subscription_tier, role').eq('id', user.id).maybeSingle()
  const tier = String(prof?.subscription_tier || 'trial')
  const limit = projectLimitFor(tier)
  const owned = (projects ?? []).filter((p) => p.owner_id === user.id).length
  const atLimit = prof?.role !== 'admin' && owned >= limit

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Мои проекты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pluralizeProjects(projects?.length || 0)}
            {atLimit && (
              <> · на тарифе «{PLAN_LABEL[tier] ?? tier}» {limit === 1 ? 'один проект' : `${limit} проекта`} — больше на{' '}
                <Link href="/pricing" className="underline underline-offset-2 hover:text-foreground">{tier === 'pro' ? '«Продюсер»' : '«Про» и «Продюсер»'}</Link></>
            )}
          </p>
        </div>
        <Button asChild className="gradient-accent text-white hover:opacity-90">
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Новый проект</span>
            <span className="sm:hidden">Создать</span>
          </Link>
        </Button>
      </div>

      {projects && projects.length > 0 ? (
        <ProjectsListClient projects={projects} />
      ) : (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <FolderKanban className="h-16 w-16 text-muted-foreground/40" />
          <h2 className="text-lg font-semibold text-foreground">Нет проектов</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Создайте первый проект и начните генерировать контент для запуска
          </p>
          <Button asChild className="gradient-accent text-white hover:opacity-90">
            <Link href="/projects/new">
              <Plus className="mr-2 h-4 w-4" />
              Создать проект
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
