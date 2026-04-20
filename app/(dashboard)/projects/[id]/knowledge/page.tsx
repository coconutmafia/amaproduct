import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { KnowledgePageClient } from '@/components/projects/KnowledgePageClient'
import { ArrowLeft } from 'lucide-react'
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

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!project) notFound()

  const { data: materials } = await supabase
    .from('project_materials')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Материалы проекта</h1>
          <p className="text-sm text-muted-foreground">{project.name}</p>
        </div>
      </div>

      <KnowledgePageClient
        projectId={id}
        completenessScore={project.completeness_score}
        initialMaterials={materials || []}
      />
    </div>
  )
}
