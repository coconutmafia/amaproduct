import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { Plus, FolderKanban, FileText, Sparkles, ArrowRight, Clock } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(6)

  const { count: totalMaterials } = await supabase
    .from('project_materials')
    .select('*', { count: 'exact', head: true })

  const { count: totalContent } = await supabase
    .from('content_items')
    .select('*', { count: 'exact', head: true })

  const { data: processingItems } = await supabase
    .from('project_materials')
    .select('title, processing_status')
    .eq('processing_status', 'processing')
    .limit(3)

  const name = profile?.full_name || user.email?.split('@')[0] || 'Блогер'

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Добро пожаловать, <span className="gradient-text">{name}</span>!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ваш AI-продюсер готов к работе
          </p>
        </div>
        <Button asChild className="gradient-accent text-white hover:opacity-90">
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            Новый проект
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
                <FolderKanban className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{projects?.length || 0}</p>
                <p className="text-sm text-muted-foreground">Проектов</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15">
                <FileText className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{totalMaterials || 0}</p>
                <p className="text-sm text-muted-foreground">Материалов</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/15">
                <Sparkles className="h-6 w-6 text-green-400" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{totalContent || 0}</p>
                <p className="text-sm text-muted-foreground">Единиц контента</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Последние проекты</h2>
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
            <Link href="/projects">
              Все проекты
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
            <Link href="/projects/new">
              <Card className="border-border border-dashed bg-card/50 hover:bg-card hover:border-primary/40 transition-all cursor-pointer h-full min-h-[140px] flex items-center justify-center">
                <CardContent className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors p-6">
                  <Plus className="h-8 w-8" />
                  <span className="text-sm font-medium">Создать проект</span>
                </CardContent>
              </Card>
            </Link>
          </div>
        ) : (
          <Card className="border-border border-dashed bg-card/50">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-accent opacity-80">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-foreground">Создайте первый проект</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Начните работу с AI-продюсером прямо сейчас
                </p>
              </div>
              <Button asChild className="gradient-accent text-white hover:opacity-90">
                <Link href="/projects/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Создать проект
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Processing items */}
      {processingItems && processingItems.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-400" />
              Обработка материалов
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {processingItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-foreground">{item.title}</span>
                <span className="text-muted-foreground text-xs ml-auto">обрабатывается...</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
