import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { KnowledgePageClient } from '@/components/projects/KnowledgePageClient'
import { ArrowLeft, Users, ChevronRight, Palette } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

interface Props {
  params: Promise<{ id: string }>
}

export default async function KnowledgePage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  // RLS (projects_select / project_materials_select, migration 025) scopes
  // these to owned + member projects — no app-layer owner_id filter needed.
  const [{ data: project }, { data: profile }, { data: materials }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    supabase.from('project_materials').select('*').eq('project_id', id).order('created_at', { ascending: false }),
  ])

  if (!project) notFound()

  const userName = profile?.full_name || user.email?.split('@')[0] || ''

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Материалы проекта</h1>
          <p className="text-sm text-muted-foreground truncate">{project.name}</p>
        </div>
      </div>

      <Link href={`/projects/${id}/research`} className="block rounded-xl border border-primary/25 bg-primary/5 p-4 hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Исследование аудитории</p>
            <p className="text-xs text-muted-foreground">Интервью с клиентами → расшифровка → карта смыслов. Загрузи аудио — AI разберёт боли и язык аудитории.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </Link>

      <Link href={`/projects/${id}/brand`} className="block rounded-xl border border-primary/25 bg-primary/5 p-4 hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Palette className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Фирменный стиль</p>
            <p className="text-xs text-muted-foreground">Примеры оформления → AI распознаёт цвета и настроение. Отдельно стиль постов и стиль сториз.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </Link>

      <KnowledgePageClient
        projectId={id}
        completenessScore={project.completeness_score}
        initialMaterials={materials || []}
        userName={userName}
      />
    </div>
  )
}
