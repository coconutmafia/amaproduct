'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import type { Project } from '@/types'

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const statusColor = {
    active: 'bg-green-500/15 text-green-400 border-green-500/25',
    archived: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
    draft: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  }[project.status]

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="group border-border bg-card hover:bg-card/80 hover:border-primary/40 transition-all duration-200 cursor-pointer overflow-visible">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                {project.name}
              </h3>
              {project.niche && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{project.niche}</p>
              )}
            </div>
            <Badge className={`text-xs border whitespace-nowrap shrink-0 ${statusColor}`}>
              {project.status === 'active' ? 'Актив' : project.status === 'draft' ? 'Черновик' : 'Архив'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProgressIndicator score={project.completeness_score} showLabel={false} />

          <p className="text-xs text-muted-foreground">
            Обновлён {new Date(project.updated_at).toLocaleDateString('ru-RU')}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
