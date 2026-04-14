import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { KnowledgeUploader } from '@/components/projects/KnowledgeUploader'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, Circle, Loader, AlertCircle, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { MaterialType } from '@/types'

interface Props {
  params: Promise<{ id: string }>
}

const CATEGORIES = [
  {
    title: 'АУДИТОРИЯ',
    items: [
      { type: 'audience_survey', label: 'Результаты опроса' },
      { type: 'interview_transcript', label: 'Транскрипты созвонов' },
      { type: 'audience_research', label: 'Исследование аудитории' },
    ] as const,
  },
  {
    title: 'СТРАТЕГИЯ',
    items: [
      { type: 'unpacking_map', label: 'Распаковка личности' },
      { type: 'meanings_map', label: 'Карта смыслов блога' },
      { type: 'competitors', label: 'Список конкурентов' },
      { type: 'tone_of_voice', label: 'Tone of Voice' },
    ] as const,
  },
  {
    title: 'СОЦИАЛЬНЫЕ ДОКАЗАТЕЛЬСТВА',
    items: [
      { type: 'cases_reviews', label: 'Кейсы и отзывы' },
    ] as const,
  },
  {
    title: 'МАРКЕТИНГ',
    items: [
      { type: 'marketing_strategy', label: 'Маркетинговая стратегия' },
      { type: 'marketing_tactics', label: 'Маркетинговая тактика' },
      { type: 'funnel_description', label: 'Описание воронок' },
      { type: 'chatbot_description', label: 'Описание чат-ботов' },
    ] as const,
  },
]

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4 text-green-400" />
  if (status === 'processing') return <Loader className="h-4 w-4 text-yellow-400 animate-spin" />
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-red-400" />
  return <Circle className="h-4 w-4 text-muted-foreground" />
}

export default async function KnowledgePage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  const materialsByType = (materials || []).reduce<Record<string, typeof materials>>(
    (acc, m) => {
      if (!acc[m.material_type]) acc[m.material_type] = []
      acc[m.material_type]!.push(m)
      return acc
    },
    {}
  )

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">База знаний проекта</h1>
            <p className="text-sm text-muted-foreground">{project.name}</p>
          </div>
        </div>
        <KnowledgeUploader projectId={id} />
      </div>

      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <BookOpen className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground mb-2">
                Полнота базы: чем больше — тем персональнее контент!
              </p>
              <ProgressIndicator score={project.completeness_score} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {CATEGORIES.map((category) => (
          <Card key={category.title} className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground tracking-wider">
                {category.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              {category.items.map(({ type, label }) => {
                const typeItems = materialsByType[type] || []
                const hasItems = typeItems.length > 0
                const latestItem = typeItems[0]

                return (
                  <div
                    key={type}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      hasItems ? 'border-green-500/20 bg-green-500/5' : 'border-border bg-secondary/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon status={latestItem?.processing_status || 'none'} />
                      <div>
                        <span className="text-sm text-foreground">{label}</span>
                        {typeItems.length > 1 && (
                          <span className="ml-2 text-xs text-muted-foreground">({typeItems.length} файлов)</span>
                        )}
                        {latestItem && (
                          <p className="text-xs text-muted-foreground">{latestItem.title}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!hasItems && (
                        <Badge variant="outline" className="text-xs text-muted-foreground border-border">
                          Загрузить
                        </Badge>
                      )}
                      {hasItems && (
                        <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">
                          Готово
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {materials && materials.filter((m) => !CATEGORIES.some((c) =>
        c.items.some((item) => item.type === m.material_type)
      )).length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground tracking-wider">
              ДРУГИЕ МАТЕРИАЛЫ
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-2">
            {materials
              .filter((m) => !CATEGORIES.some((c) => c.items.some((item) => item.type === m.material_type)))
              .map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <StatusIcon status={m.processing_status} />
                  <span className="text-sm text-foreground">{m.title}</span>
                  <Badge variant="outline" className="ml-auto text-xs">{m.material_type}</Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
