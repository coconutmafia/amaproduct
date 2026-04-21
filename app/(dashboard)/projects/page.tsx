import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { Plus, FolderKanban } from 'lucide-react'

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

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Мои проекты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pluralizeProjects(projects?.length || 0)}
          </p>
        </div>
        <Button asChild className="gradient-accent text-white hover:opacity-90">
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            Новый проект
          </Link>
        </Button>
      </div>

      {projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
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
