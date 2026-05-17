'use client'

import Link from 'next/link'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProgressIndicator } from '@/components/shared/ProgressIndicator'
import type { Project } from '@/types'
import { useCallback, useRef } from 'react'

interface ProjectCardProps {
  project: Project
  index?: number
}

export function ProjectCard({ project, index = 0 }: ProjectCardProps) {
  const statusColor = {
    active: 'bg-green-500/15 text-green-600 border-green-500/25',
    archived: 'bg-gray-500/15 text-gray-500 border-gray-500/25',
    draft: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/25',
  }[project.status]

  // 3D tilt
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [5, -5]), { stiffness: 400, damping: 35 })
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-5, 5]), { stiffness: 400, damping: 35 })

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    x.set((e.clientX - rect.left) / rect.width - 0.5)
    y.set((e.clientY - rect.top) / rect.height - 0.5)
  }, [x, y])

  const handleMouseLeave = useCallback(() => {
    x.set(0); y.set(0)
  }, [x, y])

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        ref={ref}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.15 }}
      >
        <Link href={`/projects/${project.id}`}>
          <Card className="group border-border bg-card hover:border-primary/40 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden">
            <CardHeader className="pb-2 px-4">
              <h3 className="font-semibold text-foreground line-clamp-2 group-hover:text-primary transition-colors pr-1">
                {project.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${statusColor}`}>
                  {project.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                  {project.status === 'active' ? 'Активен' : project.status === 'draft' ? 'Черновик' : 'Архив'}
                </span>
                {project.niche && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{project.niche}</p>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProgressIndicator score={project.completeness_score} showLabel={false} animated />
              <p className="text-xs text-muted-foreground">
                Обновлён {new Date(project.updated_at).toLocaleDateString('ru-RU')}
              </p>
            </CardContent>
          </Card>
        </Link>
      </motion.div>
    </motion.div>
  )
}
